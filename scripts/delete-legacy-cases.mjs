#!/usr/bin/env node
//
// Delete the pre-Phase-3 top-level `/cases/*` collection (and all of its
// /tasks, /notes, /wardNotes, /comments subcollections) from Firestore.
//
// Why this exists:
//   The legacy /cases collection used to be readable by any signed-in user
//   as a 30-day "rollback window" after the migration to /groups/{gid}/cases.
//   That window is closed now — the data is no longer needed and leaving it
//   readable enables a privilege-escalation attack via the migration UI
//   (see security review Vuln 3). After this script runs, the Firestore
//   rules can simply omit the /cases block and the catch-all denies all
//   access.
//
// Prerequisites:
//   1. A service-account key JSON for the Firebase project. Get it from
//      Firebase Console → Project settings → Service accounts → Generate
//      new private key. Save the file *outside* the repo (do NOT commit
//      it) and set GOOGLE_APPLICATION_CREDENTIALS to its path:
//
//        export GOOGLE_APPLICATION_CREDENTIALS=~/keys/catalist-dev-sa.json
//
//   2. firebase-admin installed. From the repo root:
//
//        npm install --no-save firebase-admin
//
// Usage:
//   node scripts/delete-legacy-cases.mjs --project catalist-dev   # dev first
//   node scripts/delete-legacy-cases.mjs --project catalist-dev --confirm
//   node scripts/delete-legacy-cases.mjs --project catalist-1 --confirm  # prod
//
// Without --confirm the script does a dry-run that lists what would be
// deleted but doesn't touch anything. Always dry-run first.
//
// What it deletes:
//   /cases/{caseId}
//     /tasks/{taskId}
//       /comments/{commentId}
//     /notes/{noteId}
//     /wardNotes/{wardNoteId}
//
// Anything outside /cases is untouched.

import { cert, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { argv, env, exit } from 'node:process';

function parseArgs() {
  const out = { project: null, confirm: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project') out.project = argv[++i];
    else if (a === '--confirm') out.confirm = true;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node scripts/delete-legacy-cases.mjs --project <id> [--confirm]');
      exit(0);
    }
  }
  if (!out.project) {
    console.error('Missing --project <projectId>. See script header for details.');
    exit(1);
  }
  return out;
}

async function main() {
  const args = parseArgs();
  const credsPath = env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credsPath) {
    console.error('GOOGLE_APPLICATION_CREDENTIALS env var not set. See script header.');
    exit(1);
  }
  const creds = JSON.parse(readFileSync(resolve(credsPath), 'utf8'));
  initializeApp({ credential: cert(creds), projectId: args.project });
  const db = getFirestore();

  const dryRun = !args.confirm;
  console.log(`Mode: ${dryRun ? 'DRY RUN (no writes)' : 'DESTRUCTIVE — confirming deletes'}`);
  console.log(`Project: ${args.project}\n`);

  const casesSnap = await db.collection('cases').get();
  console.log(`Found ${casesSnap.size} legacy case(s).`);

  let totalCases = 0;
  let totalTasks = 0;
  let totalComments = 0;
  let totalNotes = 0;
  let totalWardNotes = 0;

  for (const caseDoc of casesSnap.docs) {
    totalCases += 1;
    const caseRef = caseDoc.ref;

    const tasks = await caseRef.collection('tasks').get();
    for (const t of tasks.docs) {
      totalTasks += 1;
      const comments = await t.ref.collection('comments').get();
      for (const c of comments.docs) {
        totalComments += 1;
        if (!dryRun) await c.ref.delete();
      }
      if (!dryRun) await t.ref.delete();
    }

    const notes = await caseRef.collection('notes').get();
    for (const n of notes.docs) {
      totalNotes += 1;
      if (!dryRun) await n.ref.delete();
    }

    const wardNotes = await caseRef.collection('wardNotes').get();
    for (const w of wardNotes.docs) {
      totalWardNotes += 1;
      if (!dryRun) await w.ref.delete();
    }

    if (!dryRun) await caseRef.delete();
    process.stdout.write('.');
  }

  console.log('\n');
  console.log(`Cases: ${totalCases}`);
  console.log(`Tasks: ${totalTasks}`);
  console.log(`Comments: ${totalComments}`);
  console.log(`Notes: ${totalNotes}`);
  console.log(`Ward notes: ${totalWardNotes}`);
  if (dryRun) {
    console.log('\nDry-run complete. Re-run with --confirm to actually delete.');
  } else {
    console.log('\nDeletion complete. Verify in Firebase Console that /cases is empty.');
  }
}

main().catch((err) => {
  console.error('Failed:', err);
  exit(1);
});
