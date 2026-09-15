import { Preferences } from '@capacitor/preferences';
import type { KeyValueStorage } from './tokenStore.js';

/** `@capacitor/preferences`-backed storage: the on-device counterpart to `MemoryStorage` (tests use the latter). */
export class CapacitorPreferencesStorage implements KeyValueStorage {
  async get(key: string): Promise<string | null> {
    const { value } = await Preferences.get({ key });
    return value;
  }

  async set(key: string, value: string): Promise<void> {
    await Preferences.set({ key, value });
  }

  async remove(key: string): Promise<void> {
    await Preferences.remove({ key });
  }
}
