// Hierarchy edit actions, expressed as the editor commands they invoke so a
// context-menu click, a keyboard shortcut, and an AI invocation share one
// implementation (and one undo/audit path) — mirroring `dnd-actions.ts`.
// The helpers fire-and-forget and log failures rather than throwing into an
// ImGui frame; the commands themselves update selection.
import type { Entity } from '@retro-engine/ecs';
import type { MenuEntry } from '@retro-engine/editor-sdk';

import type { RunCommand } from './dnd-actions';
import type { StudioState } from './state';

const warn =
  (what: string) =>
  (err: unknown): void =>
    console.warn(`[studio] ${what} failed`, err);

/** The name a "create empty" draft starts with. */
const DEFAULT_ENTITY_NAME = 'Entity';

/**
 * Hierarchy edit operations that mutate the world (through commands) or flip the
 * transient rename / draft state on {@link StudioState}. Built once per session and
 * shared by the context menus and keyboard shortcuts.
 */
export interface HierarchyActions {
  /** Begin an inline rename of `entity`, seeding the field with its current name. */
  beginRename(entity: Entity, currentName: string): void;
  /** Begin a "create empty" as a child of `parent` (revealing it if collapsed). */
  beginCreateChild(parent: Entity): void;
  /** Begin a "create empty" at the scene root. */
  beginCreateRoot(): void;
  /** Cancel any in-progress rename / draft. */
  cancelEdit(): void;
  /** Commit an inline rename; an empty name is treated as a cancel. */
  commitRename(entity: Entity, name: string): void;
  /** Commit the pending "create empty" draft; an empty name is treated as a cancel. */
  commitCreate(name: string): void;
  /** Duplicate `entity` and its subtree; the copy is selected. */
  duplicate(entity: Entity): void;
  /** Delete `entity` and its whole subtree. */
  deleteEntity(entity: Entity): void;
}

/** Build the hierarchy actions around the shared editor state and command runner. */
export const createHierarchyActions = (state: StudioState, run: RunCommand): HierarchyActions => ({
  beginRename: (entity, currentName) => {
    state.renamingEntity = entity;
    state.entityDraft = null;
    state.entityEditBuffer = currentName;
    state.entityEditFocus = true;
  },
  beginCreateChild: (parent) => {
    state.entityDraft = { parent };
    state.renamingEntity = null;
    state.entityEditBuffer = DEFAULT_ENTITY_NAME;
    state.entityEditFocus = true;
    state.collapsed.delete(parent);
  },
  beginCreateRoot: () => {
    state.entityDraft = { parent: null };
    state.renamingEntity = null;
    state.entityEditBuffer = DEFAULT_ENTITY_NAME;
    state.entityEditFocus = true;
  },
  cancelEdit: () => {
    state.renamingEntity = null;
    state.entityDraft = null;
  },
  commitRename: (entity, name) => {
    state.renamingEntity = null;
    const trimmed = name.trim();
    if (trimmed.length > 0) void run('entity.rename', { entity, name: trimmed }).catch(warn('rename entity'));
  },
  commitCreate: (name) => {
    const draft = state.entityDraft;
    state.entityDraft = null;
    if (draft === null) return;
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    void run('entity.spawn', {
      name: trimmed,
      components: [{ type: 'Transform' }],
      ...(draft.parent !== null ? { parent: draft.parent } : {}),
    }).catch(warn('create entity'));
  },
  duplicate: (entity) => void run('entity.duplicate', { entity }).catch(warn('duplicate entity')),
  deleteEntity: (entity) => void run('entity.despawnRecursive', { entity }).catch(warn('delete entity')),
});

/** The context menu for a hierarchy row (right-clicking an entity). */
export const hierarchyRowMenu = (
  actions: HierarchyActions,
  entity: Entity,
  name: string,
): readonly MenuEntry[] => [
  { label: 'Rename', icon: 'pencil', shortcut: 'F2', onClick: () => actions.beginRename(entity, name) },
  { label: 'Duplicate', icon: 'copy', shortcut: 'Ctrl+D', onClick: () => actions.duplicate(entity) },
  { label: 'Create Empty Child', icon: 'plus', onClick: () => actions.beginCreateChild(entity) },
  { separator: true },
  { label: 'Delete', icon: 'trash-2', shortcut: 'Del', danger: true, onClick: () => actions.deleteEntity(entity) },
];

/** The empty-space context menu for the hierarchy panel (create at the scene root). */
export const hierarchyRootMenu = (actions: HierarchyActions): readonly MenuEntry[] => [
  { label: 'Create Empty', icon: 'plus', onClick: () => actions.beginCreateRoot() },
];
