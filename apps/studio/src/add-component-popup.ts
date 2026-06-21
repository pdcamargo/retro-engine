import { ImGui, ImGuiCond, ImGuiKey, ImGuiStyleVar, ImGuiWindowFlags, ImVec2 } from '@mori2003/jsimgui';
import {
  Draw,
  drawIcon,
  type EditorContext,
  type EditCommand,
  getActivePalette,
  type History,
  type IconName,
  srgbU32,
} from '@retro-engine/editor-sdk';
import { type App, AppTypeRegistry } from '@retro-engine/engine';
import type { RegisteredType, TypeRegistry } from '@retro-engine/reflect';

import { type StudioState } from './state';

/**
 * Per-component presentation: which category trail it lives under (empty = a
 * top-level leaf), its row icon, and a one-line description shown in the footer.
 * Anything not listed falls back to the "Uncategorized" bucket — the picker still
 * lists every registered, attachable component, mapped or not.
 */
const CATALOG: Readonly<Record<string, { path?: readonly string[]; icon?: IconName; desc?: string }>> = {
  Transform: { icon: 'move-3d', desc: 'Position, rotation & scale' },
  Name: { icon: 'tag', desc: 'Human-readable entity name' },
  Parent: { icon: 'workflow', desc: 'Attach under a parent entity' },
  // Rendering
  Camera: { path: ['Rendering'], icon: 'video', desc: 'Renders the scene into a target' },
  Sprite: { path: ['Rendering'], icon: 'image', desc: '2D textured quad' },
  MeshRenderer: { path: ['Rendering'], icon: 'box', desc: 'Draws a mesh with a material' },
  Skybox: { path: ['Rendering'], icon: 'image', desc: 'Environment cube background' },
  EnvironmentMapLight: { path: ['Rendering'], icon: 'sun', desc: 'Image-based ambient light' },
  PointLight: { path: ['Rendering', 'Light'], icon: 'lightbulb', desc: 'Omnidirectional light' },
  DirectionalLight: { path: ['Rendering', 'Light'], icon: 'sun', desc: 'Sun-style parallel light' },
  SpotLight: { path: ['Rendering', 'Light'], icon: 'lightbulb', desc: 'Cone light' },
  // Physics
  RigidBody: { path: ['Physics'], icon: 'circle-dot', desc: 'Dynamic physics body' },
  Collider: { path: ['Physics'], icon: 'shapes', desc: 'Collision shape' },
  // Audio
  AudioSource: { path: ['Audio'], icon: 'volume-2', desc: 'Plays a sound' },
  AudioListener: { path: ['Audio'], icon: 'audio-lines', desc: 'The ear of the scene' },
};

const CATEGORY_ICON: Readonly<Record<string, IconName>> = {
  Rendering: 'image',
  Light: 'lightbulb',
  Physics: 'circle-dot',
  Audio: 'volume-2',
  Uncategorized: 'blocks',
};

/** One leaf (an addable component) flattened from the registry. */
interface Leaf {
  readonly reg: RegisteredType;
  readonly label: string;
  readonly icon: IconName;
  readonly desc?: string | undefined;
  readonly path: readonly string[];
  /** Already present on the selected entity — shown greyed, not selectable. */
  readonly added: boolean;
}

/** A rendered row: either a category to drill into or a selectable leaf. */
type Row =
  | { readonly kind: 'category'; readonly label: string; readonly icon: IconName }
  | { readonly kind: 'leaf'; readonly leaf: Leaf; readonly matched?: ReadonlySet<number> };

// --- fuzzy match (AddComponentMenu.md §4, ported verbatim) -------------------

interface FuzzyHit {
  readonly score: number;
  readonly matched: Set<number>;
}

const fuzzy = (label: string, query: string): FuzzyHit | null => {
  const l = label.toLowerCase();
  const q = query.toLowerCase();
  const matched = new Set<number>();
  let score = 0;
  let prevMatch = -2;
  let qi = 0;
  for (let i = 0; i < l.length && qi < q.length; i++) {
    if (l[i] !== q[qi]) continue;
    score += i === prevMatch + 1 ? 4 : 1;
    if (i === 0 || !/[a-z0-9]/i.test(label[i - 1]!)) score += 3;
    matched.add(i);
    prevMatch = i;
    qi++;
  }
  if (qi < q.length) return null; // not all query chars matched
  score -= 0.04 * (label.length - query.length);
  return { score, matched };
};

// --- module-level transient picker state (single popup instance) -------------

const POPUP = 'add-component-popup';
let opened = false;
let query = '';
let pathStack: string[] = [];
let active = 0;
let focusSearch = false;
// Screen-space anchor (the click point) captured when the popup opens.
let anchor: [number, number] = [0, 0];

const startsWith = (path: readonly string[], prefix: readonly string[]): boolean =>
  prefix.every((seg, i) => path[i] === seg);

/** Flatten the registry into addable leaves, tagging those already on `entity`. */
const collectLeaves = (app: App, registry: TypeRegistry, entity: number | null): Leaf[] => {
  const present = new Set<string>();
  if (entity !== null && app.world.hasEntity(entity as never)) {
    for (const ctor of app.world.componentTypesOf(entity as never)) {
      const reg = registry.getByCtor(ctor);
      if (reg !== undefined) present.add(reg.name);
    }
  }
  const leaves: Leaf[] = [];
  for (const reg of registry.components()) {
    if (!reg.attachable) continue;
    const cat = CATALOG[reg.name];
    leaves.push({
      reg,
      label: reg.name,
      icon: cat?.icon ?? 'component',
      desc: cat?.desc,
      path: cat?.path ?? (cat === undefined ? ['Uncategorized'] : []),
      added: present.has(reg.name),
    });
  }
  return leaves.sort((a, b) => a.label.localeCompare(b.label));
};

/** Build the rows for the current level (browse) or the flat fuzzy results (search). */
const buildRows = (leaves: readonly Leaf[]): Row[] => {
  const trimmed = query.trim();
  if (trimmed.length > 0) {
    const hits: { row: Row; score: number }[] = [];
    for (const leaf of leaves) {
      const hit = fuzzy(leaf.label, trimmed);
      if (hit !== null) hits.push({ row: { kind: 'leaf', leaf, matched: hit.matched }, score: hit.score });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, 50).map((h) => h.row);
  }
  const atLevel = leaves.filter((l) => startsWith(l.path, pathStack));
  const direct = atLevel.filter((l) => l.path.length === pathStack.length);
  const subCats = new Set<string>();
  for (const l of atLevel) if (l.path.length > pathStack.length) subCats.add(l.path[pathStack.length]!);
  const categories: Row[] = [...subCats]
    .sort()
    .map((c) => ({ kind: 'category', label: c, icon: CATEGORY_ICON[c] ?? 'blocks' }) as const);
  const leafRows: Row[] = direct.map((leaf) => ({ kind: 'leaf', leaf }) as const);
  return [...categories, ...leafRows];
};

const ROW_H = 30;

export const addComponentPopup = (
  { ui }: EditorContext,
  state: StudioState,
  app: App,
  history: History,
): void => {
  // Open exactly once per flip of the flag; reset the transient picker state.
  if (state.addComponentOpen && !opened) {
    ImGui.OpenPopup(POPUP);
    opened = true;
    query = '';
    pathStack = [];
    active = 0;
    focusSearch = true;
    // Anchor at the click point (the mouse is on the button / menu item). ImGui
    // clamps the popup to stay on-screen, so a near-edge click still fits.
    const m = ImGui.GetMousePos();
    anchor = [m.x, m.y];
  }
  if (!state.addComponentOpen) opened = false;

  const p = getActivePalette();
  ImGui.SetNextWindowPos(new ImVec2(anchor[0], anchor[1]), ImGuiCond.Appearing);
  ImGui.SetNextWindowSize(new ImVec2(300, 0), ImGuiCond.Appearing);
  ImGui.PushStyleVarImVec2(ImGuiStyleVar.WindowPadding, new ImVec2(0, 0));

  const open = ImGui.BeginPopup(POPUP, ImGuiWindowFlags.NoMove);
  ImGui.PopStyleVar(1);
  if (!open) {
    // Popup dismissed (Esc / click outside) — sync the studio flag back.
    if (state.addComponentOpen) {
      state.addComponentOpen = false;
      opened = false;
    }
    return;
  }

  const registry = app.getResource(AppTypeRegistry)!.registry;
  const leaves = collectLeaves(app, registry, state.selectedEntity);
  const rows = buildRows(leaves);
  if (active >= rows.length) active = Math.max(0, rows.length - 1);

  // Flush layout: no gaps between the title / search / header / list / footer
  // strips, and contiguous 30px rows in the list.
  ImGui.PushStyleVarImVec2(ImGuiStyleVar.ItemSpacing, new ImVec2(0, 0));
  const dl = Draw.window();
  const fullW = 300;
  const searching = query.trim().length > 0;

  const close = (): void => {
    ImGui.CloseCurrentPopup();
    state.addComponentOpen = false;
    opened = false;
  };
  const drill = (label: string): void => {
    pathStack = [...pathStack, label];
    query = '';
    active = 0;
    focusSearch = true;
  };
  const back = (): void => {
    if (searching) query = '';
    else if (pathStack.length > 0) pathStack = pathStack.slice(0, -1);
    active = 0;
    focusSearch = true;
  };
  const selectLeaf = (leaf: Leaf): void => {
    if (leaf.added || state.selectedEntity === null) return;
    const cmd: EditCommand = {
      kind: 'addComponent',
      entity: state.selectedEntity as never,
      componentName: leaf.reg.name,
      after: leaf.reg.make(),
      label: `Add ${leaf.reg.name}`,
    };
    history.apply(cmd);
    close();
  };
  const activate = (row: Row): void => {
    if (row.kind === 'category') drill(row.label);
    else selectLeaf(row.leaf);
  };

  // ① Title bar (30px) — surface-raised, centered label, bottom hairline.
  const titleTop = ui.cursorScreenPos();
  dl.rectFilled([titleTop[0], titleTop[1]], [titleTop[0] + fullW, titleTop[1] + 30], srgbU32(p.gray3));
  dl.line([titleTop[0], titleTop[1] + 30], [titleTop[0] + fullW, titleTop[1] + 30], srgbU32(p.gray6));
  const title = 'Add Component';
  const tw = ui.calcTextSize(title)[0];
  dl.text([titleTop[0] + (fullW - tw) / 2, titleTop[1] + 8], srgbU32(p.white), title);
  ui.dummy([fullW, 30]);

  // ② Search field (auto-focused on open / level change).
  ui.child('ac-search', { size: [0, 40], border: false, padding: [7, 7] }, () => {
    if (focusSearch) {
      ui.setKeyboardFocusHere();
      focusSearch = false;
    }
    query = ui.inputText('##ac-q', query, { hint: 'Search', width: fullW - 14 });
  });

  // ③ Level header (25px) — back chevron when drilled/searching + centered label.
  const hdrTop = ui.cursorScreenPos();
  dl.rectFilled([hdrTop[0], hdrTop[1]], [hdrTop[0] + fullW, hdrTop[1] + 25], srgbU32(p.gray1));
  dl.line([hdrTop[0], hdrTop[1] + 25], [hdrTop[0] + fullW, hdrTop[1] + 25], srgbU32(p.gray6));
  const canBack = searching || pathStack.length > 0;
  if (canBack) {
    if (ui.invisibleButton('ac-back', [28, 25])) back();
    drawIcon('chevron-left', [hdrTop[0] + 8, hdrTop[1] + 6], 13, srgbU32(ui.isItemHovered() ? p.white : p.textMuted));
    ui.setCursorScreenPos(hdrTop);
  }
  const hdrLabel = searching ? 'Results' : (pathStack[pathStack.length - 1] ?? 'Component');
  const hw = ui.calcTextSize(hdrLabel)[0];
  dl.text([hdrTop[0] + (fullW - hw) / 2, hdrTop[1] + 6], srgbU32(p.white), hdrLabel);
  ui.dummy([fullW, 25]);

  // ④ List (scrolls, max-height 340).
  const listH = Math.min(340, Math.max(ROW_H + 12, rows.length * ROW_H + 6));
  let activeDesc: string | undefined;
  ui.child('ac-list', { size: [0, listH], border: false, padding: [3, 3] }, () => {
    const fs = ImGui.GetFontSize();
    const cw = fs * 0.6;
    const th = ui.textLineHeight();
    for (const [i, row] of rows.entries()) {
      const start = ui.cursorScreenPos();
      const rowW = ui.contentAvail()[0];
      const disabled = row.kind === 'leaf' && row.leaf.added;
      const clicked = ui.invisibleButton(`ac-row-${i}`, [rowW, ROW_H]);
      if (ui.isItemHovered()) active = i;
      if (clicked) activate(row);
      const isActive = i === active;
      const cy = start[1] + ROW_H / 2;
      const rdl = Draw.window();
      if (isActive) {
        rdl.rectFilled([start[0], start[1]], [start[0] + rowW, start[1] + ROW_H], srgbU32(p.green400, 0.14), 2);
        rdl.rectFilled([start[0], start[1]], [start[0] + 2, start[1] + ROW_H], srgbU32(p.green400));
      }
      const iconCol = srgbU32(isActive ? p.green400 : p.textMuted, disabled ? 0.4 : 1);
      const labelCol = srgbU32(isActive ? p.green300 : p.text, disabled ? 0.4 : 1);
      const icon = row.kind === 'category' ? row.icon : row.leaf.icon;
      const label = row.kind === 'category' ? row.label : row.leaf.label;
      drawIcon(icon, [start[0] + 8, cy - 8], 15, iconCol);
      const labelX = start[0] + 30;
      if (row.kind === 'leaf' && row.matched !== undefined && !disabled) {
        for (let c = 0; c < label.length; c++) {
          rdl.text([labelX + c * cw, cy - th / 2], row.matched.has(c) ? srgbU32(p.green300) : labelCol, label[c]!);
        }
      } else {
        rdl.text([labelX, cy - th / 2], labelCol, label);
      }
      // Right slots: breadcrumb (search) · Added tag · category chevron.
      if (row.kind === 'leaf' && row.matched !== undefined && row.leaf.path.length > 0) {
        const crumb = row.leaf.path.join(' / ');
        const crumbW = Math.min(108, ui.calcTextSize(crumb)[0]);
        rdl.text([start[0] + rowW - crumbW - 10, cy - th / 2], srgbU32(p.textFaint), crumb);
      }
      if (row.kind === 'leaf' && row.leaf.added) {
        const tag = '✓ Added';
        const twd = ui.calcTextSize(tag)[0];
        rdl.text([start[0] + rowW - twd - 10, cy - th / 2], srgbU32(p.textFaint), tag);
      }
      if (row.kind === 'category') {
        drawIcon('chevron-right', [start[0] + rowW - 18, cy - 6], 12, srgbU32(p.textFaint));
      }
      if (isActive && row.kind === 'leaf') activeDesc = row.leaf.desc;
    }
    if (rows.length === 0) {
      ui.dummy([0, 10]);
      ui.textColored([p.textFaint[0] / 255, p.textFaint[1] / 255, p.textFaint[2] / 255, 1], `  No components match "${query.trim()}".`);
    }
  });

  // ⑤ Footer (24px) — active leaf description, else the keyboard hint.
  const footTop = ui.cursorScreenPos();
  dl.rectFilled([footTop[0], footTop[1]], [footTop[0] + fullW, footTop[1] + 24], srgbU32(p.gray3));
  dl.line([footTop[0], footTop[1]], [footTop[0] + fullW, footTop[1]], srgbU32(p.gray6));
  drawIcon('chevron-right', [footTop[0] + 9, footTop[1] + 7], 11, srgbU32(p.green400));
  const footText = activeDesc ?? '↑↓ navigate   ↵ select   esc close';
  dl.text([footTop[0] + 24, footTop[1] + 6], srgbU32(p.textMuted), footText);
  ui.dummy([fullW, 24]);

  // Keyboard navigation (the search field stays focused, so typing still filters).
  const pressed = (k: number): boolean => ImGui.IsKeyPressed(k, true);
  if (pressed(ImGuiKey._DownArrow)) active = Math.min(rows.length - 1, active + 1);
  if (pressed(ImGuiKey._UpArrow)) active = Math.max(0, active - 1);
  if (!searching && pressed(ImGuiKey._RightArrow)) {
    const row = rows[active];
    if (row?.kind === 'category') drill(row.label);
  }
  if (!searching && pressed(ImGuiKey._LeftArrow)) back();
  if (query.length === 0 && pressed(ImGuiKey._Backspace)) back();
  if (pressed(ImGuiKey._Enter) || pressed(ImGuiKey._KeypadEnter)) {
    const row = rows[active];
    if (row !== undefined) activate(row);
  }

  ImGui.PopStyleVar(1);
  ImGui.EndPopup();
};
