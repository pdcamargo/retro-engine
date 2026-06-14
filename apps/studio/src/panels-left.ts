import { Draw, drawIcon, type EditorContext, getActivePalette, type PanelDef, srgbU32 } from '@retro-engine/editor-sdk';

import { componentCount, type Entity } from './scene-data';
import { type StudioState } from './state';

const isHidden = (state: StudioState, e: Entity): boolean => {
  let parent = e.parent;
  while (parent !== undefined) {
    const p = state.scene.entities.find((x) => x.id === parent);
    if (p === undefined) break;
    if (!p.open) return true;
    parent = p.parent;
  }
  return false;
};

/** The HIERARCHY panel — entity tree with filter, selection, and visibility toggles. */
export const hierarchyPanel = (state: StudioState): PanelDef => ({
  id: '/hierarchy',
  title: 'Hierarchy',
  icon: 'list-tree',
  slot: 'left',
  flush: true,
  render: ({ ui, widgets }: EditorContext): void => {
    const scene = state.scene;
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
      if (widgets.iconButton('hier-add', 'plus', { tooltip: 'Add entity', size: 'sm' })) {
        /* add entity */
      }
      ui.sameLine(0, 2);
      if (widgets.iconButton('hier-collapse', 'chevrons-down-up', { tooltip: 'Collapse all', size: 'sm' })) {
        for (const e of scene.entities) if (e.group === true) e.open = false;
      }
    });
    Draw.window().line([searchTop[0], searchTop[1] + SEARCH_H], [searchTop[0] + 9999, searchTop[1] + SEARCH_H], srgbU32(p.borderSubtle));

    // Tree scrolls internally; footer stays pinned (panel window has no scrollbar).
    const filter = state.entityFilter.trim().toLowerCase();
    const treeH = Math.max(48, totalH - SEARCH_H - FOOTER_H - 8);
    ui.child('hier-tree', { size: [0, treeH], border: false, padding: [4, 4] }, () => {
      ui.withItemSpacing(0, 0, () => {
        for (const e of scene.entities) {
          if (isHidden(state, e)) continue;
          if (filter !== '' && !e.name.toLowerCase().includes(filter)) continue;
          const count = componentCount(scene, e.id);
          const result = widgets.treeItem({
            id: e.id,
            label: e.name,
            icon: e.icon,
            depth: e.depth,
            hasChildren: e.group === true,
            open: e.open,
            selected: state.selected === e.id,
            badge: count > 0 ? String(count) : undefined,
            visible: e.group === true ? undefined : e.visible,
          });
          if (result.toggled) e.open = !e.open;
          else if (result.visibilityToggled) e.visible = !e.visible;
          else if (result.clicked) state.selected = e.id;
        }
      });
    });
    const footTop = ui.cursorScreenPos();
    Draw.window().line([footTop[0], footTop[1]], [footTop[0] + 9999, footTop[1]], srgbU32(p.borderSubtle));
    ui.child('hier-footer', { size: [0, 0], border: false, padding: [8, 6] }, () => {
      const n = scene.entities.filter((e) => e.group !== true).length;
      ui.textColored([0.2, 0.88, 0.48, 1], String(n));
      ui.sameLine(0, 5);
      ui.textDisabled('entities');
    });
  },
});
