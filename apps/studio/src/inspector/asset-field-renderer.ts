import type { Handle } from '@retro-engine/assets';
import { type PropertyContext, type PropertyRenderer, propertyRow } from '@retro-engine/editor-sdk';
import { type App, Name } from '@retro-engine/engine';

import { assetTypeSpec } from '../asset-picker/asset-picker-catalog';
import { openAssetPicker } from '../asset-picker/asset-picker-state';
import { augmentedAssets } from '../asset-picker/picker-pool';
import type { BrowserAsset } from '../project/project-browser';
import type { StudioState } from '../state';

interface Deps {
  readonly state: StudioState;
  readonly app: App;
}

/** The currently-selected entity's display name, for the picker's context row. */
const entityLabel = (state: StudioState, app: App): string => {
  const entity = state.selectedEntity;
  if (entity === null || !app.world.hasEntity(entity)) return '';
  return app.world.getComponent(entity, Name)?.value ?? `Entity #${String(entity)}`;
};

/** What to show in the field for the current handle value. */
const describeCurrent = (
  state: StudioState,
  app: App,
  handle: Handle<unknown> | undefined,
): { name: string | undefined; asset: BrowserAsset | undefined } => {
  const guid = handle?.guid ?? null;
  if (handle === undefined) return { name: undefined, asset: undefined };
  if (guid === null) return { name: '(default)', asset: undefined };
  // Search the augmented pool so a model's derived clip resolves its name, not
  // just top-level files.
  const asset = augmentedAssets(app, state.browser).find((a) => a.guid === guid);
  return { name: asset?.name ?? '(missing)', asset };
};

/**
 * The inspector renderer for `t.handle(...)` fields: an input-like asset slot
 * that, on click, opens the asset picker scoped to the slot's expected type. The
 * commit is captured as a closure over the field's edit boundary, so the picker
 * (which confirms on a later frame) writes back through the same undoable path —
 * and any future trigger (drag-and-drop) can assign the same way.
 */
export const makeAssetFieldRenderer =
  ({ state, app }: Deps): PropertyRenderer =>
  (ctx: PropertyContext): void => {
    const handle = (ctx.value ?? undefined) as Handle<unknown> | undefined;
    const spec = assetTypeSpec(ctx.type.assetType ?? null);
    const { name, asset } = describeCurrent(state, app, handle);
    const thumbnail =
      asset?.thumbnailable === true ? state.browser?.thumbnails.get(asset.guid, asset.location) : undefined;

    propertyRow(ctx, () => {
      const { clicked } = ctx.widgets.assetField(ctx.id, {
        name,
        type: asset?.type,
        thumbnail,
        expectsLabel: spec.noun,
        readonly: ctx.readonly,
      });
      if (!clicked) return;
      // Capture the edit boundary + address now; the picker commits later.
      const edit = ctx.edit;
      const path = ctx.path;
      const current = ctx.value;
      const last = path[path.length - 1];
      const propertyLabel = last !== undefined && last.kind === 'field' ? last.name : ctx.meta.label;
      openAssetPicker(state.assetPicker, {
        allowedStoreType: ctx.type.assetType ?? null,
        currentGuid: handle?.guid ?? null,
        canClear: ctx.type.isOptional || ctx.type.isNullable,
        entityLabel: entityLabel(state, app),
        componentLabel: ctx.componentName,
        propertyLabel,
        commit: (next) => edit.scalar(path, current).commit(next),
      });
    });
  };
