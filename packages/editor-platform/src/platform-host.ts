import type { PlatformCapabilities } from './capabilities';
import type { PreferenceStore } from './preference-store';

/**
 * The set of platform services the studio runs against, behind one interface so
 * the same editor code works in a native desktop shell and in a plain browser.
 *
 * A host is created once at startup and injected into the editor — the same
 * dependency-injection seam the renderer backend uses. Editor code talks to
 * this interface and never to a specific platform's API directly.
 */
export interface PlatformHost {
  /** Which environment this host bridges to. Useful for diagnostics and tests. */
  readonly kind: 'browser' | 'tauri';
  /** Which optional capabilities this host provides. */
  readonly capabilities: PlatformCapabilities;
  /** Persistent key/value store. Always present ({@link PlatformCapabilities.preferences}). */
  readonly preferences: PreferenceStore;
}
