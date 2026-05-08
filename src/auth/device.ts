// Device identification + browser fingerprinting.
//
// "device" here is really "this browser on this machine". A new browser, a
// cleared profile, or a different OS user gets a new device record.

const DEVICE_ID_KEY = 'catalist.deviceId';
const DEVICE_NAME_KEY = 'catalist.deviceName';
const FINGERPRINT_KEY = 'catalist.fingerprint';

function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bufToHex(digest);
}

export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    id = bufToHex(bytes.buffer);
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

export function getDeviceName(): string {
  const stored = localStorage.getItem(DEVICE_NAME_KEY);
  if (stored) return stored;
  const ua = navigator.userAgent;
  let os = 'Unknown OS';
  if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS';
  else if (/Linux/.test(ua)) os = 'Linux';
  let browser = 'Browser';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) browser = 'Safari';
  const name = `${browser} on ${os}`;
  localStorage.setItem(DEVICE_NAME_KEY, name);
  return name;
}

export function setDeviceName(name: string): void {
  localStorage.setItem(DEVICE_NAME_KEY, name);
}

// Stable enough to flag big jumps (different browser, different machine,
// different screen). Not stable enough to defeat a determined attacker —
// that's not the point. The point is "did the environment change in a way
// that warrants a step-up auth?"
async function computeFingerprint(): Promise<string> {
  const parts = [
    navigator.userAgent,
    navigator.language,
    String(screen.width),
    String(screen.height),
    String(screen.colorDepth),
    Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    String(navigator.hardwareConcurrency || 0),
  ];
  return sha256Hex(parts.join('|'));
}

export async function getStoredFingerprint(): Promise<string | null> {
  return localStorage.getItem(FINGERPRINT_KEY);
}

export async function recordFingerprint(): Promise<string> {
  const fp = await computeFingerprint();
  localStorage.setItem(FINGERPRINT_KEY, fp);
  return fp;
}

export async function fingerprintChanged(): Promise<boolean> {
  const stored = await getStoredFingerprint();
  if (!stored) return false; // first visit, not an anomaly
  const current = await computeFingerprint();
  return stored !== current;
}
