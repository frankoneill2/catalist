#!/usr/bin/env node
/**
 * Rotate the Key Encryption Key (KEK) without losing data.
 *
 * Background: each group has its own AES-GCM Data Encryption Key (DEK) which
 * encrypts that group's clinical fields. The DEK never changes. What changes
 * here is the KEK that *wraps* the DEK, stored on the group document as
 * `wrappedDek`.
 *
 * So rotation is: unwrap each group's DEK with the old KEK, re-wrap it with
 * the new one, write it back. Existing ciphertext stays readable because the
 * DEK underneath is untouched.
 *
 * This must mirror src/auth/envelope.ts exactly — PBKDF2-SHA256, 200,000
 * iterations, salt 'catalist-envelope-kek-v1', AES-GCM-256, standard base64.
 * If that file changes, change this one.
 *
 * Ordering matters. The seed is baked into the client bundle at build time,
 * so the browser holding the OLD seed cannot unwrap a NEWLY wrapped DEK, and
 * vice versa. Rotate and deploy the matching build together.
 *
 * Usage:
 *   # dry run (default — reads and verifies, writes nothing)
 *   node scripts/rotate-kek.mjs --project catalist-dev --new-env .env.development.local
 *
 *   # apply
 *   node scripts/rotate-kek.mjs --project catalist-dev --new-env .env.development.local --apply
 *
 * Seeds are read from files, never from argv, so they stay out of your shell
 * history and the process list. `--old-env <file>` overrides the default of
 * assuming the current key is envelope.ts's public fallback.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';

// Must match src/auth/envelope.ts.
const FALLBACK_SEED = 'catalist-dev-kek-fallback-not-for-production-use';
const KEK_SALT = 'catalist-envelope-kek-v1';
const PBKDF2_ITERATIONS = 200000;
const ENVELOPE_VERSION = 1;

const API = 'https://firestore.googleapis.com/v1';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const has = (name) => process.argv.includes(`--${name}`);

const project = arg('project');
const newEnvFile = arg('new-env');
const oldEnvFile = arg('old-env');
const apply = has('apply');

if (!project || !newEnvFile) {
  console.error(
    'Usage: node scripts/rotate-kek.mjs --project <id> --new-env <file> [--old-env <file>] [--apply]',
  );
  process.exit(1);
}

/** Pull VITE_FIELD_KEK_SEED out of a dotenv-style file. */
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
const newSeed = seedFromEnvFile(newEnvFile);

if (oldSeed === newSeed) {
  console.error('Old and new seeds are identical — nothing to rotate.');
  process.exit(1);
}

const b64 = (buf) => Buffer.from(buf).toString('base64');
const unb64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));

/** Short non-reversible fingerprint, so we can name a seed without printing it. */
async function fingerprint(seed) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed));
  return b64(h).replace(/[+/=]/g, '').slice(0, 8);
}

async function deriveKek(seed) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(seed), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode(KEK_SALT), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function unwrapDek(wrapped, kek) {
  if (wrapped.v !== ENVELOPE_VERSION) {
    throw new Error(`unsupported wrapped DEK version: ${wrapped.v}`);
  }
  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: unb64(wrapped.n) },
    kek,
    unb64(wrapped.c),
  );
}

async function wrapDek(rawDek, id, kek) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, kek, rawDek);
  return { v: ENVELOPE_VERSION, n: b64(nonce), c: b64(cipher), k: id };
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

/** Firestore REST represents the wrappedDek map as typed fields. */
const toFirestoreMap = (w) => ({
  mapValue: {
    fields: {
      v: { integerValue: String(w.v) },
      n: { stringValue: w.n },
      c: { stringValue: w.c },
      k: { stringValue: w.k },
    },
  },
});

const fromFirestoreMap = (f) => ({
  v: Number(f.v.integerValue),
  n: f.n.stringValue,
  c: f.c.stringValue,
  k: f.k.stringValue,
});

const base = `${API}/projects/${project}/databases/(default)/documents`;

console.log(`Project:  ${project}`);
console.log(`Old KEK:  ${await fingerprint(oldSeed)}${oldEnvFile ? '' : '  (envelope.ts public fallback)'}`);
console.log(`New KEK:  ${await fingerprint(newSeed)}  (from ${newEnvFile})`);
console.log(`Mode:     ${apply ? 'APPLY — will write' : 'dry run — no writes'}\n`);

const oldKek = await deriveKek(oldSeed);
const newKek = await deriveKek(newSeed);

const { documents = [] } = await api(`${base}/groups?pageSize=300`);
if (!documents.length) {
  console.log('No groups found.');
  process.exit(0);
}

let rotated = 0;
let skipped = 0;
let failed = 0;

for (const g of documents) {
  const id = g.name.split('/').pop();
  const name = g.fields?.name?.stringValue || '(unnamed)';
  const wrappedField = g.fields?.wrappedDek;

  if (!wrappedField?.mapValue?.fields) {
    console.log(`  skip    ${id}  ${name} — no wrappedDek`);
    skipped++;
    continue;
  }

  const wrapped = fromFirestoreMap(wrappedField.mapValue.fields);

  let rawDek;
  try {
    rawDek = await unwrapDek(wrapped, oldKek);
  } catch {
    console.log(`  FAIL    ${id}  ${name} — old KEK does not unwrap this DEK`);
    failed++;
    continue;
  }

  const reWrapped = await wrapDek(rawDek, wrapped.k, newKek);

  // Prove the new wrapping round-trips to the same key before writing.
  const check = Buffer.from(await unwrapDek(reWrapped, newKek));
  if (!check.equals(Buffer.from(rawDek))) {
    console.log(`  FAIL    ${id}  ${name} — re-wrap verification mismatch`);
    failed++;
    continue;
  }

  if (apply) {
    await api(
      `${API}/${g.name}?updateMask.fieldPaths=wrappedDek&updateMask.fieldPaths=wrappedDekUpdatedAt`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          fields: {
            wrappedDek: toFirestoreMap(reWrapped),
            wrappedDekUpdatedAt: { timestampValue: new Date().toISOString() },
          },
        }),
      },
    );
    console.log(`  ROTATED ${id}  ${name}  (dek ${wrapped.k})`);
  } else {
    console.log(`  would rotate ${id}  ${name}  (dek ${wrapped.k}) — verified OK`);
  }
  rotated++;
}

console.log(
  `\n${apply ? 'Rotated' : 'Would rotate'} ${rotated}, skipped ${skipped}, failed ${failed}.`,
);
if (failed) process.exitCode = 1;
if (apply && rotated) {
  console.log('\nNow build and deploy with the SAME seed, or the live app cannot unwrap:');
  console.log(`  npm run ${project === 'catalist-1' ? 'deploy:prod' : 'deploy:dev'}`);
}
