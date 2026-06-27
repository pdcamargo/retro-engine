import type { Entity } from '@retro-engine/ecs';

import type { EditEmitter, ScalarEdit } from './emitter';
import type { FieldPath } from './field-path';
import type { History } from './history';
import { assetScope, type EditScope, entityScope } from './scope';

/**
 * An {@link EditEmitter} bound to one {@link EditScope}, routing every edit
 * through a {@link History} so changes are undoable. Continuous scrubs coalesce
 * into a single entry; atomic edits record immediately. Construct one per edited
 * value per frame — the interaction state lives on the history, not the emitter,
 * so a fresh facade each frame is correct.
 */
export const createScopedHistoryEmitter = (history: History, scope: EditScope): EditEmitter => ({
  scalar<T>(path: FieldPath, current: T): ScalarEdit<T> {
    return {
      value: current,
      preview: (next: T): void => history.previewScoped(scope, path, current, next),
      commit: (next: T): void => history.commitScoped(scope, path, current, next),
      sync: (edges): void => history.syncScoped(scope, path, edges),
    };
  },
  batch(label: string, body: () => void): void {
    history.beginBatch(label);
    try {
      body();
    } finally {
      history.endBatch();
    }
  },
});

/** An {@link EditEmitter} bound to one component on one entity, routed through {@link History}. */
export const createHistoryEmitter = (history: History, entity: Entity, componentName: string): EditEmitter =>
  createScopedHistoryEmitter(history, entityScope(entity, componentName));

/**
 * An {@link EditEmitter} bound to one stored asset value (by kind + guid), routed
 * through {@link History} — so editing an asset's fields is undoable and audited
 * exactly like an entity's components.
 */
export const createAssetHistoryEmitter = (history: History, assetKind: string, guid: string): EditEmitter =>
  createScopedHistoryEmitter(history, assetScope(assetKind, guid));
