import { ImGui, ImGuiConfigFlags } from '@mori2003/jsimgui';

/**
 * Turn on Dear ImGui docking for the active context: windows can be dragged into
 * each other and into a host dockspace (see {@link Ui.dockSpaceOverViewport}).
 *
 * Sets a global IO flag, so call it once after the overlay is initialized — the
 * {@link uiOverlayPlugin} does this when constructed with `docking: true`.
 */
export const enableDocking = (): void => {
  const io = ImGui.GetIO();
  io.ConfigFlags |= ImGuiConfigFlags.DockingEnable;
};

/** Whether docking is currently enabled on the active context. */
export const isDockingEnabled = (): boolean =>
  (ImGui.GetIO().ConfigFlags & ImGuiConfigFlags.DockingEnable) !== 0;
