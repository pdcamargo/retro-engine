import type { Entity } from '@retro-engine/ecs';

/**
 * What an edit targets: a component on a live entity, or a stored asset value.
 *
 * The edit stack (`EditCommand`, `History`, `EditEmitter`) is scope-generic so an
 * asset's fields are edited through the same undoable / audited path as an
 * entity's components.
 */
export type EditScope =
  | { readonly kind: 'entity'; readonly entity: Entity; readonly componentName: string }
  | { readonly kind: 'asset'; readonly assetKind: string; readonly guid: string };

/** A stable string key for a scope — the coalescing identity of an interaction. */
export const scopeKey = (scope: EditScope): string =>
  scope.kind === 'entity'
    ? `e|${String(scope.entity)}|${scope.componentName}`
    : `a|${scope.assetKind}|${scope.guid}`;

/** A short human label for the thing being edited (component or asset kind). */
export const scopeLabel = (scope: EditScope): string =>
  scope.kind === 'entity' ? scope.componentName : scope.assetKind;

/** Build a component-on-entity scope. */
export const entityScope = (entity: Entity, componentName: string): EditScope => ({
  kind: 'entity',
  entity,
  componentName,
});

/** Build a stored-asset scope. */
export const assetScope = (assetKind: string, guid: string): EditScope => ({ kind: 'asset', assetKind, guid });
