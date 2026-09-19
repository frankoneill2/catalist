// Tracker for join requests the user has submitted but that haven't yet been
// approved. We need this so the user gets clear visual feedback after the
// QR-scan + PIN flow even when they already had another group to fall back
// to: the AuthGate would otherwise drop them straight into their existing
// dashboard with zero acknowledgement that a new request is in flight.
//
// State lives in localStorage so it survives page reloads — the AuthGate
// reloads after group switches, and join-request approval happens on the
// admin's clock (could be seconds or minutes later).

interface PendingJoin {
  groupId: string;
  groupName: string;
  submittedAt: number;
  // Set once we've shown the user the approval celebration banner so we
  // don't keep popping it on every reload after they've seen it.
  approvalAcknowledged?: boolean;
}

function key(uid: string): string {
  return `catalist.pendingJoins.${uid}`;
}

function readRaw(uid: string): PendingJoin[] {
  try {
    const raw = localStorage.getItem(key(uid));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is PendingJoin =>
        x && typeof x === 'object'
        && typeof x.groupId === 'string'
        && typeof x.groupName === 'string'
        && typeof x.submittedAt === 'number'
    );
  } catch {
    return [];
  }
}

function writeRaw(uid: string, rows: PendingJoin[]): void {
  try {
    if (rows.length === 0) {
      localStorage.removeItem(key(uid));
    } else {
      localStorage.setItem(key(uid), JSON.stringify(rows));
    }
  } catch {
    /* storage quota / private browsing — fail silent */
  }
}

export function recordPendingJoin(
  uid: string,
  groupId: string,
  groupName: string,
): void {
  const rows = readRaw(uid).filter((r) => r.groupId !== groupId);
  rows.push({ groupId, groupName, submittedAt: Date.now() });
  writeRaw(uid, rows);
}

export function listPendingJoins(uid: string): PendingJoin[] {
  return readRaw(uid);
}

export function removePendingJoin(uid: string, groupId: string): void {
  const rows = readRaw(uid).filter((r) => r.groupId !== groupId);
  writeRaw(uid, rows);
}

export function markApprovalAcknowledged(uid: string, groupId: string): void {
  const rows = readRaw(uid).map((r) =>
    r.groupId === groupId ? { ...r, approvalAcknowledged: true } : r
  );
  writeRaw(uid, rows);
}
