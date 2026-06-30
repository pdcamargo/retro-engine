import type { ImTextureRef } from '@mori2003/jsimgui';
import type { Entity } from '@retro-engine/ecs';

import type { AssetType } from '../components-asset';

/** An entity dragged out of the hierarchy (e.g. to author a prefab from it). */
export interface EntityDragPayload {
  readonly kind: 'entity';
  /** The dragged entity. */
  readonly entity: Entity;
  /** Display name for the drag ghost. */
  readonly label: string;
}

/** An asset dragged out of the asset browser. */
export interface AssetDragPayload {
  readonly kind: 'asset';
  /** The asset's persistent GUID. */
  readonly guid: string;
  /** The asset's manifest kind tag (e.g. `'StandardMaterial'`, `'Prefab'`, `'Image'`). */
  readonly assetKind: string;
  /** The browser display category, for the drag ghost's swatch/tag. */
  readonly assetType?: AssetType | undefined;
  /** Display name. */
  readonly name: string;
  /** Optional preview painted in the drag ghost. */
  readonly thumbnail?: ImTextureRef | undefined;
}

/**
 * A drag payload. The two built-in shapes ({@link EntityDragPayload},
 * {@link AssetDragPayload}) cover the editor's own sources; the open variant lets
 * a consumer define custom drag kinds and recognise them in a drop target's
 * `accepts` predicate by their `kind` discriminant.
 */
export type DragPayload =
  | EntityDragPayload
  | AssetDragPayload
  | { readonly kind: string; readonly [key: string]: unknown };
