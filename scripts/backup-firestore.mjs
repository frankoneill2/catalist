#!/usr/bin/env node
/**
 * Read-only Firestore export to a single JSON file.
 *
 * Why this exists: Firestore's own managed backups (scheduled exports and
 * point-in-time recovery) require billing to be enabled on the project.
 * Until that happens this script is the only backup the project has, so it
 * deliberately depends on nothing but Node 20 and the gcloud CLI.
 *
 * It is NOT a replacement for managed backups. It is a snapshot taken when
 * you run it, on the machine you run it from. Once billing is on, switch to
 * `gcloud firestore backups schedules create` and keep this for ad-hoc dumps.
 *
 * Usage:
 *   node scripts/backup-firestore.mjs --project catalist-1
 *   node scripts/backup-firestore.mjs --project catalist-dev --out /tmp
 *
 * Auth: uses your gcloud access token, so it reads as you and bypasses
 * Firestore rules. You need read access to the project.
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const API = 'https://firestore.googleapis.com/v1';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const project = arg('project');
const outDir = arg('out', 'backups');

if (!project) {
  console.error('Usage: node scripts/backup-firestore.mjs --project <id> [--out <dir>]');
  process.exit(1);
}

const token = execFileSync('gcloud', ['auth', 'print-access-token'], {
  encoding: 'utf8',
}).trim();

const base = `${API}/projects/${project}/databases/(default)/documents`;

async function api(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} — ${url}\n${await res.text()}`);
  }
  return res.json();
}

/** Collection ids directly under a document (or under the database root). */
async function childCollections(parent) {
  const ids = [];
  let pageToken;
  do {
    const body = await api(`${parent}:listCollectionIds`, {
      method: 'POST',
      body: JSON.stringify({ pageSize: 100, pageToken }),
    });
    ids.push(...(body.collectionIds || []));
    pageToken = body.nextPageToken;
  } while (pageToken);
  return ids;
}

/** Every document in one collection, following pagination. */
async function documentsIn(collectionUrl) {
  const docs = [];
  let pageToken;
  do {
    const url = new URL(collectionUrl);
    url.searchParams.set('pageSize', '300');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const body = await api(url.toString());
    docs.push(...(body.documents || []));
    pageToken = body.nextPageToken;
  } while (pageToken);
  return docs;
}

const snapshot = {};
const counts = {};

/** Walk a collection, record its documents, then recurse into subcollections. */
async function walkCollection(parentUrl, parentPath, collectionId) {
  const path = parentPath ? `${parentPath}/${collectionId}` : collectionId;
  const docs = await documentsIn(`${parentUrl}/${collectionId}`);
  counts[path] = (counts[path] || 0) + docs.length;

  for (const doc of docs) {
    // doc.name is the full resource path; the bit after /documents/ is the key.
    const key = doc.name.split('/documents/')[1];
    snapshot[key] = {
      fields: doc.fields || {},
      createTime: doc.createTime,
      updateTime: doc.updateTime,
    };
    for (const sub of await childCollections(`${API}/${doc.name}`)) {
      await walkCollection(`${API}/${doc.name}`, key, sub);
    }
  }
}

const startedAt = new Date();
console.log(`Exporting ${project} …`);

for (const id of await childCollections(base)) {
  await walkCollection(base, '', id);
}

const stamp = startedAt.toISOString().replace(/[:.]/g, '-');
const file = join(outDir, `${project}-${stamp}.json`);
mkdirSync(outDir, { recursive: true });
writeFileSync(
  file,
  JSON.stringify(
    {
      project,
      database: '(default)',
      exportedAt: startedAt.toISOString(),
      documentCount: Object.keys(snapshot).length,
      collectionCounts: counts,
      documents: snapshot,
    },
    null,
    2,
  ),
);

const total = Object.keys(snapshot).length;
for (const [path, n] of Object.entries(counts).sort()) {
  console.log(`  ${String(n).padStart(5)}  ${path}`);
}
console.log(`\n${total} documents → ${file}`);
console.log(`Took ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
