#!/usr/bin/env node
/**
 * Migrate each group's wrapped DEK from the legacy browser-derived KEK (v1)
 * to Cloud KMS (v2).
 *
 * The data encryption key itself is unchanged, so every field already
 * encrypted stays readable. Only the wrapping around it moves — out of the
 * public JavaScript bundle and into a key that never leaves Google.
 *
 * ORDER MATTERS. Deploy a client that understands BOTH v1 and v2 before
 * running this. src/auth/envelope.ts has done so since 2026-09-20, so the
 * sequence is:
 *
 *   1. deploy functions        (unwrapGroupDek / wrapGroupDek exist)
 *   2. deploy the client       (understands v1 and v2; still reading v1)
 *   3. run this               (v1 -> v2; the client follows automatically)
 *
 * Running it before step 2 breaks decryption for anyone on the old bundle.
 *
 * Usage:
 *   node scripts/migrate-kek-to-kms.mjs --project catalist-dev
 *   node scripts/migrate-kek-to-kms.mjs --project catalist-dev --apply
 *
 * The legacy seed is read from a file (never argv). Omit --old-env to use
 * envelope.ts's public fallback, which is what an unconfigured build used.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';

// Must match src/auth/envelope.ts.
const FALLBACK_SEED = 'catalist-dev-kek-fallback-not-for-production-use';
const KEK_SALT = 'catalist-envelope-kek-v1';
const PBKDF2_ITERATIONS = 200000;
const WRAPPED_DEK_V1_LOCAL = 1;
const WRAPPED_DEK_V2_KMS = 2;

// Must match functions/src/index.ts kmsKeyName().
const KMS_LOCATION = 'europe';
const KMS_KEYRING = 'catalist';
const KMS_KEY = 'field-kek';

const FS_API = 'https://firestore.googleapis.com/v1';
const KMS_API = 'https://cloudkms.googleapis.com/v1';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

const project = arg('project');
const oldEnvFile = arg('old-env');
const apply = has('apply');
// Reverse direction: v2 (KMS) -> v1 (legacy local KEK). Only for backing out
// a migration that went wrong; it puts the key back in the public bundle's
// reach, so it is strictly an emergency lever.
const rollback = has('rollback');

if (!project) {
  console.error('Usage: node scripts/migrate-kek-to-kms.mjs --project <id> [--old-env <file>] [--apply]');
  process.exit(1);
}

function seedFromEnvFile(file) {
  const line = readFileSync(file, 'utf8')
    .split('\n')
    .find((l) => l.trim().startsWith('VITE_FIELD_KEK_SEED='));
  if (!line) throw new Error(`no VITE_FIELD_KEK_SEED in ${file}`);
  const seed = line.slice(line.indexOf('=') + 1).trim();
  if (!seed) throw new Error(`VITE_FIELD_KEK_SEED is empty in ${file}`);
  return seed;
}

const oldSeed = oldEnvFile ? seedFromEnvFile(oldEnvFile) : FALLBACK_SEED;

const b64 = (buf) => Buffer.from(buf).toString('base64');
const unb64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));

async function deriveLegacyKek(seed) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(seed), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode(KEK_SALT), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

const token = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();

async function api(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}\n${await res.text()}`);
  return res.json();
}

const kmsKey = `projects/${project}/locations/${KMS_LOCATION}/keyRings/${KMS_KEYRING}/cryptoKeys/${KMS_KEY}`;

const kmsEncrypt = async (raw) =>
  (await api(`${KMS_API}/${kmsKey}:encrypt`, {
    method: 'POST',
    body: JSON.stringify({ plaintext: b64(raw) }),
  })).ciphertext;

const kmsDecrypt = async (ciphertext) =>
  unb64((await api(`${KMS_API}/${kmsKey}:decrypt`, {
    method: 'POST',
    body: JSON.stringify({ ciphertext }),
  })).plaintext);

const fromFirestoreMap = (f) => ({
  v: Number(f.v.integerValue),
  n: f.n?.stringValue,
  c: f.c.stringValue,
  k: f.k.stringValue,
});

console.log(`Project:  ${project}`);
console.log(`KMS key:  ${kmsKey}`);
console.log(`Legacy:   ${oldEnvFile || 'envelope.ts public fallback'}`);
console.log(`Direction: ${rollback ? 'ROLLBACK v2 -> v1 (emergency)' : 'migrate v1 -> v2'}`);
console.log(`Mode:     ${apply ? 'APPLY — will write' : 'dry run — no writes'}\n`);

const legacyKek = await deriveLegacyKek(oldSeed);
const base = `${FS_API}/projects/${project}/databases/(default)/documents`;
const { documents = [] } = await api(`${base}/groups?pageSize=300`);

if (!documents.length) {
  console.log('No groups found.');
  process.exit(0);
}

let migrated = 0;
let already = 0;
let skipped = 0;
let failed = 0;

for (const g of documents) {
  const id = g.name.split('/').pop();
  const name = g.fields?.name?.stringValue || '(unnamed)';
  const field = g.fields?.wrappedDek;

  if (!field?.mapValue?.fields) {
    console.log(`  skip     ${id}  ${name} — no wrappedDek`);
    skipped++;
    continue;
  }

  const wrapped = fromFirestoreMap(field.mapValue.fields);

  if (rollback) {
    if (wrapped.v !== WRAPPED_DEK_V2_KMS) {
      console.log(`  skip     ${id}  ${name} — already on v1`);
      skipped++;
      continue;
    }
    const rawDek = await kmsDecrypt(wrapped.c);
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, legacyKek, rawDek);
    if (apply) {
      await api(
        `${FS_API}/${g.name}?updateMask.fieldPaths=wrappedDek&updateMask.fieldPaths=wrappedDekUpdatedAt`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            fields: {
              wrappedDek: {
                mapValue: {
                  fields: {
                    v: { integerValue: String(WRAPPED_DEK_V1_LOCAL) },
                    n: { stringValue: b64(nonce) },
                    c: { stringValue: b64(cipher) },
                    k: { stringValue: wrapped.k },
                  },
                },
              },
              wrappedDekUpdatedAt: { timestampValue: new Date().toISOString() },
            },
          }),
        },
      );
      console.log(`  ROLLED BACK ${id}  ${name}  v2 -> v1`);
    } else {
      console.log(`  would roll back ${id}  ${name}  v2 -> v1`);
    }
    migrated++;
    continue;
  }

  if (wrapped.v === WRAPPED_DEK_V2_KMS) {
    console.log(`  already  ${id}  ${name} — on KMS`);
    already++;
    continue;
  }
  if (wrapped.v !== WRAPPED_DEK_V1_LOCAL) {
    console.log(`  FAIL     ${id}  ${name} — unknown wrapping version ${wrapped.v}`);
    failed++;
    continue;
  }

  // Unwrap with the legacy browser KEK.
  let rawDek;
  try {
    rawDek = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unb64(String(wrapped.n)) },
      legacyKek,
      unb64(wrapped.c),
    );
  } catch {
    console.log(`  FAIL     ${id}  ${name} — legacy KEK does not unwrap this DEK`);
    failed++;
    continue;
  }

  // Re-wrap with KMS, then prove KMS gives the same key back before writing.
  const ciphertext = await kmsEncrypt(rawDek);
  const roundTrip = Buffer.from(await kmsDecrypt(ciphertext));
  if (!roundTrip.equals(Buffer.from(rawDek))) {
    console.log(`  FAIL     ${id}  ${name} — KMS round-trip mismatch`);
    failed++;
    continue;
  }

  if (apply) {
    await api(
      `${FS_API}/${g.name}?updateMask.fieldPaths=wrappedDek&updateMask.fieldPaths=wrappedDekUpdatedAt`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          fields: {
            wrappedDek: {
              mapValue: {
                fields: {
                  v: { integerValue: String(WRAPPED_DEK_V2_KMS) },
                  c: { stringValue: ciphertext },
                  k: { stringValue: wrapped.k },
                },
              },
            },
            wrappedDekUpdatedAt: { timestampValue: new Date().toISOString() },
          },
        }),
      },
    );
    console.log(`  MIGRATED ${id}  ${name}  (dek ${wrapped.k})  v1 -> v2`);
  } else {
    console.log(`  would migrate ${id}  ${name}  (dek ${wrapped.k}) — round-trip verified`);
  }
  migrated++;
}

console.log(
  `\n${apply ? 'Migrated' : 'Would migrate'} ${migrated}, already on KMS ${already}, skipped ${skipped}, failed ${failed}.`,
);
if (failed) process.exitCode = 1;
if (apply && migrated) {
  console.log('\nThe legacy seed is now unused for these groups. Once every group');
  console.log('reports v2, delete VITE_FIELD_KEK_SEED and the v1 path in envelope.ts.');
}
