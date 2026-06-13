import { ImGui, ImGuiCond, ImGuiDockNodeFlags, ImVec2, ImVec4 } from '@mori2003/jsimgui';

import type { Rgb, Rgba, Vec2 } from './units';

/** Options for {@link Ui.window}. */
export interface WindowOptions {
  /** Title bar text and the window's stable identity. */
  readonly title: string;
  /** Initial top-left position in pixels, applied only on first appearance. */
  readonly pos?: Vec2;
  /** Initial size in pixels, applied only on first appearance. */
  readonly size?: Vec2;
  /**
   * Dock this window into the node with this id on first appearance (e.g. the id
   * returned by {@link Ui.dockSpaceOverViewport}). Requires docking to be enabled.
   * Once docked the user can drag it elsewhere.
   */
  readonly dock?: number;
}

/** Options for {@link Ui.dragFloat}. */
export interface DragFloatOptions {
  /** Drag sensitivity per pixel. */
  readonly speed?: number;
  /** Inclusive lower bound. */
  readonly min?: number;
  /** Inclusive upper bound. */
  readonly max?: number;
}

/**
 * The normalized immediate-mode UI surface. Build UI by calling these methods
 * each frame inside a {@link uiOverlayPlugin} draw callback; widgets that edit a
 * value take the current value and return the next one, so state stays in your
 * own data. This is the only supported UI surface — the underlying binding is
 * never exposed.
 */
export interface Ui {
  /**
   * Open a window, run `body` to fill it, and close it. `body` runs only when
   * the window is expanded, but the window is always opened and closed
   * correctly regardless.
   */
  window(options: WindowOptions, body: () => void): void;
  /** A line of text. */
  text(value: string): void;
  /** A line of dimmed/secondary text. */
  textDisabled(value: string): void;
  /** A line of text in an explicit color. */
  textColored(color: Rgba, value: string): void;
  /** A clickable button. Returns `true` on the frame it is clicked. */
  button(label: string, size?: Vec2): boolean;
  /** A checkbox. Returns the next checked state. */
  checkbox(label: string, value: boolean): boolean;
  /** A horizontal slider over `[min, max]`. Returns the next value. */
  sliderFloat(label: string, value: number, min: number, max: number): number;
  /** A click-drag numeric field. Returns the next value. */
  dragFloat(label: string, value: number, options?: DragFloatOptions): number;
  /** An RGB color swatch + editor. Returns the next color. */
  colorEdit3(label: string, value: Rgb): Rgb;
  /** A horizontal rule. */
  separator(): void;
  /** Continue the next widget on the same line as the previous one. */
  sameLine(): void;
  /** Vertical spacing between widgets. */
  spacing(): void;
  /** The built-in Dear ImGui demo window — handy while bringing UI up. */
  demoWindow(): void;
  /**
   * Emit a full-viewport host dockspace that windows can dock into, and return
   * its node id (pass it as {@link WindowOptions.dock}). The empty center is
   * transparent, so the engine render shows through where nothing is docked.
   * Call once per frame, before the windows that dock into it. Requires docking
   * to be enabled (see `enableDocking`).
   */
  dockSpaceOverViewport(): number;
  /** Whether the window currently being built is docked. Call inside a window body. */
  isWindowDocked(): boolean;
}

/**
 * The normalized immediate-mode UI surface. Stateless: every call forwards to
 * the active UI context, so it is safe to share a single instance.
 */
export const ui: Ui = {
  window(options: WindowOptions, body: () => void): void {
    if (options.pos !== undefined) {
      ImGui.SetNextWindowPos(new ImVec2(options.pos[0], options.pos[1]), ImGuiCond.FirstUseEver);
    }
    if (options.size !== undefined) {
      ImGui.SetNextWindowSize(new ImVec2(options.size[0], options.size[1]), ImGuiCond.FirstUseEver);
    }
    if (options.dock !== undefined) {
      ImGui.SetNextWindowDockID(options.dock, ImGuiCond.FirstUseEver);
    }
    const expanded = ImGui.Begin(options.title);
    if (expanded) body();
    ImGui.End();
  },

  text(value: string): void {
    ImGui.Text(value);
  },

  textDisabled(value: string): void {
    ImGui.TextDisabled(value);
  },

  textColored(color: Rgba, value: string): void {
    ImGui.TextColored(new ImVec4(color[0], color[1], color[2], color[3]), value);
  },

  button(label: string, size?: Vec2): boolean {
    return size === undefined
      ? ImGui.Button(label)
      : ImGui.Button(label, new ImVec2(size[0], size[1]));
  },

  checkbox(label: string, value: boolean): boolean {
    const ref: [boolean] = [value];
    ImGui.Checkbox(label, ref);
    return ref[0];
  },

  sliderFloat(label: string, value: number, min: number, max: number): number {
    const ref: [number] = [value];
    ImGui.SliderFloat(label, ref, min, max);
    return ref[0];
  },

  dragFloat(label: string, value: number, options?: DragFloatOptions): number {
    const ref: [number] = [value];
    ImGui.DragFloat(label, ref, options?.speed, options?.min, options?.max);
    return ref[0];
  },

  colorEdit3(label: string, value: Rgb): Rgb {
    const ref: [number, number, number] = [value[0], value[1], value[2]];
    ImGui.ColorEdit3(label, ref);
    return [ref[0], ref[1], ref[2]];
  },

  separator(): void {
    ImGui.Separator();
  },

  sameLine(): void {
    ImGui.SameLine();
  },

  spacing(): void {
    ImGui.Spacing();
  },

  demoWindow(): void {
    ImGui.ShowDemoWindow();
  },

  dockSpaceOverViewport(): number {
    return ImGui.DockSpaceOverViewport(0, null, ImGuiDockNodeFlags.PassthruCentralNode);
  },

  isWindowDocked(): boolean {
    return ImGui.IsWindowDocked();
  },
};
