import {
  ImDrawFlags,
  ImGui,
  ImGuiCol,
  ImGuiColorEditFlags,
  ImGuiComboFlags,
  ImGuiCond,
  ImGuiSelectableFlags,
  ImGuiSliderFlags,
  ImGuiStyleVar,
  ImGuiTreeNodeFlags,
  ImGuiWindowFlags,
  ImVec2,
} from '@mori2003/jsimgui';

import {
  assetCard,
  assetGroup,
  type AssetCardOptions,
  type AssetCardResult,
  type AssetGroupOptions,
} from './components-asset';
import { assetField, type AssetFieldOptions } from './components-asset-field';
import { dataTable, type DataTableOptions } from './components-table';
import { applyItemDnd, type ItemDnd } from './dnd/item-dnd';
import { Draw } from './draw';
import { drawIcon } from './icon-shapes';
import { type IconName } from './icons';
import { type Axis, axisColor, getActivePalette, srgbU32, type Tone, toneColors } from './palette';
import { ui } from './ui';
import type { Rgba, Srgb8 } from './units';

/** Control heights (px) on the design system's scale. */
export const ControlHeight = { xs: 20, sm: 26, md: 32, lg: 40 } as const;

const ROW_RAIL = 2;

/** Visual emphasis of a {@link Widgets.button}. */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

/** Options for {@link Widgets.button}. */
export interface ButtonOptions {
  readonly variant?: ButtonVariant;
  readonly size?: keyof typeof ControlHeight;
  /** Stretch to the full available width. */
  readonly block?: boolean;
  /** Leading icon glyph. */
  readonly icon?: IconName;
}

/** Options for {@link Widgets.iconButton}. */
export interface IconButtonOptions {
  /** Hover tooltip (also the accessible label) — include the shortcut, e.g. `Move (W)`. */
  readonly tooltip?: string;
  /** Selected/toggled state — accent-soft fill, green glyph (active tool). */
  readonly active?: boolean;
  readonly size?: keyof typeof ControlHeight;
  /** `ghost` (default, transparent until hover) or `solid` (raised + border). */
  readonly variant?: 'ghost' | 'solid';
  readonly danger?: boolean;
}

/** Options for {@link Widgets.dragNumber}. */
export interface DragNumberOptions {
  /** Color-coded axis chip prefix (X red / Y green / Z cyan). */
  readonly axis?: Axis | undefined;
  /** Scalar label chip (used instead of an axis). */
  readonly label?: string | undefined;
  /** Dimmed unit suffix (`m`, `°`, `kg`). */
  readonly suffix?: string | undefined;
  /** Per-pixel increment and display precision. */
  readonly step?: number | undefined;
  readonly min?: number | undefined;
  readonly max?: number | undefined;
  /** Field width in px; defaults to the remaining content width. */
  readonly width?: number | undefined;
}

/** A 3-component vector value. */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Options for {@link Widgets.slider}. */
export interface SliderOptions {
  readonly min: number;
  readonly max: number;
  readonly integer?: boolean;
  readonly logarithmic?: boolean;
  readonly suffix?: string;
  readonly format?: string;
  /** Fixed width in px; defaults to the remaining content width. */
  readonly width?: number;
}

/** Options for {@link Widgets.inputNumber}. */
export interface InputNumberOptions {
  readonly integer?: boolean;
  readonly step?: number;
  readonly stepFast?: number;
  readonly min?: number;
  readonly max?: number;
  readonly width?: number;
}

/** Options for {@link Widgets.dialog}. */
export interface DialogOptions {
  /** Stable id; pass the same id to {@link Widgets.openDialog}. */
  readonly id: string;
  readonly title: string;
  readonly icon?: IconName;
  /** Fixed width in px (height auto-fits). */
  readonly width?: number;
}

/** Options for {@link Widgets.collapsingHeader}. */
export interface CollapsingHeaderOptions {
  readonly title: string;
  readonly icon?: IconName;
  readonly defaultOpen?: boolean;
  /** Show a remove (`x`) action on the header; called when clicked. */
  readonly onRemove?: () => void;
}

/** One entry in a {@link Widgets.combo} / {@link Widgets.listBox} / {@link Widgets.radioGroup}. */
export interface Option {
  readonly value: string;
  readonly label?: string;
  readonly icon?: IconName;
  readonly disabled?: boolean;
}

/** A hierarchy row for {@link Widgets.treeItem}. */
export interface TreeItemOptions {
  readonly id: string;
  readonly label: string;
  readonly icon?: IconName | undefined;
  /** Nesting depth (0 = root); indents 14px per level. */
  readonly depth: number;
  readonly hasChildren?: boolean | undefined;
  readonly open?: boolean | undefined;
  readonly selected?: boolean | undefined;
  /** Trailing count badge text. */
  readonly badge?: string | undefined;
  /** When provided, a hover eye toggle appears; the value sets the glyph. */
  readonly visible?: boolean | undefined;
  /** Drag-and-drop binding for the row (attached to the row's selectable). */
  readonly dnd?: ItemDnd | undefined;
  /** Accent color for the name + icon (e.g. a prefab/scene/model tone). Defaults to the neutral text color. */
  readonly accent?: Srgb8 | undefined;
  /** A faint source reference drawn after the name (e.g. `coin.prefab`), prefixed with `·`. */
  readonly suffix?: string | undefined;
  /** Draw an amber override dot on the icon (the row differs from its source). */
  readonly overridden?: boolean | undefined;
  /** Dim the row — an inherited entity instantiated from a source, not authored here. */
  readonly recessed?: boolean | undefined;
}

/** What a {@link Widgets.treeItem} reported this frame. */
export interface TreeItemResult {
  /** The row was clicked (select it). */
  readonly clicked: boolean;
  /** The expand twist was clicked (toggle open). */
  readonly toggled: boolean;
  /** The visibility eye was clicked. */
  readonly visibilityToggled: boolean;
}

/** A context-menu entry for {@link Widgets.contextMenu}. */
export interface MenuEntry {
  readonly label?: string | undefined;
  readonly icon?: IconName | undefined;
  readonly shortcut?: string | undefined;
  readonly danger?: boolean;
  readonly disabled?: boolean;
  readonly checked?: boolean;
  /** Render a separator rule instead of an item. */
  readonly separator?: boolean;
  /** Render a section heading instead of an item. */
  readonly heading?: string;
  readonly onClick?: () => void;
}

const heightOf = (size: keyof typeof ControlHeight | undefined): number => ControlHeight[size ?? 'md'];

const hexToRgba = (hex: string): Rgba => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255, 1];
};

const rgbaToHex = (c: Rgba): string => {
  const to = (x: number): string =>
    Math.round(Math.max(0, Math.min(1, x)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(c[0])}${to(c[1])}${to(c[2])}`.toUpperCase();
};

/**
 * The Retro Engine component library: composed, themed widgets built on the
 * normalized {@link ui} surface. Each maps to the design system's componentry —
 * buttons, the inspector field family, tree rows, badges, the toggle switch,
 * data tables, and asset tiles. State stays in the caller; edit widgets take a
 * value and return the next one.
 */
export interface Widgets {
  button(label: string, options?: ButtonOptions): boolean;
  iconButton(id: string, icon: IconName, options?: IconButtonOptions): boolean;
  /** A toggle for live booleans. Returns the next state. */
  switchToggle(id: string, value: boolean, label?: string): boolean;
  /** A compact uppercase status pill drawn inline. */
  badge(text: string, options?: { tone?: Tone; dot?: boolean }): void;
  /** An inline text link (cyan by default; accent for in-app nav). Returns `true` on click. */
  hyperlink(label: string, options?: { url?: string; variant?: 'link' | 'accent' | 'muted' }): boolean;
  /** A compact segmented control. Returns the next active index. */
  segmented(id: string, options: readonly string[], active: number): number;

  /** The signature inspector scrub field. Returns the next value. */
  dragNumber(id: string, value: number, options?: DragNumberOptions): number;
  /** Three side-by-side axis drag fields. Returns the next vector. */
  vec3(id: string, value: Vec3, options?: { suffix?: string | undefined; step?: number | undefined }): Vec3;
  /** A bounded slider with an optional unit readout. Returns the next value. */
  slider(id: string, value: number, options: SliderOptions): number;
  /** A slim integer range bar (thin track + small grab). Returns the next value. */
  range(id: string, value: number, min: number, max: number, width: number): number;
  /** A numeric field with ± steppers. Returns the next value. */
  inputNumber(id: string, value: number, options?: InputNumberOptions): number;
  /** A dropdown select. Returns the next value. */
  combo(id: string, value: string, options: readonly Option[], width?: number): string;
  /** Exclusive options as radio buttons. Returns the next value. */
  radioGroup(id: string, value: string, options: readonly Option[], horizontal?: boolean): string;
  /** An always-visible scrollable single-select list. Returns the next value. */
  listBox(id: string, value: string, options: readonly Option[], rows?: number): string;
  /** A color field with an editable hex/swatch. Returns the next `#rrggbb`. */
  colorField(id: string, hex: string, width?: number): string;

  /** The inspector row layout: a fixed-width label + a flexible control area. */
  inspectorRow(label: string, control: () => void): void;
  /** An inspector section header (one per ECS component). Returns whether open. */
  collapsingHeader(id: string, options: CollapsingHeaderOptions): boolean;
  /** One row of the entity hierarchy (caller renders the recursion). */
  treeItem(options: TreeItemOptions): TreeItemResult;

  /** A sortable, zebra, scrollable data grid. */
  dataTable<Row>(options: DataTableOptions<Row>): void;
  /** An input-like asset slot (à la Unity's object field). Returns whether clicked. */
  assetField(id: string, options: AssetFieldOptions): { clicked: boolean };
  /** An asset-browser tile. Returns interaction flags. */
  assetCard(options: AssetCardOptions): AssetCardResult;
  /** A full-width drawer holding a source file's derived children. */
  assetGroup(options: AssetGroupOptions): void;

  /** Open a right-click context menu anchored to the last item. */
  contextMenu(id: string, entries: readonly MenuEntry[]): void;
  /** A dropdown button (label + chevron) that opens a popup running `body` on click. */
  dropdown(id: string, label: string, icon: IconName | undefined, body: () => void): void;

  /** Request the {@link Widgets.dialog} with this id to open on the next frame. */
  openDialog(id: string): void;
  /** A centered modal dialog with a dimmed backdrop. `body` builds its contents. */
  dialog(options: DialogOptions, body: () => void): void;
  /** Close the dialog currently being built (call from inside its `body`). */
  closeDialog(): void;
}

const pushButtonVariant = (variant: ButtonVariant): number => {
  const p = getActivePalette();
  switch (variant) {
    case 'primary':
      ImGui.PushStyleColor(ImGuiCol.Button, srgbU32(p.green400));
      ImGui.PushStyleColor(ImGuiCol.ButtonHovered, srgbU32(p.green300));
      ImGui.PushStyleColor(ImGuiCol.ButtonActive, srgbU32(p.green600));
      ImGui.PushStyleColor(ImGuiCol.Text, srgbU32(p.gray0));
      return 4;
    case 'ghost':
      ImGui.PushStyleColor(ImGuiCol.Button, srgbU32(p.gray0, 0));
      ImGui.PushStyleColor(ImGuiCol.ButtonHovered, srgbU32(p.gray5));
      ImGui.PushStyleColor(ImGuiCol.ButtonActive, srgbU32(p.gray6));
      return 3;
    case 'danger':
      ImGui.PushStyleColor(ImGuiCol.Button, srgbU32(p.red400, 0));
      ImGui.PushStyleColor(ImGuiCol.ButtonHovered, srgbU32(p.red400, 0.16));
      ImGui.PushStyleColor(ImGuiCol.ButtonActive, srgbU32(p.red400, 0.28));
      ImGui.PushStyleColor(ImGuiCol.Text, srgbU32(p.red400));
      ImGui.PushStyleColor(ImGuiCol.Border, srgbU32(p.red400, 0.7));
      return 5;
    case 'secondary':
    default:
      return 0;
  }
};

const ROUND_LEFT = ImDrawFlags.RoundCornersLeft;
// Axis chip width as a fraction of field height — a near-square colored tab.
const chipWidthFor = (h: number): number => Math.round(h * 0.82);

export const widgets: Widgets = {
  button(label: string, options?: ButtonOptions): boolean {
    const variant = options?.variant ?? 'secondary';
    const popN = pushButtonVariant(variant);
    const h = heightOf(options?.size);
    const block = options?.block === true;
    const hasIcon = options?.icon !== undefined;
    const w = block ? ui.contentAvail()[0] : 0;
    const start = ui.cursorScreenPos();
    const p = getActivePalette();
    const iconCol = srgbU32(variant === 'primary' ? p.gray0 : variant === 'danger' ? p.red400 : p.text);
    const iconSz = 16;
    // Non-block icon buttons left-align so the glyph sits right before the text;
    // block buttons keep the label centered with the glyph pinned to the left.
    let popVar = 0;
    if (hasIcon && !block) {
      ImGui.PushStyleVarImVec2(ImGuiStyleVar.ButtonTextAlign, new ImVec2(0, 0.5));
      popVar = 1;
    }
    const text = hasIcon && !block ? `      ${label}` : label;
    const clicked = ImGui.Button(text, new ImVec2(w, h));
    if (popVar > 0) ImGui.PopStyleVar(1);
    if (options?.icon !== undefined) {
      const ix = block ? start[0] + 14 : start[0] + 8;
      drawIcon(options.icon, [ix, start[1] + (h - iconSz) / 2], iconSz, iconCol);
    }
    if (popN > 0) ImGui.PopStyleColor(popN);
    return clicked;
  },

  iconButton(id: string, icon: IconName, options?: IconButtonOptions): boolean {
    const p = getActivePalette();
    const h = heightOf(options?.size);
    const variant = options?.variant ?? 'ghost';
    const solid = variant === 'solid';
    let popN = 0;
    if (options?.active === true) {
      ImGui.PushStyleColor(ImGuiCol.Button, srgbU32(p.green400, 0.18));
      ImGui.PushStyleColor(ImGuiCol.ButtonHovered, srgbU32(p.green400, 0.26));
      ImGui.PushStyleColor(ImGuiCol.ButtonActive, srgbU32(p.green400, 0.34));
      popN = 3;
    } else if (solid) {
      ImGui.PushStyleColor(ImGuiCol.Button, srgbU32(p.gray4));
      ImGui.PushStyleColor(ImGuiCol.ButtonHovered, srgbU32(p.gray5));
      ImGui.PushStyleColor(ImGuiCol.ButtonActive, srgbU32(p.gray6));
      popN = 3;
    } else {
      ImGui.PushStyleColor(ImGuiCol.Button, srgbU32(p.gray0, 0));
      ImGui.PushStyleColor(ImGuiCol.ButtonHovered, srgbU32(p.gray5, 0.7));
      ImGui.PushStyleColor(ImGuiCol.ButtonActive, srgbU32(p.gray6));
      popN = 3;
    }
    // Toolbar / ghost icon buttons carry no border; only `solid` keeps the frame.
    if (!solid) ImGui.PushStyleVar(ImGuiStyleVar.FrameBorderSize, 0);
    const start = ui.cursorScreenPos();
    const clicked = ImGui.Button(`##${id}`, new ImVec2(h, h));
    if (!solid) ImGui.PopStyleVar(1);
    ImGui.PopStyleColor(popN);
    const sz = h * 0.58;
    const col = srgbU32(
      options?.active === true ? p.green400 : options?.danger === true ? p.red400 : p.textMuted,
    );
    drawIcon(icon, [start[0] + (h - sz) / 2, start[1] + (h - sz) / 2], sz, col);
    if (options?.tooltip !== undefined) ui.setItemTooltip(options.tooltip);
    return clicked;
  },

  switchToggle(id: string, value: boolean, label?: string): boolean {
    const p = getActivePalette();
    const w = 34;
    const h = 18;
    const start = ui.cursorScreenPos();
    const clicked = ui.invisibleButton(`##sw-${id}`, [w, h]);
    const next = clicked ? !value : value;
    const dl = Draw.window();
    const track = next ? srgbU32(p.green400) : srgbU32(p.gray4);
    dl.rectFilled([start[0], start[1]], [start[0] + w, start[1] + h], track, h / 2);
    if (!next) dl.rect([start[0], start[1]], [start[0] + w, start[1] + h], srgbU32(p.gray6), h / 2);
    const r = h / 2 - 2.5;
    const kx = next ? start[0] + w - h / 2 : start[0] + h / 2;
    dl.circleFilled([kx, start[1] + h / 2], r, srgbU32(next ? p.gray0 : p.gray8));
    if (label !== undefined) {
      ui.sameLine();
      ui.alignTextToFramePadding();
      ui.text(label);
    }
    return next;
  },

  badge(text: string, options?: { tone?: Tone; dot?: boolean }): void {
    const tc = toneColors(options?.tone ?? 'neutral');
    const padX = 6;
    const padY = 2;
    const dotW = options?.dot === true ? 10 : 0;
    const ts = ui.calcTextSize(text);
    const w = ts[0] + padX * 2 + dotW;
    const h = ts[1] + padY * 2;
    const start = ui.cursorScreenPos();
    const dl = Draw.window();
    dl.rectFilled([start[0], start[1]], [start[0] + w, start[1] + h], tc.bg, 2);
    if (tc.border !== undefined) dl.rect([start[0], start[1]], [start[0] + w, start[1] + h], tc.border, 2);
    let tx = start[0] + padX;
    if (options?.dot === true) {
      dl.circleFilled([tx + 2, start[1] + h / 2], 3, tc.fg);
      tx += dotW;
    }
    dl.text([tx, start[1] + padY], tc.fg, text);
    // Reserve the badge as the last layout item so a following sameLine continues
    // from its right edge (the draw-list text above restores the cursor to here).
    ui.dummy([w, h]);
  },

  hyperlink(label: string, options?: { url?: string; variant?: 'link' | 'accent' | 'muted' }): boolean {
    const p = getActivePalette();
    const variant = options?.variant ?? 'link';
    const col = variant === 'accent' ? p.green400 : variant === 'muted' ? p.textMuted : p.cyan400;
    ImGui.PushStyleColor(ImGuiCol.Text, srgbU32(col));
    const text = options?.url !== undefined ? `${label}  ↗` : label;
    const clicked = ImGui.TextLink(text);
    ImGui.PopStyleColor(1);
    return clicked;
  },

  segmented(id: string, options: readonly string[], active: number): number {
    const p = getActivePalette();
    let next = active;
    ImGui.PushStyleColor(ImGuiCol.ChildBg, srgbU32(p.gray0));
    ui.child(`seg-${id}`, { size: [0, ControlHeight.sm + 6], border: true, padding: [3, 3] }, () => {
      for (const [i, label] of options.entries()) {
        if (i > 0) ui.sameLine(undefined);
        if (i === active) {
          ImGui.PushStyleColor(ImGuiCol.Button, srgbU32(p.gray3));
          ImGui.PushStyleColor(ImGuiCol.Text, srgbU32(p.text));
        } else {
          ImGui.PushStyleColor(ImGuiCol.Button, srgbU32(p.gray0, 0));
          ImGui.PushStyleColor(ImGuiCol.Text, srgbU32(p.textMuted));
        }
        if (ImGui.Button(`${label}##seg-${id}-${i}`, new ImVec2(0, ControlHeight.sm))) next = i;
        ImGui.PopStyleColor(2);
      }
    });
    ImGui.PopStyleColor(1);
    return next;
  },

  dragNumber(id: string, value: number, options?: DragNumberOptions): number {
    const p = getActivePalette();
    const chipText = options?.axis !== undefined ? options.axis.toUpperCase() : options?.label;
    const chipColor =
      options?.axis !== undefined ? srgbU32(axisColor(options.axis)) : srgbU32(p.gray6);
    const chipW = chipText !== undefined ? chipWidthFor(ui.frameHeight()) : 0;
    ui.group(() => {
      const p0 = ui.cursorScreenPos();
      if (chipW > 0) {
        ui.dummy([chipW, ui.frameHeight()]);
        ImGui.SameLine(0, 0); // field sits flush against the chip
      }
      const fmt = `%.${options?.step !== undefined && options.step < 1 ? (options.step <= 0.01 ? 2 : 1) : 0}f${
        options?.suffix !== undefined ? ` ${options.suffix}` : ''
      }`;
      const w = options?.width ?? ui.contentAvail()[0];
      ui.setNextItemWidth(w);
      const ref: [number] = [value];
      ImGui.DragFloat(`##${id}`, ref, options?.step ?? 0.1, options?.min ?? 0, options?.max ?? 0, fmt, ImGuiSliderFlags.None);
      value = ref[0];
      // Draw the chip to exactly match the field's measured rect (top/bottom),
      // so the colored tab and the input are always flush.
      if (chipW > 0 && chipText !== undefined) {
        const [fmin, fmax] = ui.itemRect();
        const dl = Draw.window();
        dl.rectFilled([p0[0], fmin[1]], [p0[0] + chipW, fmax[1]], chipColor, 2, ROUND_LEFT);
        const ts = ui.calcTextSize(chipText);
        dl.text([p0[0] + (chipW - ts[0]) / 2, (fmin[1] + fmax[1]) / 2 - ts[1] / 2], srgbU32(p.gray0), chipText);
      }
    });
    return value;
  },

  vec3(id: string, value: Vec3, options?: { suffix?: string; step?: number }): Vec3 {
    const gap = 4;
    const avail = ui.contentAvail()[0];
    // 3 fields, each preceded by a square axis chip; gaps only between groups.
    const chipW = chipWidthFor(ui.frameHeight());
    const fieldW = Math.max(18, (avail - gap * 2 - chipW * 3) / 3);
    const step = options?.step;
    const x = this.dragNumber(`${id}-x`, value.x, { axis: 'x', suffix: options?.suffix, step, width: fieldW });
    ImGui.SameLine(0, gap);
    const y = this.dragNumber(`${id}-y`, value.y, { axis: 'y', suffix: options?.suffix, step, width: fieldW });
    ImGui.SameLine(0, gap);
    const z = this.dragNumber(`${id}-z`, value.z, { axis: 'z', suffix: options?.suffix, step, width: fieldW });
    return { x, y, z };
  },

  slider(id: string, value: number, options: SliderOptions): number {
    const fmt =
      options.format ??
      (options.integer === true ? '%d' : '%.2f') + (options.suffix !== undefined ? ` ${options.suffix}` : '');
    ui.setNextItemWidth(options.width ?? ui.contentAvail()[0]);
    let flags = 0;
    if (options.logarithmic === true) flags |= ImGuiSliderFlags.Logarithmic;
    const ref: [number] = [value];
    if (options.integer === true) {
      ImGui.SliderInt(`##${id}`, ref, options.min, options.max, fmt, flags);
    } else {
      ImGui.SliderFloat(`##${id}`, ref, options.min, options.max, fmt, flags);
    }
    return ref[0];
  },

  range(id: string, value: number, min: number, max: number, width: number): number {
    const p = getActivePalette();
    const h = ui.frameHeight();
    const start = ui.cursorScreenPos();
    ui.invisibleButton(`##rng-${id}`, [width, h]);
    const dl = Draw.window();
    const cy = start[1] + h / 2;
    let v = value;
    if (ui.isItemActive()) {
      const t = Math.max(0, Math.min(1, (ui.mousePos()[0] - start[0]) / width));
      v = Math.round(min + t * (max - min));
    }
    const t = (v - min) / (max - min || 1);
    const gx = start[0] + t * (width - 12) + 6;
    dl.rectFilled([start[0] + 1, cy - 2], [start[0] + width - 1, cy + 2], srgbU32(p.gray5), 2);
    dl.rectFilled([start[0] + 1, cy - 2], [gx, cy + 2], srgbU32(p.green600), 2);
    dl.circleFilled([gx, cy], 5.5, srgbU32(ui.isItemActive() ? p.green400 : p.green600));
    return v;
  },

  inputNumber(id: string, value: number, options?: InputNumberOptions): number {
    if (options?.width !== undefined) ui.setNextItemWidth(options.width);
    const ref: [number] = [value];
    if (options?.integer === true) {
      ImGui.InputInt(`##${id}`, ref, options.step ?? 1, options.stepFast ?? 10);
    } else {
      ImGui.InputFloat(`##${id}`, ref, options?.step ?? 0.1, options?.stepFast ?? 1, '%.2f');
    }
    let next = ref[0];
    if (options?.min !== undefined) next = Math.max(options.min, next);
    if (options?.max !== undefined) next = Math.min(options.max, next);
    return next;
  },

  combo(id: string, value: string, options: readonly Option[], width?: number): string {
    let next = value;
    const current = options.find((o) => o.value === value);
    const preview = current?.label ?? current?.value ?? value;
    if (width !== undefined) ui.setNextItemWidth(width);
    else ui.setNextItemWidth(ui.contentAvail()[0]);
    if (ImGui.BeginCombo(`##${id}`, preview, ImGuiComboFlags.None)) {
      for (const o of options) {
        if (ImGui.Selectable(o.label ?? o.value, o.value === value, o.disabled === true ? ImGuiSelectableFlags.Disabled : 0)) {
          next = o.value;
        }
      }
      ImGui.EndCombo();
    }
    return next;
  },

  radioGroup(id: string, value: string, options: readonly Option[], horizontal?: boolean): string {
    let next = value;
    for (const [i, o] of options.entries()) {
      if (i > 0 && horizontal !== false) ui.sameLine(undefined);
      if (ImGui.RadioButton(`${o.label ?? o.value}##${id}-${o.value}`, o.value === value)) next = o.value;
    }
    return next;
  },

  listBox(id: string, value: string, options: readonly Option[], rows?: number): string {
    let next = value;
    const h = (rows ?? 4) * ImGui.GetTextLineHeightWithSpacing() + 4;
    if (ImGui.BeginListBox(`##${id}`, new ImVec2(-1, h))) {
      for (const o of options) {
        if (ImGui.Selectable(`${o.label ?? o.value}##${id}-${o.value}`, o.value === value)) next = o.value;
      }
      ImGui.EndListBox();
    }
    return next;
  },

  colorField(id: string, hex: string, width?: number): string {
    const rgba = hexToRgba(hex);
    const ref: [number, number, number, number] = [rgba[0], rgba[1], rgba[2], rgba[3]];
    ui.setNextItemWidth(width ?? ui.contentAvail()[0]);
    ImGui.ColorEdit4(
      `##${id}`,
      ref,
      ImGuiColorEditFlags.DisplayRGB |
        ImGuiColorEditFlags.Uint8 |
        ImGuiColorEditFlags.NoAlpha |
        ImGuiColorEditFlags.AlphaOpaque,
    );
    return rgbaToHex([ref[0], ref[1], ref[2], 1]);
  },

  inspectorRow(label: string, control: () => void): void {
    const LABEL_W = 74;
    ui.alignTextToFramePadding();
    ui.textMuted(label);
    ui.sameLine(LABEL_W);
    ui.group(control);
  },

  collapsingHeader(id: string, options: CollapsingHeaderOptions): boolean {
    const p = getActivePalette();
    // A gray raised bar, not the themed green selection color.
    ImGui.PushStyleColor(ImGuiCol.Header, srgbU32(p.gray3));
    ImGui.PushStyleColor(ImGuiCol.HeaderHovered, srgbU32(p.gray4));
    ImGui.PushStyleColor(ImGuiCol.HeaderActive, srgbU32(p.gray4));
    let flags = ImGuiTreeNodeFlags.AllowOverlap;
    if (options.defaultOpen === true) flags |= ImGuiTreeNodeFlags.DefaultOpen;
    ImGui.SetNextItemAllowOverlap();
    // Empty label — the chevron is native; the icon and title are drawn manually
    // so chevron · icon · name are evenly spaced and tightly left-aligned.
    const open = ImGui.CollapsingHeader(`###${id}`, flags);
    ImGui.PopStyleColor(3);
    const [min, max] = ui.itemRect();
    const cy = (min[1] + max[1]) / 2;
    const dl = Draw.window();
    const iconX = min[0] + 32;
    if (options.icon !== undefined) {
      drawIcon(options.icon, [iconX, cy - 8], 16, srgbU32(p.green400));
    }
    const titleX = options.icon !== undefined ? iconX + 19 : min[0] + 28;
    dl.text([titleX, cy - ui.textLineHeight() / 2], srgbU32(p.text), options.title);
    if (options.onRemove !== undefined) {
      const save = ui.cursorScreenPos();
      ui.setCursorScreenPos([max[0] - 24, cy - 10]);
      if (this.iconButton(`rm-${id}`, 'x', { size: 'xs', tooltip: 'Remove component' })) options.onRemove();
      ui.setCursorScreenPos(save);
    }
    return open;
  },

  treeItem(options: TreeItemOptions): TreeItemResult {
    const p = getActivePalette();
    const rowH = 24;
    const indent = 16;
    const dl = Draw.window();
    ImGui.SetNextItemAllowOverlap();
    const clicked = ImGui.Selectable(
      `##tree-${options.id}`,
      options.selected ?? false,
      ImGuiSelectableFlags.AllowOverlap,
      new ImVec2(0, rowH),
    );
    // Bind drag/drop to the selectable while it is the last item — before the
    // decorative draws below (which submit id-less dummies of their own).
    applyItemDnd(options.dnd);
    const hovered = ui.isItemHovered();
    const [min, max] = ui.itemRect();
    const cy = (min[1] + max[1]) / 2;
    const th = ui.textLineHeight();
    if (options.selected === true) dl.rectFilled([min[0], min[1]], [min[0] + ROW_RAIL, max[1]], srgbU32(p.green400));
    const chevronX = min[0] + 8 + options.depth * indent;
    if (options.hasChildren === true) {
      drawIcon(options.open === true ? 'chevron-down' : 'chevron-right', [chevronX, cy - 6], 12, srgbU32(p.textMuted));
    }
    // Instance rows tint name + icon by their kind (prefab / scene / model);
    // inherited rows are dimmed; selection always wins.
    const iconColor =
      options.selected === true
        ? p.green400
        : options.recessed === true
          ? p.textFaint
          : (options.accent ?? p.textMuted);
    const labelColor =
      options.selected === true
        ? p.green400
        : options.recessed === true
          ? p.textMuted
          : (options.accent ?? p.text);
    const iconX = chevronX + 16;
    if (options.icon !== undefined) {
      drawIcon(options.icon, [iconX, cy - 8], 16, srgbU32(iconColor));
      // Override dot: the row differs from the source it was instantiated from.
      if (options.overridden === true) {
        dl.circleFilled([iconX + 15, cy - 7], 3.5, srgbU32(p.amber400));
      }
    }
    const labelX = iconX + (options.icon !== undefined ? 23 : 0);
    dl.text([labelX, cy - th / 2], srgbU32(labelColor), options.label);
    // Faint source reference (e.g. `· coin.prefab`) after the name.
    if (options.suffix !== undefined && options.suffix.length > 0) {
      const sx = labelX + ui.calcTextSize(options.label)[0] + 8;
      dl.text([sx, cy - th / 2], srgbU32(p.textFaint), `· ${options.suffix}`);
    }

    let visibilityToggled = false;
    const eyeX = max[0] - 22;
    if (options.visible !== undefined && (hovered || options.visible === false)) {
      const col = options.visible ? p.textMuted : p.textFaint;
      drawIcon(options.visible ? 'eye' : 'eye-off', [eyeX, cy - 8], 16, srgbU32(col));
    }
    if (options.badge !== undefined) {
      const ts = ui.calcTextSize(options.badge);
      const bw = Math.max(ts[1], ts[0] + 12);
      const bh = 16;
      const bx = (options.visible !== undefined ? eyeX - 6 : max[0] - 8) - bw;
      dl.rectFilled([bx, cy - bh / 2], [bx + bw, cy + bh / 2], srgbU32(p.gray5, 0.85), 3);
      dl.text([bx + (bw - ts[0]) / 2, cy - th / 2], srgbU32(p.textMuted), options.badge);
    }

    const mx = ui.mousePos()[0];
    let toggled = false;
    if (clicked && options.hasChildren === true && mx >= chevronX && mx <= chevronX + 16) toggled = true;
    if (clicked && options.visible !== undefined && mx >= eyeX - 2) visibilityToggled = true;
    return { clicked: clicked && !toggled && !visibilityToggled, toggled, visibilityToggled };
  },

  dataTable<Row>(options: DataTableOptions<Row>): void {
    dataTable(options);
  },

  assetField(id: string, options: AssetFieldOptions): { clicked: boolean } {
    return assetField(id, options);
  },

  assetCard(options: AssetCardOptions): AssetCardResult {
    return assetCard(options);
  },

  assetGroup(options: AssetGroupOptions): void {
    assetGroup(options);
  },

  contextMenu(id: string, entries: readonly MenuEntry[]): void {
    if (!ImGui.BeginPopupContextItem(`ctx-${id}`)) return;
    for (const [i, e] of entries.entries()) {
      if (e.separator === true) {
        ImGui.Separator();
        continue;
      }
      if (e.heading !== undefined) {
        ImGui.SeparatorText(e.heading);
        continue;
      }
      const p = getActivePalette();
      if (e.danger === true) ImGui.PushStyleColor(ImGuiCol.Text, srgbU32(p.red400));
      const label = e.label ?? '';
      if (ImGui.MenuItem(`${label}##ctx-${id}-${i}`, e.shortcut, e.checked ?? false, e.disabled !== true)) {
        e.onClick?.();
      }
      if (e.danger === true) ImGui.PopStyleColor(1);
    }
    ImGui.EndPopup();
  },

  dropdown(id: string, label: string, icon: IconName | undefined, body: () => void): void {
    const clicked = this.button(`${label}    `, icon !== undefined ? { variant: 'secondary', size: 'sm', icon } : { variant: 'secondary', size: 'sm' });
    const [min, max] = ui.itemRect();
    drawIcon('chevron-down', [max[0] - 16, (min[1] + max[1]) / 2 - 6], 12, srgbU32(getActivePalette().textMuted));
    if (clicked) ImGui.OpenPopup(`dd-${id}`);
    if (ImGui.BeginPopup(`dd-${id}`)) {
      body();
      ImGui.EndPopup();
    }
  },

  openDialog(id: string): void {
    ImGui.OpenPopup(`dlg-${id}`);
  },

  dialog(options: DialogOptions, body: () => void): void {
    const center = ImGui.GetMainViewport().GetCenter();
    ImGui.SetNextWindowPos(center, ImGuiCond.Appearing, new ImVec2(0.5, 0.5));
    if (options.width !== undefined) {
      ImGui.SetNextWindowSize(new ImVec2(options.width, 0), ImGuiCond.Appearing);
    }
    const name = `${options.title}###dlg-${options.id}`;
    if (ImGui.BeginPopupModal(name, null, ImGuiWindowFlags.NoSavedSettings)) {
      body();
      ImGui.EndPopup();
    }
  },

  closeDialog(): void {
    ImGui.CloseCurrentPopup();
  },
};
