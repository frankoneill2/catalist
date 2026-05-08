// Map Firebase auth error codes to short, user-readable strings.

export function friendlyAuthError(err: unknown): string {
  if (!err || typeof err !== 'object') return 'Something went wrong. Try again.';
  const code = (err as { code?: string }).code;
  switch (code) {
    case 'auth/email-already-in-use':
      return 'That email is already registered. Try signing in instead.';
    case 'auth/invalid-email':
      return 'That doesn\'t look like a valid email.';
    case 'auth/missing-email':
      return 'Enter an email.';
    case 'auth/missing-password':
      return 'Enter a password.';
    case 'auth/weak-password':
      return 'Password must be at least 8 characters.';
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
      return 'Wrong email or password.';
    case 'auth/user-not-found':
      return 'No account with that email.';
    case 'auth/user-disabled':
      return 'This account has been disabled.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Try again in a few minutes.';
    case 'auth/network-request-failed':
      return 'Network problem. Check your connection.';
    case 'auth/requires-recent-login':
      return 'For security, sign in again before changing this.';
    case 'auth/invalid-verification-code':
      return 'That code is wrong or expired.';
    case 'auth/totp-challenge-timeout':
      return 'Took too long. Try again.';
    case 'auth/unverified-email':
      return 'Verify your email first.';
    case 'auth/operation-not-allowed':
      return 'This sign-in method is disabled. Contact support.';
    default:
      if (typeof code === 'string') return code.replace(/^auth\//, '').replace(/-/g, ' ');
      return 'Something went wrong. Try again.';
  }
}
