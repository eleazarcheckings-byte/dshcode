/**
 * Persists the device session established by the pairing exchange
 * (`POST <url>/saturn/remote/pair` -> `{ deviceToken, sessionCookieName }`).
 *
 * The storage backend is injected so this is unit-testable without the
 * Capacitor runtime; `src/lib/capacitorStorage.ts` supplies the real
 * `@capacitor/preferences`-backed adapter used on-device.
 */

export interface KeyValueStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface DeviceSession {
  deviceToken: string;
  sessionCookieName: string;
  hostUrl: string;
  hostName: string;
  fingerprint?: string;
  pairedAt: string;
}

const STORAGE_KEY = 'saturn.remote.session';

function isDeviceSession(value: unknown): value is DeviceSession {
  if (typeof value !== 'object' || value === null) return false;
  const rec = value as Record<string, unknown>;
  return (
    typeof rec.deviceToken === 'string' &&
    rec.deviceToken.length > 0 &&
    typeof rec.sessionCookieName === 'string' &&
    typeof rec.hostUrl === 'string' &&
    rec.hostUrl.length > 0 &&
    typeof rec.hostName === 'string' &&
    typeof rec.pairedAt === 'string' &&
    (rec.fingerprint === undefined || typeof rec.fingerprint === 'string')
  );
}

export class TokenStore {
  constructor(private readonly storage: KeyValueStorage) {}

  async save(session: DeviceSession): Promise<void> {
    await this.storage.set(STORAGE_KEY, JSON.stringify(session));
  }

  async load(): Promise<DeviceSession | null> {
    const raw = await this.storage.get(STORAGE_KEY);
    if (!raw) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    return isDeviceSession(parsed) ? parsed : null;
  }

  async clear(): Promise<void> {
    await this.storage.remove(STORAGE_KEY);
  }
}

/** In-memory storage used by tests and as a safe fallback if Preferences is unavailable. */
export class MemoryStorage implements KeyValueStorage {
  private readonly map = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }

  async set(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.map.delete(key);
  }
}
