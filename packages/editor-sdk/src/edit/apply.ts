import type { Entity, World } from '@retro-engine/ecs';
import type { TypeRegistry } from '@retro-engine/reflect';

import { snapshotComponent, snapshotValue } from './clone';
import type { EditCommand } from './command';
import { type FieldPath, writePathLeaf } from './field-path';

/** The live world + reflection registry an edit applies against. */
export interface EditTarget {
  readonly world: World;
  readonly registry: TypeRegistry;
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

/** Apply an edit to the live world (the "do" / "redo" direction). */
export const applyEdit = (command: EditCommand, target: EditTarget): void => {
  switch (command.kind) {
    case 'setField':
      writeFieldLive(target, command.entity, command.componentName, command.path, command.after);
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
    case 'custom':
      command.apply(target.world);
  }
};

/** Revert an edit on the live world (the "undo" direction). */
export const revertEdit = (command: EditCommand, target: EditTarget): void => {
  switch (command.kind) {
    case 'setField':
      writeFieldLive(target, command.entity, command.componentName, command.path, command.before);
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
    case 'custom':
      command.revert(target.world);
  }
};
