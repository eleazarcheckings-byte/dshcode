/**
 * Constant-time SHA-256 fingerprint comparison for the SPEC §8 LAN pairing
 * contract (`fingerprint` = "sha256 of the self-signed cert, hex").
 *
 * This module is the shared, testable comparator. The actual TLS
 * interception that calls it is native and platform-specific:
 *  - Android: `MainActivity`'s WebViewClient.onReceivedSslError (see
 *    android/app/src/main/java/.../MainActivity.java after `cap add android`).
 *  - iOS: a WKNavigationDelegate's `didReceive challenge` handler (documented
 *    in README.md's Mac steps — cannot be built on this machine).
 */

export function normalizeFingerprint(fingerprint: string): string {
  return fingerprint.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
}

export function fingerprintsMatch(expected: string, observed: string): boolean {
  const a = normalizeFingerprint(expected);
  const b = normalizeFingerprint(observed);
  if (a.length !== 64 || b.length !== 64) return false;

  // Constant-time compare: don't let the comparison itself leak how many
  // leading bytes matched via early return timing.
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
