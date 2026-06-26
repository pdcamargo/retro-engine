import { ImGui, ImGuiCol, ImGuiCond, ImGuiHoveredFlags, ImGuiKey, ImGuiStyleVar, ImGuiWindowFlags, ImVec2 } from '@mori2003/jsimgui';
import type { AssetGuid } from '@retro-engine/assets';
import {
  ASSET_TYPES,
  Draw,
  drawIcon,
  type EditorContext,
  getActivePalette,
  type IconName,
  labelColumnWidth,
  srgbU32,
  toneColors,
} from '@retro-engine/editor-sdk';
import { type App, AssetServer } from '@retro-engine/engine';

import type { BrowserAsset, ProjectBrowser } from '../project/project-browser';
import { tileFor } from '../state';
import type { StudioState } from '../state';
import {
  type AssetTypeSpec,
  assetTypeSpec,
  buildFolderTree,
  filterAssets,
  type FolderNode,
  folderOf,
  isCompatible,
  presentTypes,
  sortAssets,
} from './asset-picker-catalog';
import {
  type AssetPickerState,
  type AssetPickerZoom,
  type AssetSort,
  closeAssetPicker,
  pushRecent,
} from './asset-picker-state';
import { pickerBrowser } from './picker-pool';

const POPUP = 'asset-picker';
const W = 1000;
const H = 660;
const TREE_W = 178;
const PREVIEW_W = 244;
const FOOTER_H = 48;
const TITLE_H = 42;
const CTX_H = 44;
const TOOLBAR_H = 46;
const PREVIEW_HEAD_H = 30;
const LINE = 14;

let opened = false;

const titleIcon = (spec: AssetTypeSpec): IconName =>
  spec.types === null
    ? 'shapes'
    : spec.types.includes('mesh')
      ? 'box'
      : spec.types.includes('material')
        ? 'circle-dot'
        : 'image';

const ZOOMS: AssetPickerZoom[] = ['list', 'sm', 'md', 'lg'];
const cap = (s: string): string => (s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1));

/** Resolve a GUID to its asset only when it exists and is assignable to the slot. */
const compatAsset = (browser: ProjectBrowser | null, guid: string | null, spec: AssetTypeSpec): BrowserAsset | undefined => {
  if (guid === null) return undefined;
  const asset = browser?.assets.find((a) => a.guid === guid);
  return asset !== undefined && isCompatible(asset, spec) ? asset : undefined;
};

/**
 * The asset picker modal — assign one asset to a handle-typed component property.
 * Drawn every frame; renders nothing until `state.assetPicker.open` flips true.
 * Reads the live project browser for the assignable pool + thumbnails, resolves
 * the chosen GUID to a handle through the {@link AssetServer}, and commits it via
 * the closure the opener captured. The Claude Design "Asset Picker" is the spec.
 */
export const assetPickerModal = (ctx: EditorContext, state: StudioState, app: App): void => {
  const { ui } = ctx;
  const picker = state.assetPicker;

  if (picker.open && !opened) {
    ImGui.OpenPopup(POPUP);
    opened = true;
  }
  if (!picker.open) opened = false;

  const center = ImGui.GetMainViewport().GetCenter();
  ImGui.SetNextWindowPos(center, ImGuiCond.Appearing, new ImVec2(0.5, 0.5));
  ImGui.SetNextWindowSize(new ImVec2(W, H), ImGuiCond.Appearing);
  ImGui.PushStyleVarImVec2(ImGuiStyleVar.WindowPadding, new ImVec2(0, 0));
  const open = ImGui.BeginPopupModal(
    POPUP,
    null,
    ImGuiWindowFlags.NoResize | ImGuiWindowFlags.NoTitleBar | ImGuiWindowFlags.NoSavedSettings,
  );
  ImGui.PopStyleVar(1);
  if (!open) {
    if (picker.open) closeAssetPicker(picker);
    return;
  }

  // Escape and a click on the dimmed backdrop dismiss the picker. ImGui modals
  // don't close on an outside click on their own, and the in-modal close paths
  // only flip our state — the actual ImGui dismissal happens via the
  // CloseCurrentPopup below, once `picker.open` has gone false.
  if (ImGui.IsKeyPressed(ImGuiKey._Escape, false)) closeAssetPicker(picker);
  if (ImGui.IsMouseClicked(0, false) && !ImGui.IsWindowHovered(ImGuiHoveredFlags.RootAndChildWindows)) {
    closeAssetPicker(picker);
  }

  // The pool includes a model's assignable derived clips, not just top-level files.
  const browser = pickerBrowser(app, state.browser);
  const spec = assetTypeSpec(picker.allowedStoreType);
  const shown =
    browser === null
      ? []
      : sortAssets(
          filterAssets(browser.assets, {
            spec,
            folder: picker.folder,
            typeFilter: picker.typeFilter,
            query: picker.query,
            favorites: picker.favorites,
            recent: picker.recent,
          }),
          picker.sort,
          picker.recent,
        );

  ImGui.PushStyleVarImVec2(ImGuiStyleVar.ItemSpacing, new ImVec2(0, 0));
  renderTitleBar(ctx, spec, () => closeAssetPicker(picker));
  renderContextRow(ctx, picker, spec, browser);
  renderToolbar(ctx, picker, browser, spec);

  const avail = ui.contentAvail();
  const bodyH = avail[1] - FOOTER_H;
  const gridW = Math.max(220, avail[0] - TREE_W - PREVIEW_W);

  renderTree(ctx, picker, browser, spec, [TREE_W, bodyH]);
  ImGui.SameLine(0, 0);
  renderGrid(ctx, picker, browser, shown, [gridW, bodyH]);
  ImGui.SameLine(0, 0);
  renderPreview(ctx, picker, browser, spec, [PREVIEW_W, bodyH]);

  renderFooter(ctx, state, app, browser, spec, shown.length);
  ImGui.PopStyleVar(1);

  // Any close path (title X, footer Cancel/None, Assign, Escape, backdrop) flips
  // `picker.open`; this is the single point that tells ImGui to drop the popup,
  // otherwise BeginPopupModal keeps returning open and the modal never goes away.
  if (!picker.open) ImGui.CloseCurrentPopup();

  ImGui.EndPopup();
};

// ── Title bar ────────────────────────────────────────────────────────────────

const renderTitleBar = (ctx: EditorContext, spec: AssetTypeSpec, close: () => void): void => {
  const { ui } = ctx;
  const p = getActivePalette();
  const dl = Draw.window();
  const top = ui.cursorScreenPos();
  const w = ui.contentAvail()[0];
  dl.rectFilled([top[0], top[1]], [top[0] + w, top[1] + TITLE_H], srgbU32(p.gray3));
  dl.line([top[0], top[1] + TITLE_H], [top[0] + w, top[1] + TITLE_H], srgbU32(p.gray6));
  // Icon in a rounded accent-soft badge.
  dl.rectFilled([top[0] + 12, top[1] + 10], [top[0] + 34, top[1] + 32], srgbU32(p.green400, 0.16), 3);
  dl.rect([top[0] + 12, top[1] + 10], [top[0] + 34, top[1] + 32], srgbU32(p.green400, 0.4), 3);
  drawIcon(titleIcon(spec), [top[0] + 16, top[1] + 14], 14, srgbU32(p.green400));
  dl.text([top[0] + 44, top[1] + 16], srgbU32(p.textMuted), 'ASSIGN');
  const ebW = ui.calcTextSize('ASSIGN')[0];
  dl.text([top[0] + 44 + ebW + 14, top[1] + 14], srgbU32(p.white), `Select ${spec.noun}`);
  ui.setCursorScreenPos([top[0] + w - 36, top[1] + 7]);
  const closed = ui.invisibleButton('ap-close', [28, 28]);
  drawIcon('x', [top[0] + w - 30, top[1] + 13], 16, srgbU32(ui.isItemHovered() ? p.white : p.textMuted));
  if (closed) close();
  ui.setCursorScreenPos(top);
  ui.dummy([w, TITLE_H]);
};

// ── Context row (entity ▸ Component.prop · expects NOUN · current) ─────────────

const renderContextRow = (
  ctx: EditorContext,
  picker: AssetPickerState,
  spec: AssetTypeSpec,
  browser: ProjectBrowser | null,
): void => {
  const { ui } = ctx;
  const p = getActivePalette();
  const dl = Draw.window();
  const top = ui.cursorScreenPos();
  const w = ui.contentAvail()[0];
  dl.rectFilled([top[0], top[1]], [top[0] + w, top[1] + CTX_H], srgbU32(p.gray2));
  dl.line([top[0], top[1] + CTX_H], [top[0] + w, top[1] + CTX_H], srgbU32(p.gray6));
  const cy = top[1] + CTX_H / 2;
  let x = top[0] + 14;
  const put = (text: string, col: number, gap = 8): void => {
    dl.text([x, cy - LINE / 2], col, text);
    x += ui.calcTextSize(text)[0] + gap;
  };
  // Entity pill (accent-soft) — only when assigning a live entity's component.
  if (picker.entityLabel !== '') {
    const nameW = ui.calcTextSize(picker.entityLabel)[0];
    const pillW = 26 + nameW + 12;
    dl.rectFilled([x, cy - 14], [x + pillW, cy + 14], srgbU32(p.green400, 0.16), 3);
    dl.rect([x, cy - 14], [x + pillW, cy + 14], srgbU32(p.green400, 0.5), 3);
    drawIcon('box', [x + 8, cy - 7], 14, srgbU32(p.green400));
    dl.text([x + 26, cy - LINE / 2], srgbU32(p.white), picker.entityLabel);
    x += pillW + 8;
    drawIcon('chevron-right', [x, cy - 6], 12, srgbU32(p.textFaint));
    x += 16;
  }
  put(picker.componentLabel, srgbU32(p.text), 4);
  put('.', srgbU32(p.textFaint), 4);
  put(picker.propertyLabel, srgbU32(p.green300), 10);
  // "expects NOUN" pill.
  const expects = `expects ${spec.noun}`;
  const exW = 22 + ui.calcTextSize(expects)[0] + 10;
  dl.rectFilled([x, cy - 11], [x + exW, cy + 11], srgbU32(p.gray4), 2);
  dl.rect([x, cy - 11], [x + exW, cy + 11], srgbU32(p.gray6), 2);
  drawIcon('circle-dot', [x + 7, cy - 6], 11, srgbU32(p.textMuted));
  dl.text([x + 22, cy - LINE / 2], srgbU32(p.textMuted), expects);

  // Current assignment, right-aligned in a subtle pill.
  const current = picker.currentGuid !== null ? browser?.assets.find((a) => a.guid === picker.currentGuid) : undefined;
  if (current !== undefined) {
    const label = 'current';
    const lw = ui.calcTextSize(label)[0];
    const nw = ui.calcTextSize(current.name)[0];
    const pw = 10 + lw + 6 + nw + 10;
    const px = top[0] + w - 14 - pw;
    dl.rectFilled([px, cy - 11], [px + pw, cy + 11], srgbU32(p.gray3), 2);
    dl.rect([px, cy - 11], [px + pw, cy + 11], srgbU32(p.gray6), 2);
    dl.text([px + 10, cy - LINE / 2], srgbU32(p.textFaint), label);
    dl.text([px + 10 + lw + 6, cy - LINE / 2], srgbU32(p.text), current.name);
  }
  ui.setCursorScreenPos(top);
  ui.dummy([w, CTX_H]);
};

// ── Toolbar (search · type chips · sort · zoom) ───────────────────────────────

const renderToolbar = (
  ctx: EditorContext,
  picker: AssetPickerState,
  browser: ProjectBrowser | null,
  spec: AssetTypeSpec,
): void => {
  const { ui, widgets } = ctx;
  const p = getActivePalette();
  const dl = Draw.window();
  const top = ui.cursorScreenPos();
  const w = ui.contentAvail()[0];
  dl.rectFilled([top[0], top[1]], [top[0] + w, top[1] + TOOLBAR_H], srgbU32(p.gray2));
  dl.line([top[0], top[1] + TOOLBAR_H], [top[0] + w, top[1] + TOOLBAR_H], srgbU32(p.gray6));

  // Absolute, single-row layout: search on the left, sort + zoom pinned right,
  // type chips between. Each item is positioned explicitly so nothing wraps.
  const frameH = ui.frameHeight();
  const rowY = top[1] + (TOOLBAR_H - frameH) / 2;
  const chipH = 24;
  const chipY = top[1] + (TOOLBAR_H - chipH) / 2;

  let x = top[0] + 12;
  ui.setCursorScreenPos([x, rowY]);
  picker.query = ui.inputText('##ap-search', picker.query, { hint: 'Search assets', width: 234 });
  x += 234 + 10;

  // Right group: sort dropdown + zoom (icon · range · size letter).
  const sortW = 96;
  const zoomRange = 54;
  const zoomW = 18 + zoomRange + 26;
  const zoomX = top[0] + w - 12 - zoomW;
  const sortX = zoomX - 10 - sortW;
  ui.setCursorScreenPos([sortX, rowY]);
  picker.sort = widgets.combo(
    'ap-sort',
    picker.sort,
    [
      { value: 'name', label: 'Name' },
      { value: 'type', label: 'Type' },
      { value: 'recent', label: 'Recent' },
    ],
    sortW,
  ) as AssetSort;
  drawIcon('image', [zoomX, rowY + (frameH - 13) / 2], 13, srgbU32(p.textMuted));
  ui.setCursorScreenPos([zoomX + 18, rowY]);
  const zi = widgets.range('ap-zoom', ZOOMS.indexOf(picker.zoom), 0, 3, zoomRange);
  picker.zoom = ZOOMS[zi] ?? 'md';
  dl.text(
    [zoomX + 18 + zoomRange + 8, rowY + (frameH - LINE) / 2],
    srgbU32(p.textMuted),
    ['List', 'S', 'M', 'L'][zi] ?? 'M',
  );

  // Chips between the search box and the sort control.
  const chip = (id: string, label: string): void => {
    const cw = ui.calcTextSize(label)[0] + 18;
    if (x + cw > sortX - 10) return;
    const active = picker.typeFilter === id;
    ui.setCursorScreenPos([x, chipY]);
    const clicked = ui.invisibleButton(`ap-chip-${id}`, [cw, chipH]);
    const hov = ui.isItemHovered();
    dl.rectFilled([x, chipY], [x + cw, chipY + chipH], srgbU32(active ? p.green400 : p.gray3, active ? 0.18 : 1), 2);
    dl.rect([x, chipY], [x + cw, chipY + chipH], srgbU32(active ? p.green400 : hov ? p.gray7 : p.gray6), 2);
    dl.text([x + 9, chipY + (chipH - LINE) / 2], srgbU32(active ? p.green300 : p.textMuted), label);
    if (clicked) picker.typeFilter = id;
    x += cw + 5;
  };
  chip('all', 'All');
  if (browser !== null) for (const t of presentTypes(browser.assets, spec)) chip(t, cap(t));

  ui.setCursorScreenPos(top);
  ui.dummy([w, TOOLBAR_H]);
};

// ── Folder tree (smart folders + nested folders) ──────────────────────────────

const renderTree = (
  ctx: EditorContext,
  picker: AssetPickerState,
  browser: ProjectBrowser | null,
  spec: AssetTypeSpec,
  size: [number, number],
): void => {
  const { ui, widgets } = ctx;
  const p = getActivePalette();
  ImGui.PushStyleColor(ImGuiCol.ChildBg, srgbU32(p.gray1));
  ui.child('ap-tree', { size, border: true, padding: [4, 6] }, () => {
    const pool = browser === null ? [] : browser.assets.filter((a) => spec.types === null || spec.types.includes(a.type));
    const favCount = pool.filter((a) => picker.favorites.has(a.guid)).length;
    const recentCount = pool.filter((a) => picker.recent.includes(a.guid)).length;

    const smart = (id: string, label: string, icon: IconName, count: number): void => {
      const r = widgets.treeItem({
        id: `ap-sf-${id}`,
        label,
        icon,
        depth: 0,
        selected: picker.folder === id,
        badge: String(count),
      });
      if (r.clicked) picker.folder = id;
    };
    smart('all', 'All Assets', 'layers', pool.length);
    smart('fav', 'Favorites', 'star', favCount);
    smart('recent', 'Recent', 'history', recentCount);

    const fstart = ui.cursorScreenPos();
    Draw.window().text([fstart[0] + 6, fstart[1] + 6], srgbU32(p.textFaint), 'FOLDERS');
    ui.dummy([size[0], 22]);

    const root = buildFolderTree(pool);
    const walk = (node: FolderNode, depth: number): void => {
      for (const child of [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name))) {
        const hasKids = child.children.size > 0;
        const isOpen = picker.expandedFolders.has(child.path);
        const r = widgets.treeItem({
          id: `ap-f-${child.path}`,
          label: cap(child.name),
          icon: hasKids && isOpen ? 'folder-open' : 'folder',
          depth,
          hasChildren: hasKids,
          open: isOpen,
          selected: picker.folder === child.path,
          badge: String(child.count),
        });
        if (r.toggled) {
          if (isOpen) picker.expandedFolders.delete(child.path);
          else picker.expandedFolders.add(child.path);
        }
        if (r.clicked) picker.folder = child.path;
        if (hasKids && isOpen) walk(child, depth + 1);
      }
    };
    walk(root, 0);
  });
  ImGui.PopStyleColor(1);
};

// ── Grid (breadcrumb + tiles) ─────────────────────────────────────────────────

const breadcrumbText = (folder: string): string => {
  if (folder === 'all') return 'All Assets';
  if (folder === 'fav') return 'All Assets / Favorites';
  if (folder === 'recent') return 'All Assets / Recent';
  return `All Assets / ${folder.split('/').map(cap).join(' / ')}`;
};

const renderGrid = (
  ctx: EditorContext,
  picker: AssetPickerState,
  browser: ProjectBrowser | null,
  shown: readonly BrowserAsset[],
  size: [number, number],
): void => {
  const { ui, widgets } = ctx;
  const p = getActivePalette();
  ui.child('ap-grid', { size, border: false, padding: [0, 0] }, () => {
    const top = ui.cursorScreenPos();
    const dl = Draw.window();
    // Breadcrumb strip on the darker surface (matches the preview pane), bordered.
    dl.rectFilled([top[0], top[1]], [top[0] + size[0], top[1] + 30], srgbU32(p.gray0));
    drawIcon('folder', [top[0] + 12, top[1] + 9], 13, srgbU32(p.textFaint));
    dl.text([top[0] + 30, top[1] + 8], srgbU32(p.text), breadcrumbText(picker.folder));
    const count = `${shown.length} item${shown.length === 1 ? '' : 's'}`;
    dl.text([top[0] + size[0] - ui.calcTextSize(count)[0] - 12, top[1] + 8], srgbU32(p.textFaint), count);
    dl.line([top[0], top[1] + 30], [top[0] + size[0], top[1] + 30], srgbU32(p.gray6));
    ui.dummy([size[0], 30]);

    ui.child('ap-grid-scroll', { size: [0, 0], border: false, padding: [10, 10] }, () => {
      if (browser === null) {
        ui.textDisabled('No project open.');
        return;
      }
      if (shown.length === 0) {
        ui.textDisabled('No assets match — try a different search, type, or folder.');
        return;
      }
      const list = picker.zoom === 'list';
      const tile = list ? 28 : tileFor(picker.zoom);
      const gap = 14;
      const cols = list ? 1 : Math.max(1, Math.floor((ui.contentAvail()[0] + gap) / (tile + gap)));
      let col = 0;
      for (const asset of shown) {
        if (col > 0) ui.sameLine();
        const thumbnail = asset.thumbnailable ? browser.thumbnails.get(asset.guid, asset.location) : undefined;
        const r = widgets.assetCard({
          id: asset.guid,
          name: asset.name,
          type: asset.type,
          meta: asset.meta,
          tile,
          selected: picker.selectedGuid === asset.guid,
          thumbnail,
        });
        if (r.clicked) {
          picker.selectedGuid = asset.guid;
          picker.focusedGuid = asset.guid;
        }
        col = (col + 1) % cols;
      }
    });
  });
};

// ── Preview / metadata pane ───────────────────────────────────────────────────

const renderPreview = (
  ctx: EditorContext,
  picker: AssetPickerState,
  browser: ProjectBrowser | null,
  spec: AssetTypeSpec,
  size: [number, number],
): void => {
  const { ui } = ctx;
  const p = getActivePalette();
  // Darker surface than the grid; the PREVIEW header is pinned (drawn before the
  // scroll child) so it stays put while the metadata scrolls under it.
  ImGui.PushStyleColor(ImGuiCol.ChildBg, srgbU32(p.gray0));
  ui.child('ap-preview', { size, border: true, padding: [0, 0], noScrollbar: true }, () => {
    const hdl = Draw.window();
    const w = ui.contentAvail()[0];
    const htop = ui.cursorScreenPos();
    hdl.text([htop[0] + 12, htop[1] + 8], srgbU32(p.text), 'PREVIEW');
    hdl.line([htop[0], htop[1] + PREVIEW_HEAD_H], [htop[0] + w, htop[1] + PREVIEW_HEAD_H], srgbU32(p.gray6));
    ui.dummy([w, PREVIEW_HEAD_H]);

    ui.child('ap-preview-scroll', { size: [0, 0], border: false, padding: [12, 10] }, () => {
      const dl = Draw.window();
      const asset = compatAsset(browser, picker.focusedGuid ?? picker.selectedGuid, spec);
      if (asset === undefined) {
        ui.textDisabled('Hover or click an asset');
        ui.textDisabled('to preview it here.');
        return;
      }

      const lineH = ui.textLineHeight();
      const center = (text: string, col: number): void => {
        const cw = ui.contentAvail()[0];
        const tw = ui.calcTextSize(text)[0];
        const cur = ui.cursorScreenPos();
        dl.text([cur[0] + Math.max(0, (cw - tw) / 2), cur[1]], col, text);
        ui.dummy([cw, lineH]);
      };

      // Centered preview tile: checkerboard + thumbnail, or the type's placeholder.
      const aw = ui.contentAvail()[0];
      const tile = Math.min(168, aw);
      const thumbnail = asset.thumbnailable ? browser?.thumbnails.get(asset.guid, asset.location) : undefined;
      const info = ASSET_TYPES[asset.type];
      const cur = ui.cursorScreenPos();
      const tmin: [number, number] = [cur[0] + (aw - tile) / 2, cur[1]];
      const tmax: [number, number] = [tmin[0] + tile, tmin[1] + tile];
      const transparent = asset.type === 'image' || asset.type === 'texture' || asset.type === 'sprite';
      dl.rectFilled(tmin, tmax, srgbU32(p.gray2), 6);
      if (thumbnail !== undefined) {
        if (transparent) dl.checkerboard(tmin, tmax, 10, srgbU32(p.gray5), srgbU32(p.gray3));
        dl.image(thumbnail, tmin, tmax);
      } else {
        if (transparent) dl.checkerboard(tmin, tmax, 10, srgbU32(p.gray5), srgbU32(p.gray3));
        const c = (tmin[0] + tmax[0]) / 2;
        const m = (tmin[1] + tmax[1]) / 2;
        drawIcon(info.icon, [c - 16, m - 16], 32, toneColors(info.tone).fg);
      }
      dl.rect(tmin, tmax, srgbU32(p.gray6), 6);
      if (info.tag !== '') {
        const ts = ui.calcTextSize(info.tag);
        dl.rectFilled([tmin[0] + 8, tmax[1] - ts[1] - 14], [tmin[0] + ts[0] + 20, tmax[1] - 8], srgbU32(p.gray0, 0.82), 2);
        dl.text([tmin[0] + 14, tmax[1] - ts[1] - 12], toneColors(info.tone).fg, info.tag);
      }
      ui.dummy([aw, tile + 10]);

      // Name + dimensions (centered), then the assignable line with a check icon.
      const dims = browser?.thumbnails.dimensionsOf(asset.guid);
      center(asset.name, srgbU32(p.white));
      const sub = dims !== undefined ? `${dims.w}×${dims.h}` : (asset.meta ?? '');
      if (sub !== '') center(sub, srgbU32(p.textFaint));
      ui.dummy([0, 4]);
      const assignable = `Assignable to ${picker.componentLabel}.${picker.propertyLabel}`;
      const atw = ui.calcTextSize(assignable)[0];
      const acur = ui.cursorScreenPos();
      const asx = acur[0] + Math.max(0, (aw - (atw + 19)) / 2);
      drawIcon('circle-check', [asx, acur[1] + (lineH - 13) / 2], 13, srgbU32(p.green400));
      dl.text([asx + 19, acur[1]], srgbU32(p.green400), assignable);
      ui.dummy([aw, lineH + 6]);
      ui.separator();
      ui.dummy([0, 4]);

      // Metadata table: faint labels, bright values, value column aligned. Long
      // values (Path, GUID) wrap under the value column via an indent.
      const labelW = labelColumnWidth(ui, ['Type', 'Folder', 'Info', 'Path', 'GUID']);
      const row = (label: string, value: string, valueColor = p.text): void => {
        ui.alignTextToFramePadding();
        ui.textDisabled(label);
        ui.sameLine(labelW);
        ui.textColored([valueColor[0] / 255, valueColor[1] / 255, valueColor[2] / 255, 1], value);
      };
      const wrapRow = (label: string, value: string): void => {
        const rc = ui.cursorScreenPos();
        dl.text([rc[0], rc[1]], srgbU32(p.textFaint), label);
        ui.indent(labelW);
        ui.textWrapped(value);
        ui.unindent(labelW);
      };
      row('Type', asset.type, p.white);
      row('Folder', `${folderOf(asset.location) || '/'}`);
      if (dims !== undefined) row('Info', `${dims.w}×${dims.h}`);
      else if (asset.meta !== undefined) row('Info', asset.meta);
      wrapRow('Path', asset.location);
      wrapRow('GUID', asset.guid);
      ui.dummy([0, 6]);

      renderPreviewActions(ctx, picker, asset);
    });
  });
  ImGui.PopStyleColor(1);
};

/** The preview pane's action row: a Select / Selected toggle plus a favorite star. */
const renderPreviewActions = (ctx: EditorContext, picker: AssetPickerState, asset: BrowserAsset): void => {
  const { ui } = ctx;
  const p = getActivePalette();
  const dl = Draw.window();
  const aw = ui.contentAvail()[0];
  const starW = 40;
  const gap = 6;
  const selW = Math.max(80, aw - starW - gap);
  const h = 32;
  const isSel = picker.selectedGuid === asset.guid;
  const fav = picker.favorites.has(asset.guid);
  const cur = ui.cursorScreenPos();

  // Select / Selected.
  const selClicked = ui.invisibleButton('ap-prev-select', [selW, h]);
  const selHov = ui.isItemHovered();
  const smin: [number, number] = [cur[0], cur[1]];
  const smax: [number, number] = [cur[0] + selW, cur[1] + h];
  dl.rectFilled(smin, smax, srgbU32(isSel ? p.green400 : selHov ? p.gray4 : p.gray3, isSel ? 0.16 : 1), 3);
  dl.rect(smin, smax, srgbU32(isSel ? p.green400 : p.gray6), 3);
  const label = isSel ? 'Selected' : 'Select';
  const icon: IconName = isSel ? 'check' : 'mouse-pointer-click';
  const lw = ui.calcTextSize(label)[0];
  const lx = cur[0] + Math.max(8, (selW - (lw + 22)) / 2);
  const col = srgbU32(isSel ? p.green300 : p.text);
  drawIcon(icon, [lx, cur[1] + (h - 15) / 2], 15, col);
  dl.text([lx + 22, cur[1] + (h - ui.textLineHeight()) / 2], col, label);

  // Favorite star.
  ui.setCursorScreenPos([cur[0] + selW + gap, cur[1]]);
  const favClicked = ui.invisibleButton('ap-prev-fav', [starW, h]);
  const favHov = ui.isItemHovered();
  const fmin: [number, number] = [cur[0] + selW + gap, cur[1]];
  const fmax: [number, number] = [fmin[0] + starW, cur[1] + h];
  dl.rectFilled(fmin, fmax, srgbU32(fav ? p.amber400 : p.gray3, fav ? 0.16 : 1), 3);
  dl.rect(fmin, fmax, srgbU32(fav ? p.amber400 : p.gray6), 3);
  drawIcon('star', [fmin[0] + (starW - 15) / 2, cur[1] + (h - 15) / 2], 15, srgbU32(fav ? p.amber400 : favHov ? p.text : p.textMuted));
  ui.setItemTooltip(fav ? 'Remove from favorites' : 'Add to favorites');

  ui.setCursorScreenPos([cur[0], cur[1] + h]);
  ui.dummy([aw, h]);

  if (selClicked && !isSel) {
    picker.selectedGuid = asset.guid;
    picker.focusedGuid = asset.guid;
  }
  if (favClicked) {
    if (fav) picker.favorites.delete(asset.guid);
    else picker.favorites.add(asset.guid);
  }
};

// ── Footer (hint · None · Cancel · Assign) ────────────────────────────────────

const renderFooter = (
  ctx: EditorContext,
  state: StudioState,
  app: App,
  browser: ProjectBrowser | null,
  spec: AssetTypeSpec,
  count: number,
): void => {
  const { ui, widgets } = ctx;
  const p = getActivePalette();
  const dl = Draw.window();
  const picker = state.assetPicker;
  const top = ui.cursorScreenPos();
  const w = ui.contentAvail()[0];
  dl.rectFilled([top[0], top[1]], [top[0] + w, top[1] + FOOTER_H], srgbU32(p.gray3));
  dl.line([top[0], top[1]], [top[0] + w, top[1]], srgbU32(p.gray6));
  ui.child('ap-footer', { size: [w, FOOTER_H], border: false, padding: [12, 9], noScrollbar: true }, () => {
    const selected = compatAsset(browser, picker.selectedGuid, spec);
    const hint =
      selected !== undefined
        ? `Selected ${selected.name}`
        : `${count} ${spec.noun.toLowerCase()}${count === 1 ? '' : 's'} · pick one to assign`;
    ui.alignTextToFramePadding();
    ui.textDisabled(hint);

    // Right-aligned action group (estimated widths, like the composer footer).
    const assignVisible = selected !== undefined;
    const assignW = ui.calcTextSize('Assign')[0] + 52;
    const cancelW = ui.calcTextSize('Cancel')[0] + 24;
    const noneW = picker.canClear ? ui.calcTextSize('None')[0] + 44 : 0;
    const gap = 8;
    let groupW = cancelW;
    if (picker.canClear) groupW += noneW + gap;
    if (assignVisible) groupW += assignW + gap;
    ui.sameLine(0, 0);
    ui.setCursorScreenPos([top[0] + w - 12 - groupW, top[1] + 8]);

    if (picker.canClear) {
      if (widgets.button('None', { variant: 'secondary', icon: 'eraser' })) {
        picker.commit?.(undefined);
        closeAssetPicker(picker);
        return;
      }
      ui.sameLine(0, gap);
    }
    if (widgets.button('Cancel', { variant: 'secondary' })) {
      closeAssetPicker(picker);
      return;
    }
    if (assignVisible) {
      ui.sameLine(0, gap);
      if (widgets.button('Assign', { variant: 'primary', icon: 'check' })) assign(app, picker);
    }
  });
};

/**
 * Resolve the selected GUID to a live handle and commit it through the slot's
 * boundary. The footer only enables Assign for a slot-compatible selection, so a
 * stale or incompatible pick never reaches here.
 */
const assign = (app: App, picker: AssetPickerState): void => {
  const guid = picker.selectedGuid;
  if (guid === null || picker.commit === null) return;
  const server = app.getResource(AssetServer);
  if (server === undefined) {
    console.warn('[studio] asset picker: no AssetServer to resolve the handle');
    return;
  }
  try {
    picker.commit(server.loadByGuid(guid as AssetGuid));
    pushRecent(picker, guid);
    closeAssetPicker(picker);
  } catch (err) {
    // Leave the picker open so a failed assignment is visible rather than
    // looking like a silent no-op that closed the modal.
    console.warn(`[studio] asset picker: could not resolve asset ${guid}`, err);
  }
};
