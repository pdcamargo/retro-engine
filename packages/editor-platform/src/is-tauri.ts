/**
 * Whether the code is running inside a Tauri desktop shell rather than a plain
 * browser.
 *
 * The check is a plain global lookup so this package stays free of any Tauri
 * dependency — callers use it to decide which {@link PlatformHost} to build
 * without pulling native bindings into a browser bundle. Tauri exposes its
 * bridge on `globalThis.__TAURI_INTERNALS__`; the absence of that global is
 * what makes a browser a browser here.
 */
export function isTauri(): boolean {
  return typeof globalThis !== 'undefined' && '__TAURI_INTERNALS__' in globalThis;
}
