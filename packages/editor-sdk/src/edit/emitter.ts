import type { Entity } from '@retro-engine/ecs';

import { type EditTarget, writeFieldLive } from './apply';
import { snapshotValue } from './clone';
import { type FieldPath, writePathLeaf } from './field-path';

/**
 * The immediate-mode item-state edges a renderer reads right after drawing a
 * widget, mapped from Dear ImGui's `IsItemActivated` / `IsItemDeactivatedAfter-
 * Edit` / `IsItemEdited`. Handed to {@link ScalarEdit.sync} so the host can
 * coalesce a continuous scrub into a single undoable step.
 */
export interface ItemEdges {
  /** The item began interaction this frame (e.g. a drag started). */
  readonly activated: boolean;
  /** The item ended interaction this frame after at least one edit (e.g. drag released). */
  readonly deactivatedAfterEdit: boolean;
  /** The item's value changed this frame. */
  readonly edited: boolean;
}

/**
 * The handle a renderer uses to report changes to one addressable value. State
 * lives in the host (the world and the undo history), never in the renderer:
 * feed {@link value} to the widget, then either {@link preview} the next value
 * every frame and {@link sync} the item edges (continuous scrubs), or
 * {@link commit} once (atomic widgets like a combo or checkbox).
 */
export interface ScalarEdit<T> {
  /** The current value to feed the widget this frame. */
  readonly value: T;
  /** Apply `next` live every frame; the single undo step is committed on interaction end. */
  preview(next: T): void;
  /** Apply `next` live and record one undo step immediately (for atomic edits). */
  commit(next: T): void;
  /** Hand the widget's item edges to the host so a continuous scrub coalesces into one step. */
  sync(edges: ItemEdges): void;
}

/**
 * The write boundary a property renderer is given. Renderers depend only on this
 * interface, so whether a full undo history sits behind it or edits apply
 * directly is invisible to them.
 */
export interface EditEmitter {
  /** Begin editing the value at `path` (relative to the bound component), seeded with `current`. */
  scalar<T>(path: FieldPath, current: T): ScalarEdit<T>;
  /** Run `body`'s edits as one undoable group (e.g. a reset that writes several fields). */
  batch(label: string, body: () => void): void;
}

/**
 * An emitter that applies edits straight to the live world with no undo history.
 * Useful in headless contexts and tests; the studio uses a history-backed
 * emitter instead. Same interface, so renderers need no change between them.
 */
export const createDirectEmitter = (target: EditTarget, entity: Entity, componentName: string): EditEmitter => ({
  scalar<T>(path: FieldPath, current: T): ScalarEdit<T> {
    const write = (next: T): void => writeFieldLive(target, entity, componentName, path, next);
    return { value: current, preview: write, commit: write, sync: () => {} };
  },
  batch(_label: string, body: () => void): void {
    body();
  },
});

/**
 * An emitter that writes edits straight into a detached component instance (no
 * world, no entity, no undo history). For editing component values outside the
 * ECS — e.g. a bundle draft in an asset editor — through the same property
 * renderers the live inspector uses. `onChange` fires after each write so the
 * host can mark its draft dirty or regenerate a preview.
 */
export const createInstanceEmitter = (instance: object, onChange?: () => void): EditEmitter => ({
  scalar<T>(path: FieldPath, current: T): ScalarEdit<T> {
    const write = (next: T): void => {
      writePathLeaf(instance, path, snapshotValue(next));
      onChange?.();
    };
    return { value: current, preview: write, commit: write, sync: () => {} };
  },
  batch(_label: string, body: () => void): void {
    body();
  },
});
