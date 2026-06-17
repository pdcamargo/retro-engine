import type { Entity } from '@retro-engine/ecs';

import type { EditEmitter, ScalarEdit } from './emitter';
import type { FieldPath } from './field-path';
import type { History } from './history';

/**
 * An {@link EditEmitter} bound to one component on one entity, routing every edit
 * through a {@link History} so changes are undoable. Continuous scrubs coalesce
 * into a single entry; atomic edits record immediately. Construct one per
 * inspected component per frame — the interaction state lives on the history, not
 * the emitter, so a fresh facade each frame is correct.
 */
export const createHistoryEmitter = (history: History, entity: Entity, componentName: string): EditEmitter => ({
  scalar<T>(path: FieldPath, current: T): ScalarEdit<T> {
    return {
      value: current,
      preview: (next: T): void => history.preview(entity, componentName, path, current, next),
      commit: (next: T): void => history.commit(entity, componentName, path, current, next),
      sync: (edges): void => history.sync(entity, componentName, path, edges),
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
