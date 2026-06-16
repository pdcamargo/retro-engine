import type { PlatformCapabilities } from './capabilities';
import type { PlatformHost } from './platform-host';
import type { PreferenceStore } from './preference-store';

/** A {@link PreferenceStore} backed by the browser's `localStorage`. */
class LocalStoragePreferenceStore implements PreferenceStore {
  async get(key: string): Promise<string | null> {
    return localStorage.getItem(key);
  }

  async set(key: string, value: string): Promise<void> {
    localStorage.setItem(key, value);
  }

  async remove(key: string): Promise<void> {
    localStorage.removeItem(key);
  }
}

/**
 * The {@link PlatformHost} for running the studio in a plain browser.
 *
 * Uses only standard web APIs, so it carries no native dependency and is the
 * default whenever the studio is not inside a desktop shell. Preferences persist
 * via `localStorage`; filesystem and dialog capabilities are unavailable here.
 */
export class BrowserPlatformHost implements PlatformHost {
  readonly kind = 'browser' as const;
  readonly capabilities: PlatformCapabilities = {
    preferences: true,
    filesystem: false,
    dialogs: false,
  };
  readonly preferences: PreferenceStore = new LocalStoragePreferenceStore();
}
