import {
  buildOutline,
  Draw,
  drawIcon,
  type EditorContext,
  getActivePalette,
  type PanelDef,
  srgbU32,
} from '@retro-engine/editor-sdk';
import { type App, AppTypeRegistry } from '@retro-engine/engine';

import { openComposer } from './composer/composer-state';
import { studioClassifiers } from './entity-classifiers';
import { EditorOnly } from './editor-markers';
import { type StudioState } from './state';

/** The HIERARCHY panel — the live entity tree with filter, selection, and expand/collapse. */
export const hierarchyPanel = (state: StudioState, app: App): PanelDef => ({
  id: '/hierarchy',
  title: 'Hierarchy',
  icon: 'list-tree',
  slot: 'left',
  flush: true,
  render: ({ ui, widgets }: EditorContext): void => {
    const p = getActivePalette();
    const SEARCH_H = 38;
    const FOOTER_H = 26;
    const totalH = ui.contentAvail()[1];

    // Search + header actions strip, with a 1px bottom hairline.
    const searchTop = ui.cursorScreenPos();
    ui.child('hier-search', { size: [0, SEARCH_H], border: false, padding: [8, 6] }, () => {
      const avail = ui.contentAvail()[0];
      const h = ui.frameHeight();
      const it = ui.cursorScreenPos();
      drawIcon('search', [it[0], it[1] + (h - 14) / 2], 14, srgbU32(p.textMuted));
      ui.dummy([18, h]);
      ui.sameLine(0, 4);
      state.entityFilter = ui.inputText('##entity-filter', state.entityFilter, {
        hint: 'Filter entities…',
        width: avail - 78,
      });
      ui.sameLine(0, 4);
      if (widgets.iconButton('hier-add', 'plus', { tooltip: 'Create entity', size: 'sm' })) {
        openComposer(state.composer, 'create');
      }
      ui.sameLine(0, 2);
      if (widgets.iconButton('hier-collapse', 'chevrons-down-up', { tooltip: 'Collapse all', size: 'sm' })) {
        for (const node of buildOutline(app.world)) if (node.hasChildren) state.collapsed.add(node.entity);
      }
    });
    Draw.window().line([searchTop[0], searchTop[1] + SEARCH_H], [searchTop[0] + 9999, searchTop[1] + SEARCH_H], srgbU32(p.borderSubtle));

    // Read the live world into a flattened tree each frame. Collapsed subtrees
    // are omitted by the reader; selection + expand state live on StudioState
    // keyed by entity (the model is rebuilt, so it can't live on the nodes).
    const filter = state.entityFilter.trim().toLowerCase();
    const nodes = buildOutline(app.world, {
      isOpen: (e) => !state.collapsed.has(e),
      // Editor-owned entities (cameras, lights, helpers) are hidden from the
      // authored tree unless debug mode reveals them.
      skip: (e) => !state.debugMode && app.world.has(e, EditorOnly),
      classifiers: studioClassifiers,
      // Badge counts non-derived components so it matches the inspector; in debug
      // mode the inspector also lists derived ones, so count everything.
      registry: state.debugMode ? undefined : app.getResource(AppTypeRegistry)!.registry,
    });
    const treeH = Math.max(48, totalH - SEARCH_H - FOOTER_H - 8);
    ui.child('hier-tree', { size: [0, treeH], border: false, padding: [4, 4] }, () => {
      ui.withItemSpacing(0, 0, () => {
        for (const node of nodes) {
          if (filter !== '' && !node.name.toLowerCase().includes(filter)) continue;
          const result = widgets.treeItem({
            id: String(node.entity),
            label: node.name,
            icon: node.class.icon,
            depth: node.depth,
            hasChildren: node.hasChildren,
            open: !state.collapsed.has(node.entity),
            selected: state.selectedEntity === node.entity,
            badge: node.componentCount > 0 ? String(node.componentCount) : undefined,
          });
          if (result.toggled) {
            if (state.collapsed.has(node.entity)) state.collapsed.delete(node.entity);
            else state.collapsed.add(node.entity);
          } else if (result.clicked) {
            state.selectedEntity = node.entity;
            state.selectedAsset = null;
          }
        }
      });
    });
    const footTop = ui.cursorScreenPos();
    Draw.window().line([footTop[0], footTop[1]], [footTop[0] + 9999, footTop[1]], srgbU32(p.borderSubtle));
    ui.child('hier-footer', { size: [0, 0], border: false, padding: [8, 6] }, () => {
      ui.textColored([0.2, 0.88, 0.48, 1], String(nodes.length));
      ui.sameLine(0, 5);
      ui.textDisabled('entities');
    });
  },
});
