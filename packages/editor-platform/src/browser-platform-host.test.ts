import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { BrowserPlatformHost } from './browser-platform-host';

// `bun test` has no DOM, so stand up a minimal in-memory localStorage. Only the
// methods the host touches are implemented.
function installLocalStorageShim(): void {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (key: string): string | null => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key: string, value: string): void => {
      store.set(key, value);
    },
    removeItem: (key: string): void => {
      store.delete(key);
    },
  };
}

describe('BrowserPlatformHost', () => {
  beforeEach(installLocalStorageShim);
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).localStorage;
  });

  it('reports a browser host with the preferences capability only', () => {
    const host = new BrowserPlatformHost();
    expect(host.kind).toBe('browser');
    expect(host.capabilities).toEqual({ preferences: true, filesystem: false, dialogs: false });
  });

  it('round-trips preference values and returns null for missing keys', async () => {
    const { preferences } = new BrowserPlatformHost();

    expect(await preferences.get('layout')).toBeNull();

    await preferences.set('layout', 'ini-blob');
    expect(await preferences.get('layout')).toBe('ini-blob');

    await preferences.set('layout', 'updated');
    expect(await preferences.get('layout')).toBe('updated');

    await preferences.remove('layout');
    expect(await preferences.get('layout')).toBeNull();
  });
});
