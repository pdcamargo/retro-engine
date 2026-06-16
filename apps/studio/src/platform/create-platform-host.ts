import { BrowserPlatformHost, isTauri, type PlatformHost } from '@retro-engine/editor-platform';

/**
 * Pick the platform host for the current environment and return it.
 *
 * In a desktop shell this lazily imports the Tauri host so `@tauri-apps/api`
 * stays off the browser bundle's boot path; in a plain browser it returns the
 * web host synchronously (the dynamic import is never reached).
 */
export async function createPlatformHost(): Promise<PlatformHost> {
  if (isTauri()) {
    const { TauriPlatformHost } = await import('./tauri-platform-host');
    return new TauriPlatformHost();
  }
  return new BrowserPlatformHost();
}
