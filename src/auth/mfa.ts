// TOTP multi-factor enrollment + challenge using Firebase Auth.
//
// Flow:
//   - enroll: get a TotpSecret from the multi-factor session, render its QR
//     code (the secret encodes an otpauth:// URL), user scans into Authy /
//     Google Authenticator / 1Password / etc., types back the 6-digit code
//     to confirm.
//   - challenge: when signInWithEmailAndPassword throws auth/multi-factor-auth-required,
//     the resolver carries the enrolled hints. Pick the TOTP hint, prompt
//     for the 6-digit code, resolve to a fully-signed-in user.

import {
  multiFactor,
  TotpMultiFactorGenerator,
  TotpSecret,
  type MultiFactorError,
  type MultiFactorResolver,
  type MultiFactorInfo,
  type User,
  getMultiFactorResolver,
} from 'firebase/auth';
import { auth } from './firebase';

export interface TotpEnrollment {
  secret: TotpSecret;
  qrCodeUrl: string;          // otpauth://...
  manualKey: string;          // base32 secret for manual entry
}

const ISSUER = 'wardround.app';

export async function beginTotpEnrollment(user: User): Promise<TotpEnrollment> {
  const session = await multiFactor(user).getSession();
  const secret = await TotpMultiFactorGenerator.generateSecret(session);
  const accountName = user.email || user.uid;
  const qrCodeUrl = secret.generateQrCodeUrl(accountName, ISSUER);
  return {
    secret,
    qrCodeUrl,
    manualKey: secret.secretKey,
  };
}

export async function completeTotpEnrollment(
  user: User,
  enrollment: TotpEnrollment,
  code: string,
  displayName = 'Authenticator app'
): Promise<void> {
  const assertion = TotpMultiFactorGenerator.assertionForEnrollment(
    enrollment.secret,
    code.replace(/\s+/g, '')
  );
  await multiFactor(user).enroll(assertion, displayName);
}

export function isMfaEnrolled(user: User): boolean {
  try {
    return multiFactor(user).enrolledFactors.length > 0;
  } catch {
    return false;
  }
}

export function isMfaError(err: unknown): err is MultiFactorError {
  return (
    !!err &&
    typeof err === 'object' &&
    'code' in err &&
    (err as { code: string }).code === 'auth/multi-factor-auth-required'
  );
}

export function getResolver(err: MultiFactorError): MultiFactorResolver {
  return getMultiFactorResolver(auth, err);
}

export function pickTotpHint(resolver: MultiFactorResolver): MultiFactorInfo | null {
  return (
    resolver.hints.find(
      (h) => h.factorId === TotpMultiFactorGenerator.FACTOR_ID
    ) ?? null
  );
}

export async function resolveTotpChallenge(
  resolver: MultiFactorResolver,
  hint: MultiFactorInfo,
  code: string
): Promise<User> {
  const assertion = TotpMultiFactorGenerator.assertionForSignIn(
    hint.uid,
    code.replace(/\s+/g, '')
  );
  const cred = await resolver.resolveSignIn(assertion);
  return cred.user;
}

export async function unenrollMfa(user: User): Promise<void> {
  const factors = multiFactor(user).enrolledFactors;
  for (const f of factors) {
    await multiFactor(user).unenroll(f);
  }
}

