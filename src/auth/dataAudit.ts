// Phase 6 — Append-only data audit log.
//
// One event per meaningful patient-data write. Stored under
// `groups/{groupId}/audit/{eventId}` so:
//   - Rules can scope read access to admins of the same group.
//   - There's no top-level audit collection that could be enumerated by
//     anyone signed in.
//   - Cross-group analytics later (Phase 7) can collection-group this if it
//     ever needs to.
//
// Event shape:
//   {
//     uid:            string         — actor (request.auth.uid)
//     action:         string         — 'case.create' | 'case.update' | ...
//     groupId:        string         — which workspace
//     caseId?:        string
//     taskId?:        string
//     wardNoteId?:    string
//     targetUid?:     string         — for member-* events
//     detail?:        object         — small key/values (never PHI)
//     createdAt:      serverTimestamp
//     clientCreatedAt:number          — for ordering before serverTimestamp resolves
//   }
//
// What we do NOT log:
//   - Plaintext patient content. Field titles and IDs only — never the
//     decrypted text. Audit entries flowing through Sentry / future logging
//     pipelines must remain GDPR-friendly.
//   - Reads. Logging every list/snapshot from the client would multiply our
//     write volume by 10–100x and isn't enforceable from the client anyway.
//     Phase 7 introduces server-mediated reads for export/audit-view and
//     logs those server-side, where it's both reliable and meaningful.

import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { auth, db } from './firebase';
import { getCurrentGroupId } from './groupContext';

export type DataAuditAction =
  | 'case.create'
  | 'case.update'
  | 'case.delete'
  | 'case.discharge'
  | 'task.create'
  | 'task.update'
  | 'task.delete'
  | 'task.assign'
  | 'note.create'
  | 'note.update'
  | 'note.delete'
  | 'wardNote.create'
  | 'wardNote.update'
  | 'wardNote.delete'
  | 'wardNote.print'
  | 'member.add'
  | 'member.remove'
  | 'member.role'
  | 'group.rename'
  | 'group.create'
  | 'group.delete'
  | 'invite.create'
  | 'invite.revoke'
  | 'invite.accept';

export interface DataAuditEvent {
  action: DataAuditAction;
  groupId?: string | null;
  caseId?: string | null;
  taskId?: string | null;
  wardNoteId?: string | null;
  noteId?: string | null;
  targetUid?: string | null;
  detail?: Record<string, unknown> | null;
}

// Best-effort: never throws, never blocks the caller's flow. We swallow
// failures so a write that gets denied (e.g. the group rules briefly out of
// sync after a membership change) doesn't tear down the user-visible action
// it was tracking.
export async function logDataEvent(event: DataAuditEvent): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;
  const groupId = event.groupId || getCurrentGroupId();
  if (!groupId) return;
  try {
    await addDoc(collection(db, 'groups', groupId, 'audit'), {
      uid: user.uid,
      action: event.action,
      groupId,
      caseId: event.caseId ?? null,
      taskId: event.taskId ?? null,
      wardNoteId: event.wardNoteId ?? null,
      noteId: event.noteId ?? null,
      targetUid: event.targetUid ?? null,
      detail: event.detail ?? null,
      createdAt: serverTimestamp(),
      clientCreatedAt: Date.now(),
    });
  } catch (err) {
    console.warn('[data-audit] failed to log', event.action, err);
  }
}

// Bridge to the legacy script.js so vanilla code can log without imports.
declare global {
  interface Window {
    __audit?: {
      log(event: DataAuditEvent): Promise<void>;
    };
  }
}
window.__audit = { log: logDataEvent };
