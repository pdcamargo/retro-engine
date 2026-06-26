import type { MenuEntry } from '@retro-engine/editor-sdk';

import type { BrowserAsset } from '../project/project-browser';

/** Hooks the panel wires into the context menu; unset entries fall back to a log stub. */
export interface AssetMenuActions {
  /** Open the asset in its editor (bundle editor, scene, clip editor, …). */
  readonly onOpen?: (asset: BrowserAsset) => void;
  /** Select the parent source file of a derived child. */
  readonly onSelectParent?: (child: BrowserAsset) => void;
}

const stub = (label: string): (() => void) => () => console.info(`[assets] ${label} — not yet implemented`);

/**
 * Build the right-click menu for an asset: a baseline set every type shares plus
 * type-specific actions under a heading. Derived children get "Select Parent"
 * and omit Delete (the source owns them).
 */
export const buildAssetMenu = (
  asset: BrowserAsset,
  isChild: boolean,
  actions: AssetMenuActions,
): MenuEntry[] => {
  const entries: MenuEntry[] = [
    { label: 'Open', icon: 'square-arrow-out-up-right', shortcut: '↵', onClick: () => (actions.onOpen ? actions.onOpen(asset) : stub('Open')()) },
    { label: 'Rename', icon: 'pencil', shortcut: 'F2', onClick: stub('Rename') },
    { label: 'Duplicate', icon: 'copy', shortcut: '⌘D', onClick: stub('Duplicate') },
    { separator: true },
    { label: 'Reimport', icon: 'refresh-cw', onClick: stub('Reimport') },
    { label: 'Show in Explorer', icon: 'folder-open', onClick: stub('Show in Explorer') },
  ];

  const specific = typeSpecific(asset);
  if (specific.length > 0) {
    entries.push({ heading: asset.type.toUpperCase() }, ...specific);
  }

  if (isChild) {
    entries.push(
      { separator: true },
      { label: 'Select Parent', icon: 'corner-left-up', onClick: () => (actions.onSelectParent ? actions.onSelectParent(asset) : stub('Select Parent')()) },
    );
  } else {
    entries.push(
      { separator: true },
      { label: 'Delete', icon: 'trash-2', shortcut: '⌫', danger: true, onClick: stub('Delete') },
    );
  }
  return entries;
};

const typeSpecific = (asset: BrowserAsset): MenuEntry[] => {
  switch (asset.type) {
    case 'texture':
    case 'image':
      return [
        { label: 'Sprite Editor', icon: 'box-select', onClick: stub('Sprite Editor') },
        { label: 'Create Material', icon: 'circle-dot', onClick: stub('Create Material') },
        { label: 'Set as Skybox', icon: 'cloud', onClick: stub('Set as Skybox') },
      ];
    case 'model':
    case 'mesh':
      return [
        { label: 'Import Settings', icon: 'sliders-horizontal', onClick: stub('Import Settings') },
        { label: 'Extract Animations', icon: 'film', onClick: stub('Extract Animations') },
        { label: 'Create Prefab', icon: 'component', onClick: stub('Create Prefab') },
      ];
    case 'material':
      return [
        { label: 'Edit Shader', icon: 'file-code', onClick: stub('Edit Shader') },
        { label: 'Duplicate as Variant', icon: 'copy-plus', onClick: stub('Duplicate as Variant') },
      ];
    case 'animation':
      return [{ label: 'Open in Animation Editor', icon: 'film', onClick: stub('Open in Animation Editor') }];
    case 'audio':
      return [{ label: 'Play', icon: 'play', onClick: stub('Play') }];
    default:
      return [];
  }
};
