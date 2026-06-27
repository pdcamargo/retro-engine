import type { TypeRegistry } from '@retro-engine/reflect';

import type { Widgets } from '../components';
import type { AssetSelection, AssetType } from '../components-asset';
import type { EditEmitter } from '../edit/emitter';
import type { InspectorRegistry } from '../inspector/inspector-registry';
import type { Ui } from '../ui';

/**
 * What an {@link AssetEditor} is handed to draw + edit one selected asset. Mirrors
 * the inspector's per-component context, but for a stored asset value rather than
 * an entity component: the live value, the reflection registry, and an
 * asset-scoped {@link EditEmitter} whose edits are undoable and persisted.
 */
export interface AssetEditorContext {
  readonly ui: Ui;
  readonly widgets: Widgets;
  /** The reflection registry — look up the asset's schema by its kind. */
  readonly reflect: TypeRegistry;
  /** The inspector registry, so an editor can reuse the field renderers / amendments. */
  readonly inspector: InspectorRegistry;
  /** The selected asset (type, guid, kind). */
  readonly selection: AssetSelection;
  /** The live asset value being edited. */
  readonly value: object;
  /** Asset-scoped write boundary — edits route through History (undoable) and persist. */
  readonly edit: EditEmitter;
  /** True when edits should be disabled (e.g. play mode). */
  readonly readonly: boolean;
}

/** Draws + edits one selected asset of a given {@link AssetType}. */
export type AssetEditor = (ctx: AssetEditorContext) => void;

/**
 * The registry of custom asset editors, keyed by {@link AssetType} — the asset
 * counterpart to the inspector's component-editor registry. An asset type with no
 * registered editor falls back to the default reflection walk (the inspector
 * renders the asset's schema fields directly), so a reflected asset is editable
 * with no registration; register an entry only for a richer, bespoke surface.
 */
export class AssetEditorRegistry {
  private readonly editors = new Map<AssetType, AssetEditor>();

  /** Register `editor` for `assetType`. Chainable. */
  register(assetType: AssetType, editor: AssetEditor): this {
    this.editors.set(assetType, editor);
    return this;
  }

  /** The editor registered for `assetType`, or `undefined`. */
  get(assetType: AssetType): AssetEditor | undefined {
    return this.editors.get(assetType);
  }

  /** Whether a custom editor is registered for `assetType`. */
  has(assetType: AssetType): boolean {
    return this.editors.has(assetType);
  }
}

/** Create an empty {@link AssetEditorRegistry}. */
export const createAssetEditorRegistry = (): AssetEditorRegistry => new AssetEditorRegistry();
