import {
  ImGui,
  ImGuiChildFlags,
  ImGuiCond,
  ImGuiDockNodeFlags,
  ImGuiStyleVar,
  ImGuiWindowFlags,
  ImVec2,
  ImVec4,
} from '@mori2003/jsimgui';

import {
  beginDragSource,
  type DragSourceOptions,
  type DropTargetOptions,
  handleDropTarget,
} from './dnd/dnd-ui';
import type { DragPayload } from './dnd/drag-payload';
import type { ItemEdges } from './edit/emitter';
import { getFont } from './fonts';
import { drawIcon } from './icon-shapes';
import type { IconName } from './icons';
import { getActivePalette, packU32 } from './palette';
import type { Rgb, Rgba, Vec2 } from './units';

const v2 = (p: Vec2): ImVec2 => new ImVec2(p[0], p[1]);
const toVec2 = (v: ImVec2): Vec2 => [v.x, v.y];

/** Per-glyph advance as a fraction of font size for the monospace UI font (JetBrains Mono ≈ 0.6em). */
const MONO_ADVANCE = 0.6;

/** Per-window chrome toggles for {@link Ui.window}, mapped to native window flags. */
export interface WindowFlags {
  readonly noTitleBar?: boolean;
  readonly noResize?: boolean;
  readonly noMove?: boolean;
  readonly noScrollbar?: boolean;
  readonly noScrollWithMouse?: boolean;
  readonly noCollapse?: boolean;
  readonly noBackground?: boolean;
  readonly noDocking?: boolean;
  readonly noSavedSettings?: boolean;
  readonly noBringToFrontOnFocus?: boolean;
  readonly noNavFocus?: boolean;
  readonly menuBar?: boolean;
  readonly alwaysAutoResize?: boolean;
}

const windowFlags = (f: WindowFlags | undefined): number => {
  if (f === undefined) return 0;
  let flags = 0;
  const F = ImGuiWindowFlags;
  if (f.noTitleBar) flags |= F.NoTitleBar;
  if (f.noResize) flags |= F.NoResize;
  if (f.noMove) flags |= F.NoMove;
  if (f.noScrollbar) flags |= F.NoScrollbar;
  if (f.noScrollWithMouse) flags |= F.NoScrollWithMouse;
  if (f.noCollapse) flags |= F.NoCollapse;
  if (f.noBackground) flags |= F.NoBackground;
  if (f.noDocking) flags |= F.NoDocking;
  if (f.noSavedSettings) flags |= F.NoSavedSettings;
  if (f.noBringToFrontOnFocus) flags |= F.NoBringToFrontOnFocus;
  if (f.noNavFocus) flags |= F.NoNavFocus;
  if (f.menuBar) flags |= F.MenuBar;
  if (f.alwaysAutoResize) flags |= F.AlwaysAutoResize;
  return flags;
};

/** Options for {@link Ui.window}. */
export interface WindowOptions extends WindowFlags {
  /** Title bar text and the window's stable identity. */
  readonly title: string;
  /** Initial top-left position in pixels, applied only on first appearance. */
  readonly pos?: Vec2;
  /** Forced position every frame (for pinned chrome like toolbars / status bars). */
  readonly fixedPos?: Vec2;
  /** Initial size in pixels, applied only on first appearance. */
  readonly size?: Vec2;
  /** Forced size every frame (for pinned chrome). */
  readonly fixedSize?: Vec2;
  /**
   * Dock this window into the node with this id on first appearance. Requires
   * docking to be enabled. Once docked the user can drag it elsewhere.
   */
  readonly dock?: number;
  /** Override the window's inner padding (e.g. `[0, 0]` for trees/tables that manage their own). */
  readonly padding?: Vec2;
  /**
   * Show a close button. Called on the frame the user clicks it. The window is
   * still opened/closed correctly this frame.
   */
  readonly onClose?: () => void;
}

/** Options for {@link Ui.dragFloat}. */
export interface DragFloatOptions {
  /** Drag sensitivity per pixel. */
  readonly speed?: number;
  /** Inclusive lower bound. */
  readonly min?: number;
  /** Inclusive upper bound. */
  readonly max?: number;
  /** `printf`-style display format, e.g. `'%.2f'`. */
  readonly format?: string;
}

/** Options for {@link Ui.child}. */
export interface ChildOptions {
  /** Region size; `0` on an axis fills the remaining space. */
  readonly size?: Vec2;
  /** Draw the 1px child border. */
  readonly border?: boolean;
  /** Hide the vertical scrollbar. */
  readonly noScrollbar?: boolean;
  /** Override inner padding (e.g. `[0, 0]` for flush content). */
  readonly padding?: Vec2;
}

/** Options for {@link Ui.inputText}. */
export interface InputTextOptions {
  /** Greyed placeholder shown when empty (rendered via hint). */
  readonly hint?: string;
  /** Mask the input. */
  readonly password?: boolean;
  /** Disallow edits. */
  readonly readOnly?: boolean;
  /** Width in pixels; defaults to the available content width. */
  readonly width?: number;
  /** A leading icon drawn inside the field on the left; text is inset past it (e.g. a search glyph). */
  readonly icon?: IconName | (string & {});
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
  /**
   * A bordered, optionally-scrolling child region. `body` always runs; returns
   * nothing — pair size/padding via {@link ChildOptions}.
   */
  child(id: string, options: ChildOptions, body: () => void): void;
  /** Group the widgets emitted by `body` into a single layout item. */
  group(body: () => void): void;
  /** Scope an id around `body` so identical child labels stay unique. */
  withId(id: string, body: () => void): void;
  /** Run `body` with an overridden item spacing (e.g. `0,0` for contiguous list rows). */
  withItemSpacing(x: number, y: number, body: () => void): void;
  /** Run `body` with widgets greyed and non-interactive when `disabled` is true (a read-only view). */
  withDisabled(disabled: boolean, body: () => void): void;

  /** A line of text. */
  text(value: string): void;
  /** A line of dimmed/secondary text. */
  textDisabled(value: string): void;
  /** A line of muted (label-weight) text. */
  textMuted(value: string): void;
  /** A line of text in an explicit color. */
  textColored(color: Rgba, value: string): void;
  /** Wrapping text. */
  textWrapped(value: string): void;
  /** A horizontal rule with a centered label. */
  separatorText(label: string): void;
  /** A single icon glyph (from the merged icon font), optionally tinted. */
  icon(name: IconName | (string & {}), color?: Rgba): void;

  /** A clickable button. Returns `true` on the frame it is clicked. */
  button(label: string, size?: Vec2): boolean;
  /** A borderless region that reports clicks/hover — the base for custom-drawn controls. */
  invisibleButton(id: string, size: Vec2): boolean;
  /** A checkbox. Returns the next checked state. */
  checkbox(label: string, value: boolean): boolean;
  /** A radio button. Returns `true` when picked this frame. */
  radio(label: string, active: boolean): boolean;
  /** A selectable row. Returns `true` on the frame it is clicked. */
  selectable(label: string, selected?: boolean, size?: Vec2): boolean;
  /** A horizontal slider over `[min, max]`. Returns the next value. */
  sliderFloat(label: string, value: number, min: number, max: number): number;
  /** A click-drag numeric field. Returns the next value. */
  dragFloat(label: string, value: number, options?: DragFloatOptions): number;
  /** A single-line text field. Returns the next string. */
  inputText(label: string, value: string, options?: InputTextOptions): string;
  /** An integer field with ± steppers. Returns the next value. */
  inputInt(label: string, value: number, step?: number, stepFast?: number): number;
  /** An RGB color swatch + editor. Returns the next color. */
  colorEdit3(label: string, value: Rgb): Rgb;
  /** An RGBA color swatch + editor. Returns the next color. */
  colorEdit4(label: string, value: Rgba): Rgba;

  /** A horizontal rule. */
  separator(): void;
  /**
   * Continue the next widget on the same line. `offsetX` sets an absolute local x
   * (0 = default flow); `spacing` overrides the gap from the previous item
   * (0 = flush).
   */
  sameLine(offsetX?: number, spacing?: number): void;
  /** Vertical spacing between widgets. */
  spacing(): void;
  /** An empty layout item of the given size. */
  dummy(size: Vec2): void;
  /** Vertically center the next text to match a following framed widget. */
  alignTextToFramePadding(): void;
  /** Indent subsequent items. */
  indent(width?: number): void;
  /** Remove one level of indent. */
  unindent(width?: number): void;
  /** Position the next widget so it ends flush with the right edge of the content region. */
  rightAlign(width: number): void;
  /** Set the width of the next item in pixels (negative measures from the right edge). */
  setNextItemWidth(width: number): void;
  /**
   * Focus the keyboard on a following widget. `offset` selects which item ahead
   * to focus (`0` = the next widget, the default) — call right before an
   * {@link Ui.inputText} to auto-focus it when a popup opens.
   */
  setKeyboardFocusHere(offset?: number): void;

  /** Open a named popup (call once, e.g. from a custom button's click). */
  openPopup(id: string): void;
  /** Render `body` while the named popup is open (a floating menu anchored to the caller). */
  popup(id: string, body: () => void): void;
  /** Close the current popup from within its body (e.g. after a menu choice). */
  closePopup(): void;

  /** Whether the last item is hovered. */
  isItemHovered(): boolean;
  /** Whether the last item is held down. */
  isItemActive(): boolean;
  /** Whether the last item was clicked this frame (button 0 by default). */
  isItemClicked(button?: number): boolean;
  /** Whether the last item began interaction this frame (a drag/scrub started). */
  isItemActivated(): boolean;
  /** Whether the last item ended interaction this frame after an edit (drag released, field blurred). */
  isItemDeactivatedAfterEdit(): boolean;
  /** Whether the last item ended interaction this frame (blur without edit, e.g. Escape). */
  isItemDeactivated(): boolean;
  /** Whether the last item's value changed this frame. */
  isItemEdited(): boolean;
  /** The last item's interaction edges in one read — for coalescing a scrub into a single undo step. */
  itemEdges(): ItemEdges;
  /** The last item's bounding rect in screen space, as `[min, max]`. */
  itemRect(): readonly [Vec2, Vec2];

  /** A terse hover tooltip for the last item. */
  setItemTooltip(text: string): void;

  /**
   * Mark the last-submitted item as a drag source carrying `payload`. Call
   * immediately after submitting the item. Returns `true` on frames the drag is
   * active. This is the general editor drag primitive — see {@link Ui.dropTarget}.
   */
  dragSource(payload: DragPayload, options?: DragSourceOptions): boolean;
  /**
   * Mark the last-submitted item as a drop target. While a compatible editor drag
   * hovers it an accept/reject highlight is drawn; on release over an accepted
   * target, `options.onDrop` fires with the payload. Call immediately after the item.
   */
  dropTarget(options: DropTargetOptions): void;

  /** The width of the content region remaining on the current line/column. */
  contentAvail(): Vec2;
  /** The standard framed-widget height for the current style/font. */
  frameHeight(): number;
  /** The current font's line height. */
  textLineHeight(): number;
  /** The rendered size of `text` in the current font. */
  calcTextSize(text: string): Vec2;
  /** The cursor position in screen space (where the next item draws). */
  cursorScreenPos(): Vec2;
  /** Move the cursor to an absolute screen position. */
  setCursorScreenPos(pos: Vec2): void;
  /** The cursor x within the current window's local coordinates. */
  cursorPosX(): number;
  /** Set the cursor x within the current window's local coordinates. */
  setCursorPosX(x: number): void;

  /**
   * Run `body` with a registered font active at `sizePixels`. If no font is
   * registered under `name`, `body` still runs in the current font. Use for
   * headings or the pixel display face (e.g. `ui.withFont('pixel', 16, ...)`).
   */
  withFont(name: string, sizePixels: number, body: () => void): void;
  /** The built-in Dear ImGui demo window — handy while bringing UI up. */
  demoWindow(): void;
  /**
   * Emit a full-viewport host dockspace that windows can dock into, and return
   * its node id (pass it as {@link WindowOptions.dock}). The empty center is
   * transparent, so the engine render shows through where nothing is docked.
   */
  dockSpaceOverViewport(): number;
  /**
   * Emit a dockspace with a fixed id inside the current window (the editor shell
   * uses this so toolbars/status bars can sit outside it). The empty center is
   * transparent. Windows bind to its nodes via the saved layout.
   */
  dockSpace(id: number): void;
  /** Whether the window currently being built is docked. Call inside a window body. */
  isWindowDocked(): boolean;
  /** The mouse position in screen space. */
  mousePos(): Vec2;
  /** The current window's top-left in screen space. Call inside a window body. */
  windowPos(): Vec2;
  /**
   * The mouse position relative to the current window's top-left — `(0, 0)` at
   * the window's top-left corner, growing right/down. Call inside a window body.
   */
  windowMousePos(): Vec2;
  /**
   * Whether the current window is hovered. Call inside a window body. Pass
   * `ImGuiHoveredFlags` (e.g. child-window / allow-when-blocked) when needed.
   */
  isWindowHovered(flags?: number): boolean;
  /** Whether the current window is focused. Call inside a window body. */
  isWindowFocused(flags?: number): boolean;
  /** Vertical mouse-wheel delta this frame (positive = scroll up / zoom in). */
  mouseWheel(): number;
  /** Whether a mouse button is currently held (default: left). */
  isMouseDown(button?: number): boolean;
  /** Whether a mouse button was pressed this frame (default: left). */
  isMouseClicked(button?: number): boolean;
  /** Whether a mouse button was released this frame (default: left). */
  isMouseReleased(button?: number): boolean;
  /** Whether a mouse button was double-clicked this frame (default: left). */
  isMouseDoubleClicked(button?: number): boolean;
  /** Whether a mouse button is being dragged past a small threshold (default: left). */
  isMouseDragging(button?: number, threshold?: number): boolean;
  /** Drag delta for a mouse button since the drag began (default: left). */
  mouseDragDelta(button?: number): Vec2;
  /** Reset a mouse button's drag delta accumulator (default: left). */
  resetMouseDragDelta(button?: number): void;
  /** Whether a key (see {@link Keys}) was pressed this frame; `repeat` enables key-repeat. */
  isKeyPressed(key: number, repeat?: boolean): boolean;
  /** Whether a key (see {@link Keys}) is currently held. */
  isKeyDown(key: number): boolean;
  /** Whether a Ctrl key is held (Cmd is reported here too on macOS via the super mapping). */
  keyCtrl(): boolean;
  /** Whether a Shift key is held. */
  keyShift(): boolean;
  /** Whether an Alt/Option key is held. */
  keyAlt(): boolean;
}

/** Common `ImGuiKey` codes for {@link Ui.isKeyPressed} / {@link Ui.isKeyDown}. */
export const Keys = {
  LeftArrow: 513,
  RightArrow: 514,
  UpArrow: 515,
  DownArrow: 516,
  Delete: 522,
  Backspace: 523,
  Space: 524,
  Enter: 525,
  Escape: 526,
  A: 546,
  F: 551,
  F2: 573,
} as const;

const colored = (color: Rgba, value: string): void => {
  ImGui.TextColored(new ImVec4(color[0], color[1], color[2], color[3]), value);
};

/**
 * The normalized immediate-mode UI surface. Stateless: every call forwards to
 * the active UI context, so it is safe to share a single instance.
 */
export const ui: Ui = {
  window(options: WindowOptions, body: () => void): void {
    if (options.pos !== undefined) {
      ImGui.SetNextWindowPos(v2(options.pos), ImGuiCond.FirstUseEver);
    }
    if (options.fixedPos !== undefined) {
      ImGui.SetNextWindowPos(v2(options.fixedPos), ImGuiCond.Always);
    }
    if (options.size !== undefined) {
      ImGui.SetNextWindowSize(v2(options.size), ImGuiCond.FirstUseEver);
    }
    if (options.fixedSize !== undefined) {
      ImGui.SetNextWindowSize(v2(options.fixedSize), ImGuiCond.Always);
    }
    if (options.dock !== undefined) {
      ImGui.SetNextWindowDockID(options.dock, ImGuiCond.FirstUseEver);
    }
    const pad = options.padding;
    if (pad !== undefined) ImGui.PushStyleVarImVec2(ImGuiStyleVar.WindowPadding, v2(pad));
    const open: [boolean] | null = options.onClose !== undefined ? [true] : null;
    const expanded = ImGui.Begin(options.title, open, windowFlags(options));
    if (expanded) body();
    ImGui.End();
    if (pad !== undefined) ImGui.PopStyleVar();
    if (open !== null && !open[0]) options.onClose?.();
  },

  child(id: string, options: ChildOptions, body: () => void): void {
    let childFlags = 0;
    if (options.border === true) childFlags |= ImGuiChildFlags.Borders;
    const wFlags = options.noScrollbar === true ? ImGuiWindowFlags.NoScrollbar : 0;
    const pad = options.padding;
    if (pad !== undefined) {
      // A borderless child ignores WindowPadding unless this flag is set.
      childFlags |= ImGuiChildFlags.AlwaysUseWindowPadding;
      ImGui.PushStyleVarImVec2(ImGuiStyleVar.WindowPadding, v2(pad));
    }
    const visible = ImGui.BeginChild(id, v2(options.size ?? [0, 0]), childFlags, wFlags);
    if (visible) body();
    ImGui.EndChild();
    if (pad !== undefined) ImGui.PopStyleVar();
  },

  group(body: () => void): void {
    ImGui.BeginGroup();
    try {
      body();
    } finally {
      ImGui.EndGroup();
    }
  },

  withId(id: string, body: () => void): void {
    ImGui.PushID(id);
    try {
      body();
    } finally {
      ImGui.PopID();
    }
  },

  withItemSpacing(x: number, y: number, body: () => void): void {
    ImGui.PushStyleVarImVec2(ImGuiStyleVar.ItemSpacing, new ImVec2(x, y));
    try {
      body();
    } finally {
      ImGui.PopStyleVar(1);
    }
  },

  withDisabled(disabled: boolean, body: () => void): void {
    ImGui.BeginDisabled(disabled);
    try {
      body();
    } finally {
      ImGui.EndDisabled();
    }
  },

  text(value: string): void {
    ImGui.Text(value);
  },

  textDisabled(value: string): void {
    ImGui.TextDisabled(value);
  },

  textMuted(value: string): void {
    colored([...rgbOf(getActivePalette().textMuted), 1] as Rgba, value);
  },

  textColored(color: Rgba, value: string): void {
    colored(color, value);
  },

  textWrapped(value: string): void {
    ImGui.TextWrapped(value);
  },

  separatorText(label: string): void {
    ImGui.SeparatorText(label);
  },

  icon(name, color): void {
    const sz = ImGui.GetTextLineHeight();
    const tm = getActivePalette().text;
    const c: Rgba = color ?? [tm[0] / 255, tm[1] / 255, tm[2] / 255, 1];
    const col = packU32(
      Math.round(c[0] * 255),
      Math.round(c[1] * 255),
      Math.round(c[2] * 255),
      Math.round(c[3] * 255),
    );
    const start = ImGui.GetCursorScreenPos();
    drawIcon(name, [start.x, start.y + 1], sz, col);
    ImGui.Dummy(new ImVec2(sz, sz));
  },

  button(label: string, size?: Vec2): boolean {
    return size === undefined ? ImGui.Button(label) : ImGui.Button(label, v2(size));
  },

  invisibleButton(id: string, size: Vec2): boolean {
    return ImGui.InvisibleButton(id, v2(size));
  },

  checkbox(label: string, value: boolean): boolean {
    const ref: [boolean] = [value];
    ImGui.Checkbox(label, ref);
    return ref[0];
  },

  radio(label: string, active: boolean): boolean {
    return ImGui.RadioButton(label, active);
  },

  selectable(label: string, selected?: boolean, size?: Vec2): boolean {
    return ImGui.Selectable(label, selected ?? false, 0, size === undefined ? undefined : v2(size));
  },

  sliderFloat(label: string, value: number, min: number, max: number): number {
    const ref: [number] = [value];
    ImGui.SliderFloat(label, ref, min, max);
    return ref[0];
  },

  dragFloat(label: string, value: number, options?: DragFloatOptions): number {
    const ref: [number] = [value];
    ImGui.DragFloat(label, ref, options?.speed, options?.min, options?.max, options?.format);
    return ref[0];
  },

  inputText(label: string, value: string, options?: InputTextOptions): string {
    const ref: [string] = [value];
    if (options?.width !== undefined) ImGui.SetNextItemWidth(options.width);
    let flags = 0;
    if (options?.password === true) flags |= 1 << 15; // ImGuiInputTextFlags_Password
    if (options?.readOnly === true) flags |= 1 << 14; // ImGuiInputTextFlags_ReadOnly
    // A leading icon: inset the frame's left padding so text clears the glyph, then
    // draw the glyph centered in that inset after the field renders.
    const icon = options?.icon;
    const ICON = 15;
    const cur = icon !== undefined ? ImGui.GetCursorScreenPos() : undefined;
    let padY = 0;
    if (icon !== undefined) {
      const fp = ImGui.GetStyle().FramePadding;
      padY = fp.y;
      ImGui.PushStyleVarImVec2(ImGuiStyleVar.FramePadding, new ImVec2(ICON + 10, padY));
    }
    if (options?.hint !== undefined) {
      ImGui.InputTextWithHint(label, options.hint, ref, value.length + 256, flags);
    } else {
      ImGui.InputText(label, ref, value.length + 256, flags);
    }
    if (icon !== undefined && cur !== undefined) {
      ImGui.PopStyleVar();
      const h = ImGui.GetFrameHeight();
      drawIcon(icon, [cur.x + 7, cur.y + (h - ICON) / 2], ICON, packU32(...getActivePalette().textMuted));
    }
    return ref[0];
  },

  inputInt(label: string, value: number, step?: number, stepFast?: number): number {
    const ref: [number] = [value];
    ImGui.InputInt(label, ref, step ?? 1, stepFast ?? 10);
    return ref[0];
  },

  colorEdit3(label: string, value: Rgb): Rgb {
    const ref: [number, number, number] = [value[0], value[1], value[2]];
    ImGui.ColorEdit3(label, ref);
    return [ref[0], ref[1], ref[2]];
  },

  colorEdit4(label: string, value: Rgba): Rgba {
    const ref: [number, number, number, number] = [value[0], value[1], value[2], value[3]];
    ImGui.ColorEdit4(label, ref);
    return [ref[0], ref[1], ref[2], ref[3]];
  },

  separator(): void {
    ImGui.Separator();
  },

  sameLine(offsetX?: number, spacing?: number): void {
    ImGui.SameLine(offsetX ?? 0, spacing);
  },

  spacing(): void {
    ImGui.Spacing();
  },

  dummy(size: Vec2): void {
    ImGui.Dummy(v2(size));
  },

  alignTextToFramePadding(): void {
    ImGui.AlignTextToFramePadding();
  },

  indent(width?: number): void {
    ImGui.Indent(width);
  },

  unindent(width?: number): void {
    ImGui.Unindent(width);
  },

  rightAlign(width: number): void {
    const avail = ImGui.GetContentRegionAvail();
    const x = ImGui.GetCursorPosX() + Math.max(0, avail.x - width);
    ImGui.SetCursorPosX(x);
  },

  setNextItemWidth(width: number): void {
    ImGui.SetNextItemWidth(width);
  },

  setKeyboardFocusHere(offset?: number): void {
    ImGui.SetKeyboardFocusHere(offset ?? 0);
  },

  openPopup(id: string): void {
    ImGui.OpenPopup(`pop-${id}`);
  },

  popup(id: string, body: () => void): void {
    if (ImGui.BeginPopup(`pop-${id}`)) {
      body();
      ImGui.EndPopup();
    }
  },

  closePopup(): void {
    ImGui.CloseCurrentPopup();
  },

  isItemHovered(): boolean {
    return ImGui.IsItemHovered();
  },

  isItemActive(): boolean {
    return ImGui.IsItemActive();
  },

  isItemClicked(button?: number): boolean {
    return ImGui.IsItemClicked(button);
  },

  isItemActivated(): boolean {
    return ImGui.IsItemActivated();
  },

  isItemDeactivatedAfterEdit(): boolean {
    return ImGui.IsItemDeactivatedAfterEdit();
  },

  isItemDeactivated(): boolean {
    return ImGui.IsItemDeactivated();
  },

  isItemEdited(): boolean {
    return ImGui.IsItemEdited();
  },

  itemEdges(): ItemEdges {
    return {
      activated: ImGui.IsItemActivated(),
      deactivatedAfterEdit: ImGui.IsItemDeactivatedAfterEdit(),
      edited: ImGui.IsItemEdited(),
    };
  },

  itemRect(): readonly [Vec2, Vec2] {
    return [toVec2(ImGui.GetItemRectMin()), toVec2(ImGui.GetItemRectMax())];
  },

  setItemTooltip(text: string): void {
    ImGui.SetItemTooltip(text);
  },

  dragSource(payload: DragPayload, options?: DragSourceOptions): boolean {
    return beginDragSource(payload, options);
  },

  dropTarget(options: DropTargetOptions): void {
    handleDropTarget(options);
  },

  contentAvail(): Vec2 {
    return toVec2(ImGui.GetContentRegionAvail());
  },

  frameHeight(): number {
    return ImGui.GetFrameHeight();
  },

  textLineHeight(): number {
    return ImGui.GetTextLineHeight();
  },

  calcTextSize(text: string): Vec2 {
    // The binding's CalcTextSize defaults text_end to "" and measures a
    // zero-length range, so it can't be used. The UI font is monospace, so a
    // per-glyph advance estimate is accurate enough for layout/alignment.
    const fs = ImGui.GetFontSize();
    return [text.length * fs * MONO_ADVANCE, fs];
  },

  cursorScreenPos(): Vec2 {
    return toVec2(ImGui.GetCursorScreenPos());
  },

  setCursorScreenPos(pos: Vec2): void {
    ImGui.SetCursorScreenPos(v2(pos));
  },

  cursorPosX(): number {
    return ImGui.GetCursorPosX();
  },

  setCursorPosX(x: number): void {
    ImGui.SetCursorPosX(x);
  },

  withFont(name: string, sizePixels: number, body: () => void): void {
    const font = getFont(name);
    if (font === undefined) {
      body();
      return;
    }
    ImGui.PushFontFloat(font, sizePixels);
    try {
      body();
    } finally {
      ImGui.PopFont();
    }
  },

  demoWindow(): void {
    ImGui.ShowDemoWindow();
  },

  dockSpaceOverViewport(): number {
    return ImGui.DockSpaceOverViewport(0, null, ImGuiDockNodeFlags.PassthruCentralNode);
  },

  dockSpace(id: number): void {
    ImGui.DockSpace(id, undefined, ImGuiDockNodeFlags.PassthruCentralNode);
  },

  isWindowDocked(): boolean {
    return ImGui.IsWindowDocked();
  },

  mousePos(): Vec2 {
    return toVec2(ImGui.GetMousePos());
  },

  windowPos(): Vec2 {
    return toVec2(ImGui.GetWindowPos());
  },

  windowMousePos(): Vec2 {
    const m = ImGui.GetMousePos();
    const p = ImGui.GetWindowPos();
    return [m.x - p.x, m.y - p.y];
  },

  isWindowHovered(flags?: number): boolean {
    return ImGui.IsWindowHovered(flags ?? 0);
  },

  isWindowFocused(flags?: number): boolean {
    return ImGui.IsWindowFocused(flags ?? 0);
  },

  mouseWheel(): number {
    return ImGui.GetIO().MouseWheel;
  },

  isMouseDown(button = 0): boolean {
    return ImGui.IsMouseDown(button);
  },

  isMouseClicked(button = 0): boolean {
    return ImGui.IsMouseClicked(button, false);
  },

  isMouseReleased(button = 0): boolean {
    return ImGui.IsMouseReleased(button);
  },

  isMouseDoubleClicked(button = 0): boolean {
    return ImGui.IsMouseDoubleClicked(button);
  },

  isMouseDragging(button = 0, threshold = -1): boolean {
    return ImGui.IsMouseDragging(button, threshold);
  },

  mouseDragDelta(button = 0): Vec2 {
    return toVec2(ImGui.GetMouseDragDelta(button, -1));
  },

  resetMouseDragDelta(button = 0): void {
    ImGui.ResetMouseDragDelta(button);
  },

  isKeyPressed(key: number, repeat = false): boolean {
    return ImGui.IsKeyPressed(key, repeat);
  },

  isKeyDown(key: number): boolean {
    return ImGui.IsKeyDown(key);
  },

  keyCtrl(): boolean {
    const io = ImGui.GetIO();
    return io.KeyCtrl || io.KeySuper;
  },

  keyShift(): boolean {
    return ImGui.GetIO().KeyShift;
  },

  keyAlt(): boolean {
    return ImGui.GetIO().KeyAlt;
  },
};

const rgbOf = (c: readonly [number, number, number]): Rgb => [c[0] / 255, c[1] / 255, c[2] / 255];
