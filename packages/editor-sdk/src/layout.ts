import { ImGui } from '@mori2003/jsimgui';

/**
 * Serialize the current UI layout — window positions, sizes, and the full dock
 * tree (splits and tabs) — to an `ini` string. Pair with {@link loadLayout} to
 * persist and restore an editor layout.
 */
export const saveLayout = (): string => ImGui.SaveIniSettingsToMemory();

/**
 * Apply a layout previously produced by {@link saveLayout}. Call once at startup
 * (before the first frame) to seed a default or restored layout; this also marks
 * settings as loaded, so the context will not overwrite it with its own defaults.
 */
export const loadLayout = (ini: string): void => {
  ImGui.LoadIniSettingsFromMemory(ini);
};

/**
 * If the layout changed this frame, hand the new `ini` to `persist` and clear the
 * dirty flag. Call once per frame when persisting layouts; the context sets the
 * flag a short interval after the user moves or docks a window.
 */
export const flushLayoutChange = (persist: (ini: string) => void): void => {
  const io = ImGui.GetIO();
  if (io.WantSaveIniSettings) {
    persist(saveLayout());
    io.WantSaveIniSettings = false;
  }
};
