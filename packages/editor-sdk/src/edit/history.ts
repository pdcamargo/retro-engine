import type { Entity } from '@retro-engine/ecs';

import { applyEdit, type EditTarget, revertEdit, writeFieldLive } from './apply';
import { snapshotValue, valueEquals } from './clone';
import type { EditCommand, SetFieldCommand } from './command';
import type { ItemEdges } from './emitter';
import { type FieldPath, pathKeyOf } from './field-path';

/** One undoable unit on the stack: a lone command or a labelled group. */
type HistoryItem =
  | { readonly kind: 'single'; readonly command: EditCommand }
  | { readonly kind: 'batch'; readonly label: string; readonly commands: readonly EditCommand[] };

/** A read-only summary of one history entry, for a history view. */
export interface HistoryEntrySummary {
  readonly label: string;
}

/** Options for a {@link History}. */
export interface HistoryOptions {
  /** Maximum retained undo entries; older entries drop off the bottom. Defaults to 200. */
  readonly capacity?: number;
  /** Called whenever the stack changes (push / undo / redo / clear). */
  readonly onChange?: () => void;
}

interface Pending {
  readonly entity: Entity;
  readonly componentName: string;
  readonly path: FieldPath;
  readonly key: string;
  readonly before: unknown;
  lastAfter: unknown;
}

const interactionKey = (entity: Entity, componentName: string, pathKey: string): string =>
  `${String(entity)}|${componentName}|${pathKey}`;

const setFieldCommand = (
  entity: Entity,
  componentName: string,
  path: FieldPath,
  before: unknown,
  after: unknown,
): SetFieldCommand => ({
  kind: 'setField',
  entity,
  componentName,
  path,
  pathKey: pathKeyOf(path),
  before,
  after,
  label: `Set ${componentName}`,
});

/**
 * The studio's undo/redo stack. Holds past and future edits as data commands and
 * applies/reverts them against a live world. A continuous scrub (an ImGui drag)
 * is coalesced into one entry: the value applies live every frame via
 * {@link preview}, and a single command is recorded when the interaction ends
 * (driven by the item edges passed to {@link sync}). Atomic edits use
 * {@link commit}; programmatic multi-field edits group under {@link batch}.
 *
 * Owned by the editor host (it binds to a live world); the SDK ships the class
 * and the consumer holds the instance.
 */
export class History {
  private readonly target: EditTarget;
  private readonly capacity: number;
  private readonly onChange: () => void;
  private readonly past: HistoryItem[] = [];
  private readonly future: HistoryItem[] = [];
  private pending: Pending | null = null;
  private batch: { readonly label: string; readonly commands: EditCommand[]; depth: number } | null = null;

  constructor(target: EditTarget, options: HistoryOptions = {}) {
    this.target = target;
    this.capacity = options.capacity ?? 200;
    this.onChange = options.onChange ?? ((): void => {});
  }

  /** Whether there is an edit to undo. */
  get canUndo(): boolean {
    return this.past.length > 0;
  }

  /** Whether there is an undone edit to redo. */
  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Past entries, oldest first — for a history view. */
  entries(): readonly HistoryEntrySummary[] {
    return this.past.map((item) => ({ label: item.kind === 'single' ? item.command.label : item.label }));
  }

  /**
   * Apply a value live during a continuous interaction. The first changed frame
   * captures the before-value; subsequent frames just update the live value. No
   * history entry is recorded until {@link sync} reports the interaction ended.
   */
  preview(entity: Entity, componentName: string, path: FieldPath, current: unknown, next: unknown): void {
    const key = interactionKey(entity, componentName, pathKeyOf(path));
    if (this.pending !== null && this.pending.key !== key) this.flushPending();
    if (this.pending === null) {
      if (valueEquals(next, current)) return;
      this.pending = { entity, componentName, path, key, before: snapshotValue(current), lastAfter: snapshotValue(next) };
    } else {
      this.pending.lastAfter = snapshotValue(next);
    }
    writeFieldLive(this.target, entity, componentName, path, next);
  }

  /** Report a widget's item edges; commits the coalesced interaction when it ends. */
  sync(entity: Entity, componentName: string, path: FieldPath, edges: ItemEdges): void {
    if (!edges.deactivatedAfterEdit) return;
    if (this.pending === null) return;
    if (this.pending.key !== interactionKey(entity, componentName, pathKeyOf(path))) return;
    this.flushPending();
  }

  /** Apply an atomic edit live and record it as one entry immediately. */
  commit(entity: Entity, componentName: string, path: FieldPath, current: unknown, next: unknown): void {
    this.flushPending();
    if (valueEquals(current, next)) return;
    const command = setFieldCommand(entity, componentName, path, snapshotValue(current), snapshotValue(next));
    applyEdit(command, this.target);
    this.record(command);
  }

  /** Apply a prepared command live and record it (e.g. add/remove component). */
  apply(command: EditCommand): void {
    this.flushPending();
    applyEdit(command, this.target);
    this.record(command);
  }

  /** Begin a group; edits recorded until the matching {@link endBatch} undo together. Reentrant. */
  beginBatch(label: string): void {
    if (this.batch !== null) {
      this.batch.depth++;
      return;
    }
    this.batch = { label, commands: [], depth: 1 };
  }

  /** Close the current group, recording it as one entry. */
  endBatch(): void {
    if (this.batch === null) return;
    if (--this.batch.depth > 0) return;
    const batch = this.batch;
    this.batch = null;
    if (batch.commands.length === 0) return;
    this.pushItem({ kind: 'batch', label: batch.label, commands: batch.commands });
  }

  /** Undo the most recent entry. */
  undo(): void {
    this.flushPending();
    const item = this.past.pop();
    if (item === undefined) return;
    if (item.kind === 'single') revertEdit(item.command, this.target);
    else for (let i = item.commands.length - 1; i >= 0; i--) revertEdit(item.commands[i]!, this.target);
    this.future.push(item);
    this.onChange();
  }

  /** Redo the most recently undone entry. */
  redo(): void {
    this.flushPending();
    const item = this.future.pop();
    if (item === undefined) return;
    if (item.kind === 'single') applyEdit(item.command, this.target);
    else for (const command of item.commands) applyEdit(command, this.target);
    this.past.push(item);
    this.onChange();
  }

  /** Drop all history (e.g. on scene load or play/stop). */
  clear(): void {
    this.pending = null;
    this.batch = null;
    if (this.past.length === 0 && this.future.length === 0) return;
    this.past.length = 0;
    this.future.length = 0;
    this.onChange();
  }

  private flushPending(): void {
    const pending = this.pending;
    this.pending = null;
    if (pending === null) return;
    if (valueEquals(pending.before, pending.lastAfter)) return;
    this.record(setFieldCommand(pending.entity, pending.componentName, pending.path, pending.before, pending.lastAfter));
  }

  private record(command: EditCommand): void {
    if (this.batch !== null) {
      this.batch.commands.push(command);
      return;
    }
    this.pushItem({ kind: 'single', command });
  }

  private pushItem(item: HistoryItem): void {
    this.future.length = 0;
    this.past.push(item);
    if (this.past.length > this.capacity) this.past.shift();
    this.onChange();
  }
}
