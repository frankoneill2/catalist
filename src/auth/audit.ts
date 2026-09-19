// Append-only auth event log.
//
// Each event is written to users/{uid}/authEvents/{eventId}. Firestore rules
// allow create-only from the owning user, never update or delete. That makes
// the log tamper-evident from the client side; the server-side audit comes
// later in Phase 6.

import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import type { AuthEvent } from './types';
import { getDeviceId } from './device';

import { auth } from './firebase';

export async function logAuthEvent(
  uid: string,
  type: AuthEvent['type'],
  detail?: Record<string, unknown>
): Promise<void> {
  // Only write when we actually have a signed-in Firebase user whose uid
  // matches the one we're logging for — otherwise rules reject the write
  // (correctly: nobody should be writing to /users/{uid}/authEvents without
  // owning that uid). Pre-auth events like signin_failure are logged to the
  // console only for now; Phase 6 will introduce a server-mediated channel
  // for those.
  if (!uid || uid === 'anonymous') {
    console.info('[audit] (no-uid)', type, detail || {});
    return;
  }
  const current = auth.currentUser;
  if (!current || current.uid !== uid) {
    console.info('[audit] (uid-mismatch)', type, detail || {});
    return;
  }
  try {
    await addDoc(collection(db, 'users', uid, 'authEvents'), {
      type,
      uid,
      deviceId: getDeviceId(),
      detail: detail ?? null,
      // serverTimestamp so we can't lie about when something happened
      createdAt: serverTimestamp(),
      // a client-side timestamp too, for ordering before the server stamp resolves
      clientCreatedAt: Date.now(),
    });
  } catch (err) {
    // Audit log failures must not block auth flows. Surface to console only.
    console.warn('[audit] failed to log', type, err);
  }
}
