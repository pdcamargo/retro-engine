import { ImDrawFlags, ImGui, ImGuiCol, ImGuiCond, ImGuiStyleVar, ImGuiWindowFlags, ImVec2 } from '@mori2003/jsimgui';
import {
  createInstanceEmitter,
  Draw,
  drawIcon,
  type EditorContext,
  getActivePalette,
  type History,
  type IconName,
  type InspectorRegistry,
  renderComponentBody,
  srgbU32,
} from '@retro-engine/editor-sdk';
import { type App, AppTypeRegistry, type BundleDefinition } from '@retro-engine/engine';
import type { Entity } from '@retro-engine/ecs';
import type { TypeRegistry } from '@retro-engine/reflect';

import {
  buildComposerCatalog,
  type CatalogComponent,
  CATEGORY_ORDER,
  type ComposerCatalog,
} from './composer-catalog';
import { composerCommit } from './composer-commit';
import { buildEcho } from './composer-echo';
import {
  bundleKey,
  componentKey,
  type ComposerState,
  type CompositionEntry,
  deriveComposition,
  ensureDrafts,
  isComponentOverridden,
  pushRecent,
} from './composer-state';

/** Host callbacks the composer needs that live outside its own state. */
export interface ComposerHooks {
  /** Select the spawned entity (create mode). */
  readonly select: (entity: Entity) => void;
  /** Persist a bundle to a `.rebundle` asset (bundle mode). */
  readonly saveBundle: (def: BundleDefinition, guid: string | null, location: string | null) => Promise<void>;
  /** Persist favorites/recents (per-project); called after a star toggle or an add. */
  readonly persistPrefs?: () => void;
}

const POPUP = 'entity-composer';
const W = 920;
const H = 620;
const RAIL_W = 152;
const COMP_W = 340;
const FOOTER_H = 48;
const ROW_H = 36; // spec: browser component row h36
const LINE = 14;

let opened = false;

const eyebrow = (mode: ComposerState['mode']): string => (mode === 'add' ? 'MODIFY' : mode === 'bundle' ? 'BUNDLE' : 'CREATE');
const titleText = (mode: ComposerState['mode']): string =>
  mode === 'add' ? 'Add Components' : mode === 'bundle' ? 'Edit Bundle' : 'Spawn Entity';
const titleIcon = (mode: ComposerState['mode']): IconName => (mode === 'add' ? 'plus' : mode === 'bundle' ? 'package' : 'box');
const rgba = (c: readonly [number, number, number]): [number, number, number, number] => [c[0] / 255, c[1] / 255, c[2] / 255, 1];

/** Component names already on the target entity (add mode); empty otherwise. */
const existingOnEntity = (composer: ComposerState, app: App): Set<string> => {
  const out = new Set<string>();
  if (composer.mode !== 'add' || composer.targetEntity === null) return out;
  if (!app.world.hasEntity(composer.targetEntity)) return out;
  const registry = app.getResource(AppTypeRegistry)!.registry;
  for (const ctor of app.world.componentTypesOf(composer.targetEntity)) {
    const reg = registry.getByCtor(ctor);
    if (reg !== undefined) out.add(reg.name);
  }
  return out;
};

const matches = (label: string, query: string): boolean =>
  query.trim().length === 0 || label.toLowerCase().includes(query.trim().toLowerCase());

/**
 * The Entity Composer modal — one UI for spawning a new entity (`create`),
 * adding to the selected one (`add`), or authoring a bundle asset (`bundle`).
 * Drawn every frame; renders nothing until `composer.open` flips true. The
 * Claude Design "Entity Composer" handoff is the visual spec.
 */
export const entityComposerModal = (
  ctx: EditorContext,
  composer: ComposerState,
  app: App,
  history: History,
  inspector: InspectorRegistry,
  hooks: ComposerHooks,
): void => {
  const { ui } = ctx;
  if (composer.open && !opened) {
    ImGui.OpenPopup(POPUP);
    opened = true;
  }
  if (!composer.open) opened = false;

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
    if (composer.open) {
      composer.open = false;
      opened = false;
    }
    return;
  }

  const registry = app.getResource(AppTypeRegistry)!.registry;
  const catalog = buildComposerCatalog(app);
  const existing = existingOnEntity(composer, app);
  const composition = deriveComposition(composer, catalog, existing);
  ensureDrafts(app, composer, catalog, composition);
  const echo = buildEcho(composer.mode, composition, catalog, composer.drafts, {
    entityName: composer.entityName,
    targetId: composer.targetEntity,
    bundleName: composer.bundleName,
  });

  const close = (): void => {
    ImGui.CloseCurrentPopup();
    composer.open = false;
    opened = false;
  };

  const toggleComponent = (name: string): void => {
    if (composer.selected.has(name)) composer.selected.delete(name);
    else {
      composer.selected.add(name);
      pushRecent(composer, componentKey(name));
      hooks.persistPrefs?.();
    }
  };
  const toggleBundle = (name: string): void => {
    if (composer.activeBundles.has(name)) composer.activeBundles.delete(name);
    else {
      composer.activeBundles.add(name);
      pushRecent(composer, bundleKey(name));
      hooks.persistPrefs?.();
    }
  };
  const toggleFavorite = (key: string): void => {
    if (composer.favorites.has(key)) composer.favorites.delete(key);
    else composer.favorites.add(key);
    hooks.persistPrefs?.();
  };

  ImGui.PushStyleVarImVec2(ImGuiStyleVar.ItemSpacing, new ImVec2(0, 0));
  renderTitleBar(ctx, composer, close);
  renderContextRow(ctx, composer, existing);
  renderTabs(ctx, composer);

  const avail = ui.contentAvail();
  const bodyH = avail[1] - FOOTER_H;
  const browserW = Math.max(220, avail[0] - RAIL_W - COMP_W);

  // Components pulled in indirectly (by a bundle or a `requires`) — tagged "auto"
  // in the browser, like the design.
  const autoSet = new Set(composition.newNames.filter((n) => !composer.selected.has(n)));

  renderRail(ctx, composer, catalog, [RAIL_W, bodyH], { toggleComponent, toggleBundle });
  ImGui.SameLine(0, 0);
  renderBrowser(ctx, composer, catalog, existing, autoSet, [browserW, bodyH], { toggleComponent, toggleBundle, toggleFavorite });
  ImGui.SameLine(0, 0);
  renderComposition(ctx, composer, inspector, registry, catalog, composition, echo, [COMP_W, bodyH]);

  renderFooter(ctx, composer, composition, () => {
    void Promise.resolve(
      composerCommit({
        app,
        history,
        state: composer,
        catalog,
        composition,
        select: hooks.select,
        saveBundle: hooks.saveBundle,
      }),
    );
    hooks.persistPrefs?.();
    close();
  }, close);
  ImGui.PopStyleVar(1);

  ImGui.EndPopup();
};

// ── Title bar ────────────────────────────────────────────────────────────────

const renderTitleBar = (ctx: EditorContext, composer: ComposerState, close: () => void): void => {
  const { ui } = ctx;
  const p = getActivePalette();
  const dl = Draw.window();
  const top = ui.cursorScreenPos();
  const w = ui.contentAvail()[0];
  dl.rectFilled([top[0], top[1]], [top[0] + w, top[1] + 42], srgbU32(p.gray3));
  dl.line([top[0], top[1] + 42], [top[0] + w, top[1] + 42], srgbU32(p.gray6));
  drawIcon(titleIcon(composer.mode), [top[0] + 14, top[1] + 13, ], 16, srgbU32(p.green400));
  dl.text([top[0] + 40, top[1] + 16], srgbU32(p.textMuted), eyebrow(composer.mode));
  const ebW = ui.calcTextSize(eyebrow(composer.mode))[0];
  dl.text([top[0] + 40 + ebW + 14, top[1] + 14], srgbU32(p.white), titleText(composer.mode));
  if (composer.mode === 'add' && composer.targetEntity !== null) {
    const tw = ui.calcTextSize(titleText(composer.mode))[0];
    dl.text([top[0] + 40 + ebW + 14 + tw + 10, top[1] + 14], srgbU32(p.textMuted), `#${String(composer.targetEntity)}`);
  }
  const cstart = top;
  ui.setCursorScreenPos([cstart[0] + w - 36, cstart[1] + 7]);
  const closed = ui.invisibleButton('ec-close', [28, 28]);
  drawIcon('x', [cstart[0] + w - 30, cstart[1] + 13], 16, srgbU32(ui.isItemHovered() ? p.white : p.textMuted));
  if (closed) close();
  ui.setCursorScreenPos(top);
  ui.dummy([w, 42]);
};

// ── Context row (name+parent / target / bundle name) ──────────────────────────

const renderContextRow = (ctx: EditorContext, composer: ComposerState, existing: ReadonlySet<string>): void => {
  const { ui } = ctx;
  const p = getActivePalette();
  const dl = Draw.window();
  const top = ui.cursorScreenPos();
  const w = ui.contentAvail()[0];
  dl.rectFilled([top[0], top[1]], [top[0] + w, top[1] + 44], srgbU32(p.gray2));
  dl.line([top[0], top[1] + 44], [top[0] + w, top[1] + 44], srgbU32(p.gray6));
  ui.child('ec-ctx', { size: [w, 44], border: false, padding: [14, 10], noScrollbar: true }, () => {
    if (composer.mode === 'add') {
      ui.textDisabled('TARGET');
      ui.sameLine(0, 8);
      ui.textColored(rgba(p.green400), `#${String(composer.targetEntity ?? 0)}`);
      ui.sameLine(0, 12);
      ui.textDisabled([...existing].join(' · ') || 'no components');
      return;
    }
    ui.textDisabled('NAME');
    ui.sameLine(0, 8);
    if (composer.mode === 'bundle') {
      composer.bundleName = ui.inputText('##ec-bundle-name', composer.bundleName, { width: w - 90 });
    } else {
      composer.entityName = ui.inputText('##ec-name', composer.entityName, { width: w - 90 });
    }
  });
};

// ── Tabs (with counts) ────────────────────────────────────────────────────────

const renderTabs = (ctx: EditorContext, composer: ComposerState): void => {
  const { ui } = ctx;
  const p = getActivePalette();
  const dl = Draw.window();
  const top = ui.cursorScreenPos();
  const w = ui.contentAvail()[0];
  dl.rectFilled([top[0], top[1]], [top[0] + w, top[1] + 36], srgbU32(p.gray2));
  dl.line([top[0], top[1] + 36], [top[0] + w, top[1] + 36], srgbU32(p.gray6));
  const tab = (id: string, label: string, count: number, key: 'components' | 'bundles', x: number): number => {
    const active = composer.tab === key;
    const text = count > 0 ? `${label}  ${count}` : label;
    const tw = ui.calcTextSize(text)[0] + 28;
    ui.setCursorScreenPos([top[0] + x, top[1]]);
    const clicked = ui.invisibleButton(id, [tw, 36]);
    const hovered = ui.isItemHovered();
    if (clicked) composer.tab = key;
    if (active) dl.rectFilled([top[0] + x, top[1]], [top[0] + x + tw, top[1] + 2], srgbU32(p.green400));
    const col = active ? p.white : hovered ? p.text : p.textMuted;
    dl.text([top[0] + x + 14, top[1] + 11], srgbU32(col), label);
    if (count > 0) {
      const lw = ui.calcTextSize(label)[0];
      dl.text([top[0] + x + 14 + lw + 8, top[1] + 11], srgbU32(active ? p.green400 : p.textFaint), String(count));
    }
    return tw;
  };
  let x = 14;
  x += tab('ec-tab-c', 'Components', composer.selected.size, 'components', x);
  tab('ec-tab-b', 'Bundles', composer.activeBundles.size, 'bundles', x);
  ui.setCursorScreenPos(top);
  ui.dummy([w, 36]);
};

// ── Favorites / Recent rail ─────────────────────────────────────────────────

const renderRail = (
  ctx: EditorContext,
  composer: ComposerState,
  catalog: ComposerCatalog,
  size: [number, number],
  hooks: { toggleComponent: (n: string) => void; toggleBundle: (n: string) => void },
): void => {
  const { ui } = ctx;
  const p = getActivePalette();
  ui.child('ec-rail', { size, border: true, padding: [0, 8] }, () => {
    const sectionHeader = (icon: IconName, label: string): void => {
      const start = ui.cursorScreenPos();
      const dl = Draw.window();
      drawIcon(icon, [start[0] + 8, start[1] + 1], 11, srgbU32(p.textFaint));
      dl.text([start[0] + 24, start[1]], srgbU32(p.textFaint), label);
      ui.dummy([size[0], 18]);
    };
    // `section` keeps the ImGui id unique — the same item can appear in both
    // FAVORITES and RECENT, and a duplicate id would collide.
    const entryRow = (key: string, section: string): void => {
      const isBundle = key.startsWith('b:');
      const name = key.slice(2);
      const present = isBundle ? composer.activeBundles.has(name) : composer.selected.has(name);
      const icon: IconName = isBundle ? 'package' : catalog.byName.get(name)?.icon ?? 'component';
      const start = ui.cursorScreenPos();
      const clicked = ui.invisibleButton(`ec-rail-${section}-${key}`, [size[0], 24]);
      const dl = Draw.window();
      const cy = start[1] + 12;
      if (present) {
        dl.rectFilled([start[0], start[1]], [start[0] + size[0], start[1] + 24], srgbU32(p.green400, 0.14));
        dl.rectFilled([start[0], start[1]], [start[0] + 2, start[1] + 24], srgbU32(p.green400));
      } else if (ui.isItemHovered()) {
        dl.rectFilled([start[0], start[1]], [start[0] + size[0], start[1] + 24], srgbU32(p.gray5, 0.5));
      }
      drawIcon(icon, [start[0] + 10, cy - 7], 13, srgbU32(present ? p.green400 : p.textMuted));
      dl.text([start[0] + 30, cy - LINE / 2], srgbU32(present ? p.green300 : p.text), name);
      if (clicked) {
        if (isBundle) hooks.toggleBundle(name);
        else hooks.toggleComponent(name);
      }
    };
    ui.dummy([size[0], 2]);
    sectionHeader('star', 'FAVORITES');
    const favs = [...composer.favorites].filter((k) => {
      const n = k.slice(2);
      return k.startsWith('b:') ? catalog.bundles.some((b) => b.name === n) : catalog.byName.has(n);
    });
    if (favs.length === 0) ui.textDisabled('  Star to pin.');
    else for (const k of favs) entryRow(k, 'fav');
    ui.dummy([size[0], 8]);
    sectionHeader('history', 'RECENT');
    if (composer.recent.length === 0) ui.textDisabled('  Nothing yet.');
    else for (const k of composer.recent) entryRow(k, 'rec');
  });
};

// ── Browser ──────────────────────────────────────────────────────────────────

const renderBrowser = (
  ctx: EditorContext,
  composer: ComposerState,
  catalog: ComposerCatalog,
  existing: ReadonlySet<string>,
  autoSet: ReadonlySet<string>,
  size: [number, number],
  hooks: {
    toggleComponent: (n: string) => void;
    toggleBundle: (n: string) => void;
    toggleFavorite: (k: string) => void;
  },
): void => {
  const { ui } = ctx;
  const p = getActivePalette();
  ui.child('ec-browser', { size, border: true, padding: [10, 10] }, () => {
    composer.search = ui.inputText('##ec-search', composer.search, {
      hint: composer.tab === 'components' ? 'Search components' : 'Search bundles',
      width: size[0] - 20,
    });
    ui.dummy([size[0], 4]);
    const rowW = size[0] - 20;
    if (composer.tab === 'components') {
      const byCat = new Map<string, CatalogComponent[]>();
      for (const c of catalog.components) {
        if (!matches(c.name, composer.search)) continue;
        const arr = byCat.get(c.category) ?? [];
        arr.push(c);
        byCat.set(c.category, arr);
      }
      const cats = [...byCat.keys()].sort(
        (a, b) => (CATEGORY_ORDER.indexOf(a) + 1 || 99) - (CATEGORY_ORDER.indexOf(b) + 1 || 99),
      );
      for (const cat of cats) {
        const hstart = ui.cursorScreenPos();
        Draw.window().text([hstart[0] + 2, hstart[1] + 4], srgbU32(p.textFaint), cat.toUpperCase());
        ui.dummy([rowW, 22]);
        for (const c of byCat.get(cat)!) renderComponentBrowserRow(ctx, composer, c, existing, autoSet, rowW, hooks);
      }
    } else {
      for (const b of catalog.bundles) {
        if (!matches(b.name, composer.search)) continue;
        renderBundleCard(ctx, composer, b, rowW, hooks.toggleBundle, hooks.toggleFavorite);
      }
      if (catalog.bundles.length === 0) {
        ui.dummy([rowW, 4]);
        ui.textDisabled('No bundles yet. Author one in Bundle mode.');
      }
    }
  });
};

const renderComponentBrowserRow = (
  ctx: EditorContext,
  composer: ComposerState,
  c: CatalogComponent,
  existing: ReadonlySet<string>,
  autoSet: ReadonlySet<string>,
  rowW: number,
  hooks: { toggleComponent: (n: string) => void; toggleFavorite: (k: string) => void },
): void => {
  const { ui } = ctx;
  const p = getActivePalette();
  const dl = Draw.window();
  const onEntity = existing.has(c.name);
  const checked = composer.selected.has(c.name) || onEntity;
  const auto = !checked && autoSet.has(c.name);
  const fav = composer.favorites.has(componentKey(c.name));
  const starW = 28;
  const start = ui.cursorScreenPos();
  const rowClicked = ui.invisibleButton(`ec-c-${c.name}`, [rowW - starW, ROW_H]);
  const rowHovered = ui.isItemHovered();
  ui.setCursorScreenPos([start[0] + rowW - starW, start[1]]);
  const starClicked = ui.invisibleButton(`ec-star-${c.name}`, [starW, ROW_H]);
  const starHovered = ui.isItemHovered();
  ui.setCursorScreenPos([start[0], start[1] + ROW_H]);

  const cy = start[1] + ROW_H / 2;
  if (checked) {
    dl.rectFilled([start[0], start[1]], [start[0] + rowW, start[1] + ROW_H], srgbU32(p.green400, 0.14), 2);
    dl.rectFilled([start[0], start[1]], [start[0] + 2, start[1] + ROW_H], srgbU32(p.green400));
  } else if (rowHovered) {
    dl.rectFilled([start[0], start[1]], [start[0] + rowW, start[1] + ROW_H], srgbU32(p.gray5, 0.5), 2);
  }
  // checkbox
  dl.rect([start[0] + 8, cy - 7], [start[0] + 22, cy + 7], srgbU32(checked ? p.green400 : p.gray6), 2);
  if (checked) drawIcon('check', [start[0] + 9, cy - 7], 12, srgbU32(p.green400));
  drawIcon(c.icon, [start[0] + 32, cy - 8], 15, srgbU32(onEntity ? p.textFaint : checked ? p.green400 : p.textMuted));
  dl.text([start[0] + 54, cy - LINE / 2], srgbU32(onEntity ? p.textFaint : checked ? p.green300 : p.text), c.name);
  if (onEntity) {
    const tag = 'on entity';
    dl.text([start[0] + rowW - starW - ui.calcTextSize(tag)[0] - 8, cy - LINE / 2], srgbU32(p.textFaint), tag);
  } else {
    if (auto) {
      const tag = 'auto';
      dl.text([start[0] + rowW - starW - ui.calcTextSize(tag)[0] - 8, cy - LINE / 2], srgbU32(p.green400), tag);
    }
    drawIcon('star', [start[0] + rowW - starW + 6, cy - 7], 14, srgbU32(fav ? p.amber400 : starHovered ? p.textMuted : p.gray6));
  }
  if (rowClicked && !onEntity) hooks.toggleComponent(c.name);
  if (starClicked && !onEntity) hooks.toggleFavorite(componentKey(c.name));
};

const renderBundleCard = (
  ctx: EditorContext,
  composer: ComposerState,
  b: ComposerCatalog['bundles'][number],
  rowW: number,
  toggleBundle: (n: string) => void,
  toggleFavorite: (k: string) => void,
): void => {
  const { ui } = ctx;
  const p = getActivePalette();
  const dl = Draw.window();
  const active = composer.activeBundles.has(b.name);
  const fav = composer.favorites.has(bundleKey(b.name));
  const pad = 12;
  const chipH = 22;
  const chipGap = 6;
  const chipPadX = 9;
  const innerW = rowW - pad * 2;

  // Wrap the component chips within the card width.
  const rows: { name: string; x: number; w: number }[][] = [];
  let cursor = 0;
  let row: { name: string; x: number; w: number }[] = [];
  for (const name of b.comps) {
    const w = ui.calcTextSize(name)[0] + chipPadX * 2;
    if (cursor + w > innerW && row.length > 0) {
      rows.push(row);
      row = [];
      cursor = 0;
    }
    row.push({ name, x: cursor, w });
    cursor += w + chipGap;
  }
  if (row.length > 0) rows.push(row);

  const headerH = 46; // badge + name + description
  const chipsH = rows.length > 0 ? rows.length * (chipH + chipGap) - chipGap : 0;
  const cardH = pad + headerH + chipsH + pad;

  const starSize = 26;
  const start = ui.cursorScreenPos();
  const clicked = ui.invisibleButton(`ec-b-${b.name}`, [rowW - starSize - 4, cardH]);
  const hovered = ui.isItemHovered();
  ui.setCursorScreenPos([start[0] + rowW - starSize, start[1] + 8]);
  const starClicked = ui.invisibleButton(`ec-bfav-${b.name}`, [starSize, starSize]);
  const starHovered = ui.isItemHovered();
  ui.setCursorScreenPos([start[0], start[1] + cardH]);
  ui.dummy([rowW, 8]);

  // Card surface + border.
  if (active) dl.rectFilled([start[0], start[1]], [start[0] + rowW, start[1] + cardH], srgbU32(p.green400, 0.1), 4);
  else if (hovered) dl.rectFilled([start[0], start[1]], [start[0] + rowW, start[1] + cardH], srgbU32(p.gray5, 0.3), 4);
  dl.rect([start[0], start[1]], [start[0] + rowW, start[1] + cardH], srgbU32(active ? p.green400 : p.gray6), 4, 1);

  // Icon badge (filled green when active), name, description.
  const bx = start[0] + pad;
  const by = start[1] + pad;
  dl.rectFilled([bx, by], [bx + 30, by + 30], srgbU32(active ? p.green400 : p.gray4), 6);
  drawIcon('package', [bx + 7, by + 7], 16, srgbU32(active ? p.gray0 : p.textMuted));
  dl.text([bx + 40, by + 2], srgbU32(p.white), b.name);
  if (b.desc !== undefined) dl.text([bx + 40, by + 20], srgbU32(p.textMuted), b.desc);

  // Favorite star (top-right).
  drawIcon('star', [start[0] + rowW - starSize + 4, start[1] + 11], 14, srgbU32(fav ? p.amber400 : starHovered ? p.textMuted : p.gray6));

  // Component chips.
  const chipTop = start[1] + pad + headerH;
  for (const [ri, r] of rows.entries()) {
    const chy = chipTop + ri * (chipH + chipGap);
    for (const chip of r) {
      const chx = start[0] + pad + chip.x;
      dl.rect([chx, chy], [chx + chip.w, chy + chipH], srgbU32(active ? p.green400 : p.gray6), 3, 1);
      dl.text([chx + chipPadX, chy + (chipH - LINE) / 2], srgbU32(active ? p.green300 : p.textMuted), chip.name);
    }
  }

  if (clicked) toggleBundle(b.name);
  if (starClicked) toggleFavorite(bundleKey(b.name));
};

// ── Composition pane ──────────────────────────────────────────────────────────

const renderComposition = (
  ctx: EditorContext,
  composer: ComposerState,
  inspector: InspectorRegistry,
  registry: TypeRegistry,
  catalog: ComposerCatalog,
  composition: ReturnType<typeof deriveComposition>,
  echo: string,
  size: [number, number],
): void => {
  const { ui, widgets } = ctx;
  const p = getActivePalette();
  ui.child('ec-comp', { size, border: true, padding: [0, 0], noScrollbar: true }, () => {
    const dl = Draw.window();
    // Dark pane (matches the code-preview surface), under the header strip + body.
    const paneTop = ui.cursorScreenPos();
    dl.rectFilled([paneTop[0], paneTop[1]], [paneTop[0] + ui.contentAvail()[0], paneTop[1] + size[1]], srgbU32(p.gray0));
    // COMPOSITION header strip.
    const htop = ui.cursorScreenPos();
    const innerW = ui.contentAvail()[0];
    dl.rectFilled([htop[0], htop[1]], [htop[0] + innerW, htop[1] + 32], srgbU32(p.gray3));
    dl.line([htop[0], htop[1] + 32], [htop[0] + innerW, htop[1] + 32], srgbU32(p.gray6));
    dl.text([htop[0] + 12, htop[1] + 10], srgbU32(p.textFaint), 'COMPOSITION');
    const bundleCount = composition.bundleGroups.length;
    const countStr =
      bundleCount > 0
        ? `${composition.newNames.length} new · ${bundleCount} bundle${bundleCount === 1 ? '' : 's'}`
        : `${composition.newNames.length} new`;
    dl.text([htop[0] + innerW - ui.calcTextSize(countStr)[0] - 12, htop[1] + 10], srgbU32(p.green400), countStr);
    ui.dummy([innerW, 32]);

    const echoH = 128;
    ImGui.PushStyleColor(ImGuiCol.ChildBg, srgbU32(p.gray0));
    ui.child('ec-comp-scroll', { size: [0, size[1] - echoH - 32], border: false, padding: [10, 8] }, () => {
      // `indent` shifts a row right (members nested inside a bundle card); the
      // remove `×` and override form follow it.
      // A composition row. `indent` shifts the content (chevron/icon/name) right;
      // the hover highlight always spans the full line (per spec). `rowH` is 30 for
      // top-level rows, tighter inside a bundle card.
      const overrideRow = (entry: CompositionEntry, note?: string, indent = 0, rowH = 30): void => {
        if (entry.onEntity) {
          drawSimpleRow(ctx, entry.reg.name, true, 'on entity', indent);
          return;
        }
        const item = catalog.byName.get(entry.name);
        const instance = composer.drafts.get(entry.name);
        const editable =
          item !== undefined &&
          instance !== undefined &&
          item.reg.fields.some(([, ft]) => !(ft as { isSkipped?: boolean }).isSkipped);
        const overridden = editable && item !== undefined && instance !== undefined && isComponentOverridden(item, instance);
        const open = editable && composer.expanded.has(entry.name);
        const headerW = ui.contentAvail()[0];
        // Only individually-added components are removable here: a bundle member is
        // removed by removing its bundle (header ×); an auto-required one by its requirer.
        const rmW = entry.origin === 'selected' ? 24 : 0;
        const ix = (x: number): number => x + indent;
        // Context-unique id (origin + owning bundle + name) so a component that
        // appears in more than one place never collides on the ImGui id.
        const rid = `${entry.origin}-${entry.bundleName ?? ''}-${entry.name}`;
        const start = ui.cursorScreenPos();
        let rowClicked = false;
        if (editable) rowClicked = ui.invisibleButton(`ec-orow-${rid}`, [headerW - rmW, rowH]);
        else ui.dummy([headerW - rmW, rowH]);
        const rowHovered = editable && ui.isItemHovered();
        let rmClicked = false;
        if (rmW > 0) {
          ui.setCursorScreenPos([start[0] + headerW - rmW, start[1]]);
          rmClicked = ui.invisibleButton(`ec-rm-${rid}`, [rmW, rowH]);
        }
        ui.setCursorScreenPos([start[0], start[1] + rowH]);

        const cy = start[1] + rowH / 2;
        // Full-line hover, gray-3 (spec: composition row hover --gray-3).
        if (rowHovered) dl.rectFilled([start[0], start[1]], [start[0] + headerW, start[1] + rowH], srgbU32(p.gray3), 2);
        if (editable) drawIcon(open ? 'chevron-down' : 'chevron-right', [ix(start[0]) + 2, cy - 6], 12, srgbU32(p.textMuted));
        drawIcon(item?.icon ?? 'component', [ix(start[0]) + 18, cy - 8], 14, srgbU32(p.green400));
        dl.text([ix(start[0]) + 38, cy - LINE / 2], srgbU32(p.text), entry.name);
        const nameEnd = ix(start[0]) + 42 + ui.calcTextSize(entry.name)[0];
        if (overridden) dl.circleFilled([nameEnd, cy], 3, srgbU32(p.green400));
        if (note !== undefined) {
          const noteX = start[0] + headerW - rmW - ui.calcTextSize(note)[0] - 6;
          // Skip the note when a long component name would collide with it.
          if (noteX > nameEnd + 12) dl.text([noteX, cy - LINE / 2], srgbU32(p.textFaint), note);
        }
        if (rmW > 0) drawIcon('x', [start[0] + headerW - rmW + 4, cy - 7], 13, srgbU32(p.textFaint));

        if (rowClicked) {
          if (open) composer.expanded.delete(entry.name);
          else composer.expanded.add(entry.name);
        }
        if (rmClicked) {
          if (entry.origin === 'bundle' && entry.bundleName !== undefined) composer.activeBundles.delete(entry.bundleName);
          else composer.selected.delete(entry.name);
        }
        if (open && item !== undefined && instance !== undefined) {
          ui.dummy([headerW, 2]);
          // Nest the fields under the member; restore a 2px row gap (the modal
          // pushes ItemSpacing 0 for the flush pane layout).
          ImGui.PushStyleVarImVec2(ImGuiStyleVar.ItemSpacing, new ImVec2(8, 2));
          ui.indent(indent + 14);
          renderComponentBody({
            ui,
            widgets,
            reflect: registry,
            inspector,
            instance,
            registered: item.reg,
            readonly: false,
            edit: createInstanceEmitter(instance),
          });
          ui.unindent(indent + 14);
          ImGui.PopStyleVar(1);
          ui.dummy([headerW, 4]);
        }
      };

      const sectionLabel = (label: string): void => {
        const s = ui.cursorScreenPos();
        Draw.window().text([s[0], s[1] + 4], srgbU32(p.textFaint), label);
        ui.dummy([10, 22]);
      };

      if (composition.onEntity.length > 0) {
        sectionLabel('ON ENTITY');
        for (const name of composition.onEntity) drawSimpleRow(ctx, name, true, 'on entity');
        ui.dummy([10, 6]);
      }
      // A bundle is a bordered card: header row (package + name + count + remove)
      // with its members nested inside. The border is drawn after the content so
      // it wraps whatever height the (possibly expanded) members take.
      for (const group of composition.bundleGroups) {
        const collapsed = composer.bundleCollapsed.has(group.bundleName);
        const hw = ui.contentAvail()[0];
        const HEAD = 28; // spec: bundle group header h28
        const cardStart = ui.cursorScreenPos();
        const gClicked = ui.invisibleButton(`ec-bg-${group.bundleName}`, [hw - 28, HEAD]);
        ui.setCursorScreenPos([cardStart[0] + hw - 28, cardStart[1]]);
        const gxClicked = ui.invisibleButton(`ec-bg-x-${group.bundleName}`, [28, HEAD]);
        ui.setCursorScreenPos([cardStart[0], cardStart[1] + HEAD]);
        // Header strip — gray-3, rounded top to sit flush in the card border.
        dl.rectFilled([cardStart[0], cardStart[1]], [cardStart[0] + hw, cardStart[1] + HEAD], srgbU32(p.gray3), 4, ImDrawFlags.RoundCornersTop);
        const hy = cardStart[1] + HEAD / 2;
        drawIcon(collapsed ? 'chevron-right' : 'chevron-down', [cardStart[0] + 8, hy - 6], 12, srgbU32(p.textMuted));
        drawIcon('package', [cardStart[0] + 24, hy - 8], 15, srgbU32(p.green400));
        dl.text([cardStart[0] + 46, hy - LINE / 2], srgbU32(p.white), group.bundleName);
        const countLabel = `${group.members.length} comps`;
        dl.text([cardStart[0] + hw - 30 - ui.calcTextSize(countLabel)[0] - 6, hy - LINE / 2], srgbU32(p.textFaint), countLabel);
        drawIcon('x', [cardStart[0] + hw - 24, hy - 7], 13, srgbU32(p.textFaint));
        if (gClicked) {
          if (collapsed) composer.bundleCollapsed.delete(group.bundleName);
          else composer.bundleCollapsed.add(group.bundleName);
        }
        if (gxClicked) composer.activeBundles.delete(group.bundleName);
        if (!collapsed) {
          // Members: indented under the header chevron, tighter rows (less padding).
          for (const m of group.members) overrideRow(m, undefined, 22, 26);
          ui.dummy([hw, 4]);
        }
        const cardEnd = ui.cursorScreenPos();
        dl.rect([cardStart[0], cardStart[1]], [cardStart[0] + hw, cardEnd[1]], srgbU32(p.gray6), 4, 1);
        ui.dummy([hw, 8]);
      }
      if (composition.loose.length > 0) {
        sectionLabel('COMPONENTS');
        for (const e of composition.loose) overrideRow(e);
      }
      if (composition.auto.length > 0) {
        ui.dummy([10, 4]);
        sectionLabel('AUTO-REQUIRED');
        for (const e of composition.auto) overrideRow(e, e.requiredBy !== undefined ? `needs ${e.requiredBy}` : undefined);
      }
      for (const msg of composition.conflicts) {
        ui.dummy([10, 6]);
        const cstart = ui.cursorScreenPos();
        const bw = ui.contentAvail()[0];
        dl.rectFilled([cstart[0], cstart[1]], [cstart[0] + bw, cstart[1] + 40], srgbU32(p.amber400, 0.14), 4);
        dl.rect([cstart[0], cstart[1]], [cstart[0] + bw, cstart[1] + 40], srgbU32(p.amber400), 4);
        drawIcon('triangle-alert', [cstart[0] + 8, cstart[1] + 13], 14, srgbU32(p.amber400));
        wrapText(ctx, msg, [cstart[0] + 30, cstart[1] + 6], bw - 40, srgbU32(p.amber500));
        ui.dummy([bw, 40]);
      }
      if (composition.newNames.length === 0 && composition.onEntity.length === 0) {
        ui.dummy([10, 4]);
        ui.textDisabled('Pick components or drop in a bundle.');
      }
    });
    ImGui.PopStyleColor(1);

    // Code echo.
    const echoTop = ui.cursorScreenPos();
    const ew = ui.contentAvail()[0];
    dl.rectFilled([echoTop[0], echoTop[1]], [echoTop[0] + ew, echoTop[1] + echoH], srgbU32(p.gray0));
    dl.line([echoTop[0], echoTop[1]], [echoTop[0] + ew, echoTop[1]], srgbU32(p.gray6));
    drawIcon('chevron-right', [echoTop[0] + 8, echoTop[1] + 7], 11, srgbU32(p.green400));
    dl.text([echoTop[0] + 22, echoTop[1] + 6], srgbU32(p.textMuted), composer.mode === 'bundle' ? 'bundle' : 'world');
    const lines = echo.split('\n').slice(0, 7);
    for (const [i, line] of lines.entries()) {
      dl.text([echoTop[0] + 10, echoTop[1] + 26 + i * LINE], srgbU32(p.textMuted), line);
    }
    ui.dummy([ew, echoH]);
  });
};

const drawSimpleRow = (ctx: EditorContext, label: string, dim: boolean, note?: string, indent = 0): void => {
  const { ui } = ctx;
  const p = getActivePalette();
  const w = ui.contentAvail()[0];
  const start = ui.cursorScreenPos();
  ui.dummy([w, 26]);
  const dl = Draw.window();
  const cy = start[1] + 13;
  dl.text([start[0] + 18 + indent, cy - LINE / 2], srgbU32(dim ? p.textFaint : p.text), label);
  if (note !== undefined) dl.text([start[0] + w - ui.calcTextSize(note)[0] - 6, cy - LINE / 2], srgbU32(p.textFaint), note);
};

const wrapText = (ctx: EditorContext, text: string, pos: [number, number], maxW: number, col: number): void => {
  const { ui } = ctx;
  const dl = Draw.window();
  const words = text.split(' ');
  let line = '';
  let y = pos[1];
  for (const word of words) {
    const next = line.length === 0 ? word : `${line} ${word}`;
    if (ui.calcTextSize(next)[0] > maxW && line.length > 0) {
      dl.text([pos[0], y], col, line);
      y += LINE;
      line = word;
    } else line = next;
  }
  if (line.length > 0) dl.text([pos[0], y], col, line);
};

// ── Footer ─────────────────────────────────────────────────────────────────

const renderFooter = (
  ctx: EditorContext,
  composer: ComposerState,
  composition: ReturnType<typeof deriveComposition>,
  commit: () => void,
  close: () => void,
): void => {
  const { ui, widgets } = ctx;
  const p = getActivePalette();
  const dl = Draw.window();
  const top = ui.cursorScreenPos();
  const w = ui.contentAvail()[0];
  dl.rectFilled([top[0], top[1]], [top[0] + w, top[1] + FOOTER_H], srgbU32(p.gray3));
  dl.line([top[0], top[1]], [top[0] + w, top[1]], srgbU32(p.gray6));
  ui.child('ec-footer', { size: [w, FOOTER_H], border: false, padding: [14, 10], noScrollbar: true }, () => {
    const n = composition.newNames.length;
    const bundleCount = composer.activeBundles.size;
    const summary =
      n === 0
        ? 'nothing selected'
        : `${n} component${n === 1 ? '' : 's'}${bundleCount > 0 ? ` · ${bundleCount} bundle${bundleCount === 1 ? '' : 's'}` : ''}`;
    ui.textDisabled(summary);
    const label =
      composer.mode === 'add'
        ? `Add ${n} Component${n === 1 ? '' : 's'}`
        : composer.mode === 'bundle'
          ? 'Save Bundle'
          : 'Spawn Entity';
    const canCommit = composer.mode === 'bundle' ? n > 0 && composer.bundleName.trim().length > 0 : n > 0;
    const btnW = ui.calcTextSize(label)[0] + 52;
    ui.sameLine(0, 0);
    ui.setCursorScreenPos([top[0] + w - btnW - 92, top[1] + 9]);
    if (widgets.button('Cancel', { variant: 'secondary' })) close();
    ui.sameLine(0, 8);
    if (canCommit) {
      const opts = composer.mode === 'create' ? { variant: 'primary' as const, icon: 'zap' as const } : { variant: 'primary' as const };
      if (widgets.button(label, opts)) commit();
    }
  });
};
