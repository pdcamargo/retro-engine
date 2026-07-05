import type { AssetActionRegistry, AssetActionTarget } from '@retro-engine/editor-sdk';

/** Studio callbacks the built-in asset actions close over (the editor's own actions). */
export interface BuiltinAssetActionDeps {
  /** Open/activate an asset in its editor (bundle editor, Animator, …). */
  readonly activate: (target: AssetActionTarget) => void;
  /** Select the parent source file of a derived child. */
  readonly selectParent: (target: AssetActionTarget) => void;
  /** Create a new Animation Controller under `folder` with `baseName`. */
  readonly createAnimationController: (baseName: string, folder: string) => Promise<void>;
}

const stubRun = (label: string): (() => void) => () => console.info(`[assets] ${label} — not yet implemented`);

/** Only for a top-level asset (not a derived sub-asset, which has no file of its own). */
const isFileAsset = (ctx: { asset?: AssetActionTarget | undefined }): boolean =>
  ctx.asset !== undefined && !ctx.asset.isChild;

/**
 * Register the editor's own asset context-menu actions into `registry`: the shared
 * set (Open / Rename / Duplicate / … / Delete), the type-specific entries, and the
 * panel-scope "create" actions. Rename / Delete / create route through the panel's
 * {@link AssetActionHost}; Open / Select Parent / create-on-disk use `deps`. An end
 * user's project adds more the same way.
 */
export const registerBuiltinAssetActions = (registry: AssetActionRegistry, deps: BuiltinAssetActionDeps): void => {
  registry
    .registerForAll({
      id: 'open',
      label: 'Open',
      icon: 'square-arrow-out-up-right',
      shortcut: '↵',
      order: 10,
      when: isFileAsset,
      run: (ctx) => {
        if (ctx.asset !== undefined) deps.activate(ctx.asset);
      },
    })
    .registerForAll({
      id: 'rename',
      label: 'Rename',
      icon: 'pencil',
      shortcut: 'F2',
      order: 20,
      when: isFileAsset,
      run: (ctx) => {
        if (ctx.asset !== undefined) ctx.host.beginRename(ctx.asset.guid);
      },
    })
    .registerForAll({ id: 'duplicate', label: 'Duplicate', icon: 'copy', shortcut: '⌘D', order: 30, when: isFileAsset, run: stubRun('Duplicate') })
    .registerForAll({ id: 'reimport', label: 'Reimport', icon: 'refresh-cw', order: 40, separatorBefore: true, when: isFileAsset, run: stubRun('Reimport') })
    .registerForAll({ id: 'show-in-explorer', label: 'Show in Explorer', icon: 'folder-open', order: 50, when: isFileAsset, run: stubRun('Show in Explorer') })
    .registerForAll({
      id: 'select-parent',
      label: 'Select Parent',
      icon: 'corner-left-up',
      order: 90,
      separatorBefore: true,
      when: (ctx) => ctx.asset?.isChild === true,
      run: (ctx) => {
        if (ctx.asset !== undefined) deps.selectParent(ctx.asset);
      },
    })
    .registerForAll({
      id: 'delete',
      label: 'Delete',
      icon: 'trash-2',
      shortcut: '⌫',
      danger: true,
      order: 100,
      separatorBefore: true,
      when: isFileAsset,
      run: (ctx) => {
        if (ctx.asset !== undefined) ctx.host.deleteAsset(ctx.asset);
      },
    });

  // Type-specific actions (migrated from the former hardcoded switch).
  const spriteActions = [
    { id: 'sprite-editor', label: 'Sprite Editor', icon: 'box-select' as const, run: stubRun('Sprite Editor') },
    { id: 'create-material', label: 'Create Material', icon: 'circle-dot' as const, run: stubRun('Create Material') },
    { id: 'set-skybox', label: 'Set as Skybox', icon: 'cloud' as const, run: stubRun('Set as Skybox') },
  ];
  for (const t of ['texture', 'image'] as const) {
    spriteActions.forEach((a, i) => registry.registerForType(t, { ...a, order: 60 + i }));
  }
  const meshActions = [
    { id: 'import-settings', label: 'Import Settings', icon: 'sliders-horizontal' as const, run: stubRun('Import Settings') },
    { id: 'extract-animations', label: 'Extract Animations', icon: 'film' as const, run: stubRun('Extract Animations') },
    { id: 'create-prefab', label: 'Create Prefab', icon: 'component' as const, run: stubRun('Create Prefab') },
  ];
  for (const t of ['model', 'mesh'] as const) {
    meshActions.forEach((a, i) => registry.registerForType(t, { ...a, order: 60 + i }));
  }
  registry
    .registerForType('material', { id: 'edit-shader', label: 'Edit Shader', icon: 'file-code', order: 60, run: stubRun('Edit Shader') })
    .registerForType('material', { id: 'duplicate-variant', label: 'Duplicate as Variant', icon: 'copy-plus', order: 61, run: stubRun('Duplicate as Variant') })
    .registerForType('audio', { id: 'play', label: 'Play', icon: 'play', order: 60, run: stubRun('Play') })
    .registerForType('animation', {
      id: 'open-in-animator',
      label: 'Open in Animation Editor',
      icon: 'film',
      order: 60,
      when: isFileAsset,
      run: (ctx) => {
        if (ctx.asset !== undefined) deps.activate(ctx.asset);
      },
    });

  // Panel-scope "create" actions (right-click empty space). Each opens an inline
  // virtual card via the host, then writes the asset on confirm.
  registry.registerForPanel({
    id: 'create-animation-controller',
    label: 'Create Animation Controller',
    icon: 'workflow',
    group: 'Animation',
    order: 10,
    run: (ctx) =>
      ctx.host.beginCreate({
        type: 'animation',
        extension: 'ranimctrl',
        defaultName: 'New Animation Controller',
        icon: 'workflow',
        tag: 'CTRL',
        create: deps.createAnimationController,
      }),
  });
};
