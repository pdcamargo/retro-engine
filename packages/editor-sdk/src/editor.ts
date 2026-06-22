import { ImGui, ImGuiCol, ImGuiCond } from '@mori2003/jsimgui';

import type { MenuEntry, Widgets } from './components';
import { widgets } from './components';
import { Draw } from './draw';
import { buildDefaultLayout, type DockSlot, DockNodeId, type LayoutDims, nodeForSlot } from './editor-layout';
import { drawIcon } from './icon-shapes';
import { createInspectorRegistry, type InspectorRegistry } from './inspector/inspector-registry';
import { drawPixelText, pixelTextWidth } from './pixel-font';
import { type IconName } from './icons';
import { getActivePalette, srgbU32 } from './palette';
import { ui, type Ui } from './ui';
import type { Rgba } from './units';

/** Height (px) of the shell's chrome rails. */
export const RailHeight = { menu: 0, toolbar: 40, status: 26 } as const;

/** What a panel/region render callback receives — the UI surfaces, never the raw binding. */
export interface EditorContext {
  readonly ui: Ui;
  readonly widgets: Widgets;
}

/**
 * A dockable editor panel, registered by a path-like id (e.g. `'/scene'`). The
 * id is the panel's stable identity (dock binding, Window-menu toggle, dedupe),
 * so new panels are added simply by registering another def — the shell needs no
 * other change.
 */
export interface PanelDef {
  /** Stable path-like id, e.g. `'/inspector'`. */
  readonly id: string;
  /** Tab/header title (rendered UPPERCASE tracked). */
  readonly title: string;
  /** Leading Lucide icon. */
  readonly icon?: IconName;
  /** Default dock location. Defaults to `'float'`. */
  readonly slot?: DockSlot;
  /** Show a close button; the panel hides until re-enabled from the Window menu. */
  readonly closable?: boolean;
  /** Remove body padding (for trees / tables / consoles that manage their own). */
  readonly flush?: boolean;
  /** Hide this panel by default. */
  readonly hidden?: boolean;
  /** A live count rendered as a pill in the tab (e.g. console line count). */
  readonly count?: () => number | undefined;
  /** Draw the panel body each frame. */
  readonly render: (ctx: EditorContext) => void;
}

/** A top-level menu in the menu bar. */
export interface MenuDef {
  readonly id: string;
  readonly label: string;
  /** Build the menu's entries (called each frame the menu is open). */
  readonly items: () => readonly MenuEntry[];
}

/** A toolbar region. The shell draws the 40px strip; `render` fills it. */
export interface ToolbarDef {
  readonly render: (ctx: EditorContext, width: number) => void;
}

/** A status-bar region. The shell draws the 26px strip; `render` fills it. */
export interface StatusBarDef {
  readonly render: (ctx: EditorContext, width: number) => void;
}

/** How the shell seeds and persists its dock layout (handed to {@link uiOverlayPlugin}). */
export interface EditorLayoutSinks {
  readonly restore?: () => string | null | undefined;
  readonly persist?: (ini: string) => void;
}

/** Options for {@link createEditor}. */
export interface EditorOptions {
  /** Wordmark shown in the menu bar. Defaults to `'RETRO ENGINE'`. */
  readonly brand?: string;
  /** Right-aligned menu-bar indicator (e.g. `'main · level_01.scene'`). */
  readonly branch?: () => string;
  /** Region sizes for the default layout. */
  readonly dims?: LayoutDims;
  /** Auto-append a Window menu of panel visibility toggles. Defaults to `true`. */
  readonly windowMenu?: boolean;
}

interface PanelState {
  open: boolean;
}

const ctx: EditorContext = { ui, widgets };

const renderMenuEntries = (entries: readonly MenuEntry[]): void => {
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
    const label = `${e.label ?? ''}##menu-${i}`;
    if (ImGui.MenuItem(label, e.shortcut, e.checked ?? false, e.disabled !== true)) e.onClick?.();
    if (e.danger === true) ImGui.PopStyleColor(1);
  }
};

/**
 * The editor shell: a scalable, registry-driven composition of a menu bar, a
 * toolbar, a dockable panel workspace, and a status bar. Register panels by path
 * id, register menus / toolbar / status regions, then call {@link Editor.draw}
 * each frame from a {@link uiOverlayPlugin} draw callback. The shell owns the
 * dockspace, the default layout, and the Window menu; it stays engine-agnostic —
 * panels close over their own data.
 */
export class Editor {
  private readonly panels = new Map<string, PanelDef>();
  private readonly panelOrder: string[] = [];
  private readonly panelState = new Map<string, PanelState>();
  private readonly menus: MenuDef[] = [];
  private toolbar: ToolbarDef | undefined;
  private statusBar: StatusBarDef | undefined;
  private pendingFocus: string | null = null;
  private readonly options: EditorOptions;

  /**
   * The inspector extension surface: register custom property renderers,
   * whole-component editors, and per-field amendments. Pre-seeded with the
   * baseline renderer for every reflection field kind, so components render
   * fully with no registration.
   */
  readonly inspector: InspectorRegistry = createInspectorRegistry();

  constructor(options: EditorOptions = {}) {
    this.options = options;
  }

  /** Register a dockable panel. Re-registering the same id replaces it. */
  addPanel(def: PanelDef): this {
    if (!this.panels.has(def.id)) this.panelOrder.push(def.id);
    this.panels.set(def.id, def);
    if (!this.panelState.has(def.id)) this.panelState.set(def.id, { open: def.hidden !== true });
    return this;
  }

  /** Register a top-level menu (rendered left-to-right in registration order). */
  addMenu(def: MenuDef): this {
    this.menus.push(def);
    return this;
  }

  /** Set the toolbar region renderer. */
  setToolbar(def: ToolbarDef): this {
    this.toolbar = def;
    return this;
  }

  /** Set the status-bar region renderer. */
  setStatusBar(def: StatusBarDef): this {
    this.statusBar = def;
    return this;
  }

  /** Show or hide a panel by id. */
  setPanelOpen(id: string, open: boolean): void {
    const s = this.panelState.get(id);
    if (s !== undefined) s.open = open;
  }

  /** Whether a panel is currently shown. */
  isPanelOpen(id: string): boolean {
    return this.panelState.get(id)?.open ?? false;
  }

  /**
   * Bring a panel to the front on the next frame — for a docked, tabbed panel this
   * selects its tab. Used by tooling (e.g. screenshotting a specific tab).
   */
  focusPanel(id: string): void {
    this.pendingFocus = id;
  }

  /** Every registered panel with its title and current visibility, in registration order. */
  listPanels(): { id: string; title: string; open: boolean }[] {
    return this.panelOrder.map((id) => ({
      id,
      title: this.panels.get(id)?.title ?? id,
      open: this.panelState.get(id)?.open ?? false,
    }));
  }

  /** The default dock-layout `ini` for the registered panels' slots. */
  defaultLayout(): string {
    const byslot: Record<'left' | 'right' | 'center' | 'bottom', string[]> = {
      left: [],
      right: [],
      center: [],
      bottom: [],
    };
    for (const id of this.panelOrder) {
      const def = this.panels.get(id);
      if (def === undefined) continue;
      const slot = def.slot ?? 'float';
      if (slot !== 'float') byslot[slot].push(id);
    }
    return buildDefaultLayout(byslot, this.options.dims);
  }

  /** Draw the whole shell for this frame. Call once per frame inside the overlay draw. */
  draw(): void {
    this.drawMenuBar();
    const viewport = ImGui.GetMainViewport();
    const wp = viewport.WorkPos;
    const ws = viewport.WorkSize;
    this.drawToolbar(wp.x, wp.y, ws.x);
    this.drawDockHost(wp.x, wp.y + RailHeight.toolbar, ws.x, ws.y - RailHeight.toolbar - RailHeight.status);
    this.drawPanels();
    this.drawStatusBar(wp.x, wp.y + ws.y - RailHeight.status, ws.x);
  }

  private drawMenuBar(): void {
    if (!ImGui.BeginMainMenuBar()) return;
    const p = getActivePalette();
    // Logo lockup: cube + crisp pixel wordmark + a 1px divider before the menus.
    const mh = ImGui.GetFrameHeight();
    const cube = 16;
    const brand = this.options.brand ?? 'RETRO ENGINE';
    const px = 1; // integer pixel scale keeps the wordmark crisp (7px tall)
    const wordW = pixelTextWidth(brand, px);
    const start = ui.cursorScreenPos();
    Draw.window().logoCube([start[0] + 6, start[1] + (mh - cube) / 2], cube);
    drawPixelText([start[0] + cube + 12, start[1] + (mh - 7 * px) / 2], brand, px, srgbU32(p.white));
    ui.dummy([cube + 12 + wordW + 12, mh]);
    ui.sameLine(0, 0);
    const sep = ui.cursorScreenPos();
    Draw.window().rectFilled([sep[0], sep[1] + 4], [sep[0] + 1, sep[1] + mh - 4], srgbU32(p.gray6));
    ui.dummy([1, mh]);
    ui.sameLine(0, 12);
    for (const menu of this.menus) {
      if (ImGui.BeginMenu(menu.label)) {
        renderMenuEntries(menu.items());
        ImGui.EndMenu();
      }
    }
    if (this.options.windowMenu !== false && ImGui.BeginMenu('Window')) {
      renderMenuEntries(this.windowMenuEntries());
      ImGui.EndMenu();
    }
    // Branch indicator, right-aligned (git glyph vertically centered + text).
    if (this.options.branch !== undefined) {
      const text = this.options.branch();
      const faint: Rgba = [p.textFaint[0] / 255, p.textFaint[1] / 255, p.textFaint[2] / 255, 1];
      const iconSz = 13;
      const tw = iconSz + 6 + ui.calcTextSize(text)[0];
      ImGui.SetCursorPosX(ImGui.GetWindowWidth() - tw - 10);
      const cs = ui.cursorScreenPos();
      drawIcon('git-branch', [cs[0], cs[1] + (mh - iconSz) / 2], iconSz, srgbU32(p.textFaint));
      ui.dummy([iconSz, mh]);
      ui.sameLine(0, 6);
      ui.alignTextToFramePadding();
      ui.textColored(faint, text);
    }
    ImGui.EndMainMenuBar();
  }

  private windowMenuEntries(): MenuEntry[] {
    return this.panelOrder.map((id): MenuEntry => {
      const def = this.panels.get(id);
      const s = this.panelState.get(id);
      return {
        label: def?.title ?? id,
        icon: def?.icon,
        checked: s?.open ?? false,
        onClick: () => this.setPanelOpen(id, !(s?.open ?? false)),
      };
    });
  }

  private chromeWindow(id: string, x: number, y: number, w: number, h: number, body: () => void): void {
    ui.window(
      {
        title: `###${id}`,
        fixedPos: [x, y],
        fixedSize: [w, h],
        noTitleBar: true,
        noResize: true,
        noMove: true,
        noCollapse: true,
        noDocking: true,
        noScrollbar: true,
        noSavedSettings: true,
        noBringToFrontOnFocus: true,
        noNavFocus: true,
        padding: [8, 6],
      },
      body,
    );
  }

  private drawToolbar(x: number, y: number, w: number): void {
    if (this.toolbar === undefined) return;
    const p = getActivePalette();
    ImGui.PushStyleColor(ImGuiCol.WindowBg, srgbU32(p.gray3));
    this.chromeWindow('re-toolbar', x, y, w, RailHeight.toolbar, () => {
      this.toolbar?.render(ctx, w - 16);
    });
    ImGui.PopStyleColor(1);
  }

  private drawStatusBar(x: number, y: number, w: number): void {
    if (this.statusBar === undefined) return;
    const p = getActivePalette();
    ImGui.PushStyleColor(ImGuiCol.WindowBg, srgbU32(p.gray0));
    this.chromeWindow('re-statusbar', x, y, w, RailHeight.status, () => {
      this.statusBar?.render(ctx, w - 16);
    });
    ImGui.PopStyleColor(1);
  }

  private drawDockHost(x: number, y: number, w: number, h: number): void {
    ui.window(
      {
        title: '###re-dockhost',
        fixedPos: [x, y],
        fixedSize: [w, h],
        noTitleBar: true,
        noResize: true,
        noMove: true,
        noCollapse: true,
        noDocking: true,
        noBringToFrontOnFocus: true,
        noNavFocus: true,
        noBackground: true,
        padding: [0, 0],
      },
      () => {
        ui.dockSpace(DockNodeId.main);
      },
    );
  }

  private drawPanels(): void {
    for (const id of this.panelOrder) {
      const def = this.panels.get(id);
      const state = this.panelState.get(id);
      if (def === undefined || state === undefined || !state.open) continue;
      const count = def.count?.();
      const countText = count !== undefined ? `   ${count}` : '';
      const name = `${def.title.toUpperCase()}${countText}###${id}`;
      const dock = nodeForSlot(def.slot ?? 'float');
      if (dock !== undefined) ImGui.SetNextWindowDockID(dock, ImGuiCond.FirstUseEver);
      // Honour a pending focus request: selects this panel's dock tab this frame.
      if (this.pendingFocus === id) {
        ImGui.SetNextWindowFocus();
        this.pendingFocus = null;
      }
      ui.window(
        {
          title: name,
          // Flush panels manage their own scrolling children (tree, console,
          // asset grid), so the panel window itself never scrolls — that keeps
          // their footers pinned instead of disappearing under a scrollbar.
          ...(def.flush === true ? { padding: [0, 0], noScrollbar: true, noScrollWithMouse: true } : {}),
          ...(def.closable === true ? { onClose: () => this.setPanelOpen(id, false) } : {}),
        },
        () => def.render(ctx),
      );
    }
  }
}

/** Construct an {@link Editor} shell. Register panels/menus/regions, then call `draw()` each frame. */
export const createEditor = (options?: EditorOptions): Editor => new Editor(options);
