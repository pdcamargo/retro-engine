// The native (Tauri) PlatformHost. This is the ONLY module in the studio that
// imports @tauri-apps/api, and it is reached solely through the lazy dynamic
// import in create-platform-host.ts — so a plain-browser bundle never pulls the
// native bridge onto its boot path. The matching Rust commands (pref_get /
// pref_set / pref_remove) live in src-tauri/src/lib.rs.

import type { PlatformCapabilities, PlatformHost, PreferenceStore } from '@retro-engine/editor-platform';
import { invoke } from '@tauri-apps/api/core';

import { setNativeProjectRoot } from '../project/tauri-project-io';

class TauriPreferenceStore implements PreferenceStore {
  async get(key: string): Promise<string | null> {
    return invoke<string | null>('pref_get', { key });
  }

  async set(key: string, value: string): Promise<void> {
    await invoke('pref_set', { key, value });
  }

  async remove(key: string): Promise<void> {
    await invoke('pref_remove', { key });
  }
}

export class TauriPlatformHost implements PlatformHost {
  readonly kind = 'tauri' as const;
  readonly capabilities: PlatformCapabilities = {
    preferences: true,
    filesystem: true,
    dialogs: true,
  };
  readonly preferences: PreferenceStore = new TauriPreferenceStore();

  async openProject(): Promise<string | null> {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const picked = await open({ directory: true, multiple: false, title: 'Open Retro Engine project' });
    if (typeof picked !== 'string') return null;
    await setNativeProjectRoot(picked);
    return picked;
  }
}
