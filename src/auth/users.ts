// User profile document (users/{uid}) — created at signup, kept in sync.

import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { db } from './firebase';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  acceptedTermsAt?: number;
  termsVersion?: string;
  createdAt?: number;
  updatedAt?: number;
}

export const TERMS_VERSION = '2026-05-03';

function userRef(uid: string) {
  return doc(db, 'users', uid);
}

export async function ensureUserProfile(
  uid: string,
  data: Partial<UserProfile>
): Promise<void> {
  const ref = userRef(uid);
  const snap = await getDoc(ref);
  const now = Date.now();
  // `username` is the field the legacy app indexes on for the user dropdown
  // and the per-task assignee. Mirroring displayName into it keeps Phase-1
  // accounts visible to the legacy code that hasn't been rewritten yet
  // (Phase 4 removes the dropdown entirely).
  const displayName = data.displayName ?? '';
  if (!snap.exists()) {
    await setDoc(ref, {
      uid,
      email: data.email ?? '',
      displayName,
      username: displayName,
      acceptedTermsAt: data.acceptedTermsAt ?? null,
      termsVersion: data.termsVersion ?? null,
      createdAt: serverTimestamp(),
      createdAtClient: now,
      updatedAt: serverTimestamp(),
      updatedAtClient: now,
    });
  } else {
    const update: Record<string, unknown> = { updatedAt: serverTimestamp(), updatedAtClient: now };
    if (data.email !== undefined) update.email = data.email;
    if (data.displayName !== undefined) {
      update.displayName = data.displayName;
      update.username = data.displayName;
    } else {
      // Backfill username for accounts that were created before this mirroring
      // was added (so they show up in the legacy dropdown without forcing a
      // re-signup).
      const existing = snap.data() as Record<string, unknown>;
      if (!existing.username && existing.displayName) {
        update.username = existing.displayName;
      }
    }
    if (data.acceptedTermsAt !== undefined) update.acceptedTermsAt = data.acceptedTermsAt;
    if (data.termsVersion !== undefined) update.termsVersion = data.termsVersion;
    await updateDoc(ref, update);
  }
}

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const snap = await getDoc(userRef(uid));
  if (!snap.exists()) return null;
  const data = snap.data() as Record<string, unknown>;
  return {
    uid,
    email: String(data.email || ''),
    displayName: String(data.displayName || ''),
    acceptedTermsAt: typeof data.acceptedTermsAt === 'number' ? (data.acceptedTermsAt as number) : undefined,
    termsVersion: typeof data.termsVersion === 'string' ? (data.termsVersion as string) : undefined,
  };
}

// Best-effort batch lookup for the membership UI. Returns a Map keyed by
// uid; missing uids are simply absent from the map (caller falls back to
// the uid string or "Unknown" as it sees fit). Reads /users/{uid} for each
// — that path is open to any signed-in user by rule, so this works for
// resolving names of every member in any group the caller can see.
export async function resolveDisplayNames(uids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = Array.from(new Set(uids.filter((u) => !!u)));
  await Promise.all(
    unique.map(async (uid) => {
      try {
        const snap = await getDoc(userRef(uid));
        if (!snap.exists()) return;
        const data = snap.data() as Record<string, unknown>;
        const name = String(data.displayName || data.username || data.email || '').trim();
        if (name) out.set(uid, name);
      } catch {
        /* ignore — caller will fall back */
      }
    })
  );
  return out;
}
