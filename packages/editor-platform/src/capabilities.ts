/**
 * Optional capabilities a {@link PlatformHost} may or may not provide,
 * depending on where the studio is running (a native desktop shell vs. a
 * plain browser).
 *
 * Editor code that needs an optional capability checks the matching flag and
 * falls back when it is absent — the same way renderer code gates on backend
 * capabilities. This keeps the browser and desktop targets reachable from one
 * codebase without branching on the host type everywhere.
 */
export interface PlatformCapabilities {
  /**
   * A persistent key/value store for small editor state (window layout, recent
   * selections, simple flags). Backed by `localStorage` in the browser and by
   * native storage on the desktop. Available on every host today.
   */
  readonly preferences: boolean;
  /**
   * Reading and writing files outside the preference store (project assets,
   * scene documents). Native-only for now.
   */
  readonly filesystem: boolean;
  /**
   * Native open/save file dialogs. Native-only for now.
   */
  readonly dialogs: boolean;
}
