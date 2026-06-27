import type { Entity } from '@retro-engine/ecs';

import { applyEdit, type EditTarget, revertEdit, writeScopedLive } from './apply';
import { snapshotValue, valueEquals } from './clone';
import type { EditCommand, SetFieldCommand } from './command';
import type { ItemEdges } from './emitter';
import { type FieldPath, pathKeyOf } from './field-path';
import { type EditScope, entityScope, scopeKey, scopeLabel } from './scope';

/** One undoable unit on the stack: a lone command or a labelled group. */
type HistoryItem =
  | { readonly kind: 'single'; readonly command: EditCommand }
  | { readonly kind: 'batch'; readonly label: string; readonly commands: readonly EditCommand[] };

/** A read-only summary of one history entry, for a history view. */
export interface HistoryEntrySummary {
  readonly label: string;
}

/** The category of a timeline entry — a history view tints its icon by this. */
export type HistoryEntryKind =
  | 'setField'
  | 'addComponent'
  | 'removeComponent'
  | 'addBundle'
  | 'custom'
  | 'batch';

/**
 * A read-only view of one timeline entry (whether applied or redoable), carrying
 * just enough to present it: a label, a category, and — for entries that target a
 * single component — the entity, component name, edited field, and before/after
 * values a richer view can format into a delta. Grouped (batch) entries expose
 * only their label and `'batch'` kind.
 */
export interface HistoryEntryView {
  readonly label: string;
  readonly kind: HistoryEntryKind;
  /** The edit scope (entity component or asset), for `setField` entries. */
  readonly scope?: EditScope;
  /** The entity the entry targets, for single-command entries (undefined for asset edits). */
  readonly entity?: Entity;
  /** The stable reflection name of the component the entry touched, for single-command entries. */
  readonly componentName?: string;
  /** The edited field — the last path segment (`setField` entries only). */
  readonly field?: string | undefined;
  /** Deep-cloned value before the edit (`setField` entries only). */
  readonly before?: unknown;
  /** Deep-cloned value after the edit (`setField` entries only). */
  readonly after?: unknown;
}

/**
 * The full timeline for a history view: every entry oldest-first (applied past,
 * then the redoable future), with a cursor at the current (live) state.
 */
export interface HistoryView {
  /** All entries, oldest first; entries after {@link currentIndex} are the redoable future. */
  readonly entries: readonly HistoryEntryView[];
  /** Index of the current (live) state — the last applied entry; `-1` when nothing is applied. */
  readonly currentIndex: number;
}

/** Options for a {@link History}. */
export interface HistoryOptions {
  /** Maximum retained undo entries; older entries drop off the bottom. Defaults to 200. */
  readonly capacity?: number;
  /** Called whenever the stack changes (push / undo / redo / clear). */
  readonly onChange?: () => void;
}

interface Pending {
  readonly scope: EditScope;
  readonly path: FieldPath;
  readonly key: string;
  readonly before: unknown;
  lastAfter: unknown;
}

const interactionKey = (scope: EditScope, pathKey: string): string => `${scopeKey(scope)}|${pathKey}`;

const setFieldCommand = (scope: EditScope, path: FieldPath, before: unknown, after: unknown): SetFieldCommand => ({
  kind: 'setField',
  scope,
  path,
  pathKey: pathKeyOf(path),
  before,
  after,
  label: `Set ${scopeLabel(scope)}`,
});

/** The edited leaf as a display string — a field's name or a bracketed index. */
const lastField = (path: FieldPath): string | undefined => {
  const seg = path[path.length - 1];
  if (seg === undefined) return undefined;
  return seg.kind === 'field' ? seg.name : `[${seg.index}]`;
};

/** Project one stack item into the read-only {@link HistoryEntryView} a view consumes. */
const toView = (item: HistoryItem): HistoryEntryView => {
  if (item.kind === 'batch') return { label: item.label, kind: 'batch' };
  const c = item.command;
  if (c.kind === 'setField') {
    const view: HistoryEntryView = {
      label: c.label,
      kind: 'setField',
      scope: c.scope,
      componentName: c.scope.kind === 'entity' ? c.scope.componentName : c.scope.assetKind,
      field: lastField(c.path),
      before: c.before,
      after: c.after,
    };
    return c.scope.kind === 'entity' ? { ...view, entity: c.scope.entity } : view;
  }
  if (c.kind === 'addBundle') return { label: c.label, kind: 'addBundle', entity: c.entity };
  return { label: c.label, kind: c.kind, entity: c.entity, componentName: c.componentName };
};

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
   * The full timeline — applied past then redoable future, oldest first — and the
   * cursor at the current state, for a history panel. Entries after
   * {@link HistoryView.currentIndex} are the redoable tail; jump to any of them
   * with {@link jumpTo}. A pending (mid-drag) edit is not yet an entry and does
   * not appear until the interaction ends.
   */
  view(): HistoryView {
    const entries: HistoryEntryView[] = this.past.map(toView);
    for (let i = this.future.length - 1; i >= 0; i--) entries.push(toView(this.future[i]!));
    return { entries, currentIndex: this.past.length - 1 };
  }

  /**
   * Apply a value live during a continuous interaction. The first changed frame
   * captures the before-value; subsequent frames just update the live value. No
   * history entry is recorded until {@link sync} reports the interaction ended.
   */
  preview(entity: Entity, componentName: string, path: FieldPath, current: unknown, next: unknown): void {
    this.previewScoped(entityScope(entity, componentName), path, current, next);
  }

  /** Report a widget's item edges; commits the coalesced interaction when it ends. */
  sync(entity: Entity, componentName: string, path: FieldPath, edges: ItemEdges): void {
    this.syncScoped(entityScope(entity, componentName), path, edges);
  }

  /** Apply an atomic edit live and record it as one entry immediately. */
  commit(entity: Entity, componentName: string, path: FieldPath, current: unknown, next: unknown): void {
    this.commitScoped(entityScope(entity, componentName), path, current, next);
  }

  /**
   * Scope-generic {@link preview}: apply a value live during a continuous
   * interaction on any edit scope (an entity component or a stored asset). The
   * first changed frame captures the before-value; no history entry is recorded
   * until {@link syncScoped} reports the interaction ended.
   */
  previewScoped(scope: EditScope, path: FieldPath, current: unknown, next: unknown): void {
    const key = interactionKey(scope, pathKeyOf(path));
    if (this.pending !== null && this.pending.key !== key) this.flushPending();
    if (this.pending === null) {
      if (valueEquals(next, current)) return;
      this.pending = { scope, path, key, before: snapshotValue(current), lastAfter: snapshotValue(next) };
    } else {
      this.pending.lastAfter = snapshotValue(next);
    }
    writeScopedLive(this.target, scope, path, next);
  }

  /** Scope-generic {@link sync}: commit the coalesced interaction on this scope when it ends. */
  syncScoped(scope: EditScope, path: FieldPath, edges: ItemEdges): void {
    if (!edges.deactivatedAfterEdit) return;
    if (this.pending === null) return;
    if (this.pending.key !== interactionKey(scope, pathKeyOf(path))) return;
    this.flushPending();
  }

  /** Scope-generic {@link commit}: apply an atomic edit on this scope and record it immediately. */
  commitScoped(scope: EditScope, path: FieldPath, current: unknown, next: unknown): void {
    this.flushPending();
    if (valueEquals(current, next)) return;
    const command = setFieldCommand(scope, path, snapshotValue(current), snapshotValue(next));
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
    if (this.stepBack()) this.onChange();
  }

  /** Redo the most recently undone entry. */
  redo(): void {
    this.flushPending();
    if (this.stepForward()) this.onChange();
  }

  /**
   * Jump the world to the state at `index` in {@link view} — the entry that index
   * addresses becomes current — undoing or redoing as many entries as it takes.
   * Pass `-1` to undo everything. The index is clamped to the timeline, and the
   * whole jump fires {@link HistoryOptions.onChange} at most once.
   */
  jumpTo(index: number): void {
    this.flushPending();
    const target = Math.max(-1, Math.min(index, this.past.length + this.future.length - 1));
    let changed = false;
    while (this.past.length - 1 > target && this.stepBack()) changed = true;
    while (this.past.length - 1 < target && this.stepForward()) changed = true;
    if (changed) this.onChange();
  }

  /** Revert one applied entry (past → future). Returns false when there is none. */
  private stepBack(): boolean {
    const item = this.past.pop();
    if (item === undefined) return false;
    if (item.kind === 'single') revertEdit(item.command, this.target);
    else for (let i = item.commands.length - 1; i >= 0; i--) revertEdit(item.commands[i]!, this.target);
    this.future.push(item);
    return true;
  }

  /** Re-apply one undone entry (future → past). Returns false when there is none. */
  private stepForward(): boolean {
    const item = this.future.pop();
    if (item === undefined) return false;
    if (item.kind === 'single') applyEdit(item.command, this.target);
    else for (const command of item.commands) applyEdit(command, this.target);
    this.past.push(item);
    return true;
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
    this.record(setFieldCommand(pending.scope, pending.path, pending.before, pending.lastAfter));
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
