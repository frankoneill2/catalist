// Anomaly detection — what makes us require a step-up auth instead of trusting
// a stored session.
//
// Phase 1 covers two signals: time gap (>30 days since last activity on this
// device) and browser fingerprint change. IP-country detection lives in a
// later phase because it needs server-side help.

import { fingerprintChanged, getStoredFingerprint, recordFingerprint } from './device';
import { readSession, REFRESH_MAX_MS } from './session';

export interface AnomalySignals {
  timeGap: boolean;       // last activity > 30 days ago
  fingerprint: boolean;   // browser fingerprint changed
  noPriorBaseline: boolean;
}

export async function detectAnomalies(): Promise<AnomalySignals> {
  const session = readSession();
  const fpStored = await getStoredFingerprint();
  let timeGap = false;
  if (session) {
    timeGap = Date.now() - session.lastActiveAt > REFRESH_MAX_MS;
  }
  const noPriorBaseline = !fpStored;
  const fpChanged = fpStored ? await fingerprintChanged() : false;
  return {
    timeGap,
    fingerprint: fpChanged,
    noPriorBaseline,
  };
}

export function shouldStepUp(signals: AnomalySignals): boolean {
  return signals.timeGap || signals.fingerprint;
}

export async function baselineFingerprint(): Promise<void> {
  await recordFingerprint();
}
