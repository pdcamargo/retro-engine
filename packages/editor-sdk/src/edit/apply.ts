import type { Entity, World } from '@retro-engine/ecs';
import type { TypeRegistry } from '@retro-engine/reflect';

import { snapshotComponent, snapshotValue } from './clone';
import type { EditCommand } from './command';
import { type FieldPath, writePathLeaf } from './field-path';
import type { EditScope } from './scope';

/**
 * The port an {@link EditTarget} uses to read + mutate a stored asset value for
 * an asset-scoped edit. Mutation goes through the host's mutable accessor (e.g.
 * `Assets.getMut`) so the engine's change event fires and every consumer of the
 * asset re-renders; `markDirty` lets the host persist the edited asset.
 */
export interface AssetEditAccess {
  /**
   * The live, mutable asset value for `(assetKind, guid)`, or `undefined` if it
   * is not loaded. Returning it must flag the asset changed (the live-update
   * path), exactly like `Assets.getMut`.
   */
  getMut(assetKind: string, guid: string): object | undefined;
  /** Mark an asset dirty so the host can persist it. Optional — a headless target may not save. */
  markDirty?(assetKind: string, guid: string): void;
}

/** The live world + reflection registry (and, optionally, asset access) an edit applies against. */
export interface EditTarget {
  readonly world: World;
  readonly registry: TypeRegistry;
  /** Asset access for asset-scoped edits. Absent in entity-only / headless targets. */
  readonly assets?: AssetEditAccess;
}

/**
 * Write a value to a nested field of a live component, in place. Silently does
 * nothing if the entity has despawned, the component is unregistered, or the
 * instance is absent — edit application is too fragile to throw on a target that
 * moved on. Writes a fresh clone so live storage never aliases the caller's
 * value, then hints the change so `Changed<T>` queries observe it.
 */
export const writeFieldLive = (
  target: EditTarget,
  entity: Entity,
  componentName: string,
  path: FieldPath,
  value: unknown,
): void => {
  if (!target.world.hasEntity(entity)) return;
  const registered = target.registry.get(componentName);
  if (registered === undefined) return;
  const instance = target.world.getComponent(entity, registered.ctor);
  if (instance === undefined) return;
  writePathLeaf(instance, path, snapshotValue(value));
  target.world.markChanged(entity, registered.ctor);
};

/**
 * Write a value to a nested field of a live asset value, in place, through the
 * target's asset port. Silently does nothing if no asset access is wired or the
 * asset is not loaded — like {@link writeFieldLive}, edit application tolerates a
 * target that moved on. The host's `getMut` flags the change so consumers
 * re-render; `markDirty` lets it persist.
 */
export const writeAssetFieldLive = (
  target: EditTarget,
  assetKind: string,
  guid: string,
  path: FieldPath,
  value: unknown,
): void => {
  const access = target.assets;
  if (access === undefined) return;
  const instance = access.getMut(assetKind, guid);
  if (instance === undefined) return;
  writePathLeaf(instance, path, snapshotValue(value));
  access.markDirty?.(assetKind, guid);
};

/** Write a value to a scoped field — routed to the world (entity) or an asset store. */
export const writeScopedLive = (
  target: EditTarget,
  scope: EditScope,
  path: FieldPath,
  value: unknown,
): void => {
  if (scope.kind === 'entity') writeFieldLive(target, scope.entity, scope.componentName, path, value);
  else writeAssetFieldLive(target, scope.assetKind, scope.guid, path, value);
};

/** Apply an edit to the live world (the "do" / "redo" direction). */
export const applyEdit = (command: EditCommand, target: EditTarget): void => {
  switch (command.kind) {
    case 'setField':
      writeScopedLive(target, command.scope, command.path, command.after);
      return;
    case 'addComponent': {
      if (!target.world.hasEntity(command.entity)) return;
      const registered = target.registry.get(command.componentName);
      if (registered === undefined) return;
      target.world.insertBundle(command.entity, [snapshotComponent(registered, command.after)]);
      return;
    }
    case 'removeComponent': {
      const registered = target.registry.get(command.componentName);
      if (registered === undefined) return;
      target.world.removeComponent(command.entity, registered.ctor);
      return;
    }
    case 'addBundle': {
      if (!target.world.hasEntity(command.entity)) return;
      const instances: object[] = [];
      for (const entry of command.components) {
        const registered = target.registry.get(entry.name);
        if (registered === undefined) continue;
        instances.push(snapshotComponent(registered, entry.instance));
      }
      if (instances.length > 0) target.world.insertBundle(command.entity, instances);
      return;
    }
    case 'custom':
      command.apply(target.world);
  }
};

/** Revert an edit on the live world (the "undo" direction). */
export const revertEdit = (command: EditCommand, target: EditTarget): void => {
  switch (command.kind) {
    case 'setField':
      writeScopedLive(target, command.scope, command.path, command.before);
      return;
    case 'addComponent': {
      const registered = target.registry.get(command.componentName);
      if (registered === undefined) return;
      target.world.removeComponent(command.entity, registered.ctor);
      return;
    }
    case 'removeComponent': {
      if (!target.world.hasEntity(command.entity)) return;
      const registered = target.registry.get(command.componentName);
      if (registered === undefined) return;
      target.world.insertBundle(command.entity, [snapshotComponent(registered, command.before)]);
      return;
    }
    case 'addBundle': {
      for (const entry of command.components) {
        const registered = target.registry.get(entry.name);
        if (registered === undefined) continue;
        target.world.removeComponent(command.entity, registered.ctor);
      }
      return;
    }
    case 'custom':
      command.revert(target.world);
  }
};
