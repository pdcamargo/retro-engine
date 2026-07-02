import {
  type AssetEditorRegistry,
  type AssetSelection,
  ASSET_TYPES,
  createAssetHistoryEmitter,
  createHistoryEmitter,
  Draw,
  drawIcon,
  type EditorContext,
  getActivePalette,
  type History,
  type InspectorRegistry,
  listComponents,
  type PanelDef,
  renderComponentBody,
  srgbU32,
  type Tone,
  toneColors,
} from '@retro-engine/editor-sdk';
import type { AssetGuid } from '@retro-engine/assets';
import { type App, AppTypeRegistry, AssetServer, Name } from '@retro-engine/engine';
import { gltfAnchorForEntity } from '@retro-engine/gltf';

import type { AcAssetDeps } from './animator/ac-asset';
import { renderAnimatorInspectorBody } from './animator/ac-inspector';
import type { AnimatorSession } from './animator/animator-session';
import { openComposer } from './composer/composer-state';
import { type StudioState } from './state';

/**
 * The INSPECTOR panel — the selected entity's name and its serializable
 * components, each expanded into editable fields via the reflective property
 * inspector. Edits flow through the undo history. Derived components the engine
 * does not persist appear (names only) in debug mode.
 */
export const inspectorPanel = (
  state: StudioState,
  app: App,
  inspector: InspectorRegistry,
  history: History,
  assetEditors: AssetEditorRegistry,
  onExtractCopy: (sel: AssetSelection) => void,
  animatorSession: AnimatorSession,
  acDeps: () => AcAssetDeps | null,
): PanelDef => ({
  id: '/inspector',
  title: 'Inspector',
  icon: 'sliders-horizontal',
  slot: 'right',
  closable: true,
  flush: true,
  render: (ctx: EditorContext): void => {
    const { ui, widgets } = ctx;
    const p = getActivePalette();
    const selected = state.selectedEntity;
    const alive = selected !== null && app.world.hasEntity(selected);
    const registry = app.getResource(AppTypeRegistry)!.registry;
    const entries = selected !== null && alive ? listComponents(app.world, registry, selected) : [];
    const serializable = entries.filter((c) => c.serializable);
    const derived = entries.filter((c) => !c.serializable);
    const FOOTER_H = 32;
    const totalH = ui.contentAvail()[1];

    const assetSel = state.selectedAsset;

    // Scrolling body; the footer badges stay pinned at the bottom.
    ui.child('insp-body', { size: [0, totalH - FOOTER_H], border: false, padding: [12, 10] }, () => {
      // The Animator populates this shared Inspector when it holds the selection.
      // An entity/asset selection takes precedence and clears the Animator's.
      if (state.selectedEntity !== null || state.selectedAsset !== null) {
        animatorSession.selection = null;
      } else if (renderAnimatorInspectorBody(ctx, animatorSession, acDeps())) {
        return;
      }
      // Asset editing: a selected asset (material, …) shows its editor instead of
      // an entity's components. The default editor walks the asset's reflection
      // schema; a registered custom editor overrides it.
      if (assetSel !== null) {
        const server = app.getResource(AssetServer);
        if (server === undefined) {
          ui.textDisabled('No asset server.');
          return;
        }
        server.loadByGuid(assetSel.guid as AssetGuid); // idempotent — kicks the load, caches the handle
        const resolved = server.storeForGuid(assetSel.guid as AssetGuid);
        const value = resolved?.store.get(resolved.handle) as object | undefined;
        const reg = registry.get(assetSel.assetKind);

        // Asset header: type icon + name.
        const assetName =
          state.browser?.assets.find((a) => a.guid === assetSel.guid)?.name ?? assetSel.assetKind;
        const ih2 = ui.frameHeight();
        const top2 = ui.cursorScreenPos();
        drawIcon(ASSET_TYPES[assetSel.assetType].icon, [top2[0] + 2, top2[1] + (ih2 - 16) / 2], 16, srgbU32(p.green400));
        ui.dummy([22, ih2]);
        ui.sameLine(0, 4);
        ui.textColored([0.88, 0.92, 0.88, 1], assetName);
        ui.textDisabled(assetSel.assetKind);
        ui.spacing();
        ui.spacing();

        if (value === undefined) {
          ui.textDisabled('Loading asset…');
          return;
        }
        if (reg === undefined) {
          ui.textDisabled(`No editable schema registered for '${assetSel.assetKind}'.`);
          return;
        }

        // A derived (sub-asset) material is a read-only projection of its source
        // file (e.g. a glb). Edits apply live but cannot persist; offer to extract
        // an editable `.remat` copy that the meshes are repointed to.
        const isDerived = assetSel.guid.includes('#');
        if (isDerived) {
          ui.textDisabled('Derived from a model — edits apply live but are not saved.');
          if (widgets.button('Extract editable copy', { variant: 'primary', icon: 'copy', block: true })) {
            onExtractCopy(assetSel);
          }
          ui.spacing();
        }
        const edit = createAssetHistoryEmitter(history, assetSel.assetKind, assetSel.guid);
        const custom = assetEditors.get(assetSel.assetType);
        if (custom !== undefined) {
          custom({ ui, widgets, reflect: registry, inspector, selection: assetSel, value, edit, readonly: state.playing });
        } else {
          renderComponentBody({
            ui,
            widgets,
            reflect: registry,
            inspector,
            instance: value,
            registered: reg,
            readonly: state.playing,
            edit,
          });
        }
        return;
      }

      if (!alive || selected === null) {
        ui.textDisabled('No entity selected.');
        return;
      }
      const name = app.world.getComponent(selected, Name)?.value ?? `Entity ${String(selected)}`;

      // Entity header: accent icon + name + a debug toggle, vertically centered.
      const ih = ui.frameHeight();
      const top = ui.cursorScreenPos();
      drawIcon('box', [top[0] + 2, top[1] + (ih - 16) / 2], 16, srgbU32(p.green400));
      ui.dummy([22, ih]);
      ui.sameLine(0, 4);
      ui.textColored([0.88, 0.92, 0.88, 1], name);
      ui.sameLine(0, 6);
      if (widgets.iconButton('insp-debug', 'bug', { active: state.debugMode, tooltip: 'Show derived components', size: 'sm' })) {
        state.debugMode = !state.debugMode;
      }
      ui.spacing();
      ui.spacing();

      // If this entity is an instantiated glTF node, surface its stable anchor —
      // the address an entity parented under it records to survive a save/reload.
      const gltfAnchor = gltfAnchorForEntity(app.world, selected);
      if (gltfAnchor !== undefined) {
        const { node, path } = gltfAnchor.anchor;
        const label = path !== undefined && path.length > 0 ? path.join(' / ') : `node #${String(node)}`;
        ui.textDisabled(`glTF node: ${label} (#${String(node)})`);
        ui.spacing();
      }

      if (serializable.length === 0) {
        ui.textDisabled('No serializable components on this entity.');
      } else {
        for (const [i, comp] of serializable.entries()) {
          const open = widgets.collapsingHeader(`comp-${i}`, { title: comp.name, icon: 'component', defaultOpen: true });
          if (!open) continue;
          const reg = registry.get(comp.name);
          if (reg === undefined) continue;
          const instance = app.world.getComponent(selected, reg.ctor);
          if (instance === undefined) continue;
          renderComponentBody({
            ui,
            widgets,
            reflect: registry,
            inspector,
            instance,
            registered: reg,
            readonly: state.playing,
            edit: createHistoryEmitter(history, selected, reg.name),
          });
        }
      }

      // Add Component — opens the picker for the selected entity.
      ui.spacing();
      if (widgets.button('Add Component', { variant: 'secondary', icon: 'plus', block: true })) {
        openComposer(state.composer, 'add', { target: selected });
      }

      // Derived / non-serializable components — recomputed by systems, not
      // authored — revealed only in debug mode.
      if (state.debugMode && derived.length > 0) {
        ui.spacing();
        ui.textDisabled('Derived');
        ui.spacing();
        for (const [i, comp] of derived.entries()) {
          widgets.collapsingHeader(`derived-${i}`, { title: comp.name, icon: 'circle-dot', defaultOpen: false });
        }
      }
    });

    // Pinned footer — entity id + component count.
    const footTop = ui.cursorScreenPos();
    Draw.window().line([footTop[0], footTop[1]], [footTop[0] + 9999, footTop[1]], srgbU32(p.borderSubtle));
    ui.child('insp-footer', { size: [0, 0], border: false, padding: [12, 7] }, () => {
      const dl = Draw.window();
      const o = ui.cursorScreenPos();
      const badge = (x: number, text: string, tone: Tone): number => {
        const tc = toneColors(tone);
        const ts = ui.calcTextSize(text);
        const w = ts[0] + 14;
        const h = ts[1] + 6;
        dl.rectFilled([x, o[1]], [x + w, o[1] + h], tc.bg, 2);
        if (tc.border !== undefined) dl.rect([x, o[1]], [x + w, o[1] + h], tc.border, 2);
        dl.text([x + 7, o[1] + 3], tc.fg, text);
        return w;
      };
      if (assetSel !== null) {
        const w1 = badge(o[0], `ASSET · ${ASSET_TYPES[assetSel.assetType].tag}`, 'accent');
        ui.dummy([w1, ui.textLineHeight() + 6]);
        return;
      }
      const w1 = badge(o[0], alive ? `ENTITY #${String(selected)}` : 'NO SELECTION', 'accent');
      const shown = state.debugMode ? entries.length : serializable.length;
      const w2 = badge(o[0] + w1 + 6, `${shown} COMPONENTS`, 'neutral');
      ui.dummy([w1 + 6 + w2, ui.textLineHeight() + 6]);
    });
  },
});
