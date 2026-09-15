/**
 * Parses and validates the QR pairing payload from SPEC §8's binding pairing
 * contract (M1 <-> M3): `{ v, name, url, token, fingerprint?, expires }`.
 *
 * LAN-mode payloads (a bare LAN IP url) must carry a certificate fingerprint
 * so the app can pin the self-signed cert; tunnel-mode payloads (a
 * `*.trycloudflare.com` url) rely on cloudflared's own TLS and omit it.
 */

export interface PairingPayload {
  v: 1;
  name: string;
  url: string;
  token: string;
  fingerprint?: string;
  expires: string;
}

export class PairingPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PairingPayloadError';
  }
}

const REQUIRED_STRING_FIELDS = ['name', 'url', 'token', 'expires'] as const;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/i;
const TUNNEL_HOST_PATTERN = /\.trycloudflare\.com$/i;

function isTunnelUrl(url: string): boolean {
  try {
    return TUNNEL_HOST_PATTERN.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function parsePairingPayload(raw: string): PairingPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new PairingPayloadError('pairing QR payload is not valid JSON');
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new PairingPayloadError('pairing QR payload must be a JSON object');
  }
  const rec = parsed as Record<string, unknown>;

  if (rec.v !== 1) {
    throw new PairingPayloadError(`unsupported pairing version: ${JSON.stringify(rec.v)}`);
  }

  for (const field of REQUIRED_STRING_FIELDS) {
    if (typeof rec[field] !== 'string' || (rec[field] as string).length === 0) {
      throw new PairingPayloadError(`missing or invalid field: ${field}`);
    }
  }

  const url = rec.url as string;
  if (!/^https:\/\//i.test(url)) {
    throw new PairingPayloadError('pairing url must be https');
  }

  const expires = rec.expires as string;
  if (Number.isNaN(Date.parse(expires))) {
    throw new PairingPayloadError('expires is not a valid ISO date');
  }

  let fingerprint: string | undefined;
  if (rec.fingerprint !== undefined) {
    if (typeof rec.fingerprint !== 'string' || !FINGERPRINT_PATTERN.test(rec.fingerprint)) {
      throw new PairingPayloadError('fingerprint must be a 64-character hex sha256 digest');
    }
    fingerprint = rec.fingerprint.toLowerCase();
  }

  if (!isTunnelUrl(url) && !fingerprint) {
    throw new PairingPayloadError('LAN pairing payloads must include a certificate fingerprint');
  }

  return {
    v: 1,
    name: rec.name as string,
    url,
    token: rec.token as string,
    fingerprint,
    expires,
  };
}

export function isPairingExpired(payload: PairingPayload, now: Date = new Date()): boolean {
  return Date.parse(payload.expires) <= now.getTime();
}

export interface PairingDevice {
  name: string;
  platform: 'ios' | 'android';
}

export function buildPairRequestBody(
  payload: PairingPayload,
  device: PairingDevice,
): { token: string; device: PairingDevice } {
  return { token: payload.token, device };
}
