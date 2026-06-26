import { ImGui, ImGuiCol } from '@mori2003/jsimgui';
import { Draw, type EditorContext, getActivePalette, srgbU32 } from '@retro-engine/editor-sdk';

import { buildFolderTree, type FolderNode } from '../asset-picker/asset-picker-catalog';
import type { BrowserAsset } from '../project/project-browser';

import type { AssetsPanelState } from './assets-panel-state';

const cap = (s: string): string => (s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1));

/** The "All Assets / Folder / Sub" trail for the selected folder. */
export const breadcrumbText = (folder: string): string =>
  folder === 'all' ? 'All Assets' : `All Assets / ${folder.split('/').map(cap).join(' / ')}`;

/**
 * The left folder-tree sidebar: an "All Assets" root over the project's nested
 * folders (derived from asset locations), driving `st.folder` /
 * `st.expandedFolders`. Mirrors the asset picker's tree.
 */
export const renderAssetsTree = (
  ctx: EditorContext,
  st: AssetsPanelState,
  assets: readonly BrowserAsset[],
  size: [number, number],
): void => {
  const { ui, widgets } = ctx;
  const p = getActivePalette();
  ImGui.PushStyleColor(ImGuiCol.ChildBg, srgbU32(p.gray1));
  ui.child('assets-tree', { size, border: true, padding: [4, 6] }, () => {
    const all = widgets.treeItem({
      id: 'assets-sf-all',
      label: 'All Assets',
      icon: 'layers',
      depth: 0,
      selected: st.folder === 'all',
      badge: String(assets.length),
    });
    if (all.clicked) st.folder = 'all';

    const fstart = ui.cursorScreenPos();
    Draw.window().text([fstart[0] + 6, fstart[1] + 6], srgbU32(p.textFaint), 'FOLDERS');
    ui.dummy([size[0], 22]);

    const root = buildFolderTree(assets);
    const walk = (node: FolderNode, depth: number): void => {
      for (const child of [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name))) {
        const hasKids = child.children.size > 0;
        const isOpen = st.expandedFolders.has(child.path);
        const r = widgets.treeItem({
          id: `assets-f-${child.path}`,
          label: cap(child.name),
          icon: hasKids && isOpen ? 'folder-open' : 'folder',
          depth,
          hasChildren: hasKids,
          open: isOpen,
          selected: st.folder === child.path,
          badge: String(child.count),
        });
        if (r.toggled) {
          if (isOpen) st.expandedFolders.delete(child.path);
          else st.expandedFolders.add(child.path);
        }
        if (r.clicked) st.folder = child.path;
        if (hasKids && isOpen) walk(child, depth + 1);
      }
    };
    walk(root, 0);
  });
  ImGui.PopStyleColor(1);
};
