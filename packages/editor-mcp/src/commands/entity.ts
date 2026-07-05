import type { Entity, World } from '@retro-engine/ecs';
import { type CustomCommand, snapshotComponent } from '@retro-engine/editor-sdk';
import { Children, CompositionRegistry, Name, Parent, type SceneData, serializePrefab, spawnScene } from '@retro-engine/engine';

import { asRecord, optString, reqEntity } from '../args';
import { type CommandContext } from '../context';
import { type CommandDef, defineCommand } from '../registry';
import { decodeComponentInstance, encodeEntityComponents } from '../reflect-json';
import { despawnSubtree } from './prefab';

interface ComponentSpec {
  readonly type: string;
  readonly data?: Record<string, unknown>;
}

/** Append `child` to `parent`'s {@link Children} list, creating it if absent (no duplicate). */
const linkChild = (world: World, parent: Entity, child: Entity): void => {
  const existing = world.getComponent(parent, Children) as { entities: Entity[] } | undefined;
  if (existing === undefined) {
    world.insertBundle(parent, [new Children([child])]);
  } else if (!existing.entities.includes(child)) {
    existing.entities.push(child);
  }
};

/** Remove `child` from `parent`'s {@link Children} list if present. */
const unlinkChild = (world: World, parent: Entity, child: Entity): void => {
  const existing = world.getComponent(parent, Children) as { entities: Entity[] } | undefined;
  if (existing === undefined) return;
  const i = existing.entities.indexOf(child);
  if (i >= 0) existing.entities.splice(i, 1);
};

/** The parent entity of `entity` via its `Parent` edge, or null for a root. */
const parentOf = (world: World, entity: Entity): Entity | null => {
  const p = world.getComponent(entity, Parent) as { entity: Entity } | undefined;
  return p !== undefined ? p.entity : null;
};

/** Every entity in the subtree rooted at `entity` (root first), walking `Children`. */
const collectSubtreeIds = (world: World, root: Entity): Entity[] => {
  const out: Entity[] = [];
  const seen = new Set<Entity>();
  const stack: Entity[] = [root];
  while (stack.length > 0) {
    const e = stack.pop()!;
    if (seen.has(e) || !world.hasEntity(e)) continue;
    seen.add(e);
    out.push(e);
    const c = world.getComponent(e, Children) as { entities: Entity[] } | undefined;
    if (c !== undefined) for (const child of c.entities) if (world.hasEntity(child)) stack.push(child);
  }
  return out;
};

/**
 * The first free `"<base> (n)"` name (n ≥ 1) among the children of `parent`,
 * used to name a duplicate. `base` has any trailing `" (n)"` stripped so a copy
 * of `"Rock (2)"` becomes `"Rock (1)"`, not `"Rock (2) (1)"`.
 */
const nextDuplicateName = (ctx: CommandContext, parent: Entity | null, sourceName: string): string => {
  const base = sourceName.replace(/ \(\d+\)$/, '').trim() || 'Entity';
  const nameReg = ctx.registry.get('Name');
  const taken = new Set<string>();
  for (const e of ctx.world.entities()) {
    if (parentOf(ctx.world, e) !== parent) continue;
    const n = nameReg !== undefined ? (ctx.world.getComponent(e, nameReg.ctor) as { value?: string } | undefined) : undefined;
    if (n?.value !== undefined) taken.add(n.value);
  }
  let n = 1;
  while (taken.has(`${base} (${n})`)) n += 1;
  return `${base} (${n})`;
};

/** Read an entity's `Name` value (empty string if it has none). */
const nameOf = (ctx: CommandContext, entity: Entity): string => {
  const nameReg = ctx.registry.get('Name');
  if (nameReg === undefined) return '';
  return (ctx.world.getComponent(entity, nameReg.ctor) as { value?: string } | undefined)?.value ?? '';
};

const parseComponentSpecs = (value: unknown): ComponentSpec[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("mcp: 'components' must be an array of { type, data }");
  return value.map((raw) => {
    const rec = asRecord(raw);
    const type = rec.type;
    if (typeof type !== 'string') throw new Error("mcp: each component needs a string 'type'");
    const data = rec.data;
    if (data !== undefined && (typeof data !== 'object' || data === null)) {
      throw new Error(`mcp: component '${type}' data must be an object`);
    }
    return data !== undefined ? { type, data: data as Record<string, unknown> } : { type };
  });
};

/** Entity lifecycle: spawn, despawn (single + recursive), duplicate, rename, and read. All writes are undoable. */
export const entityCommands: readonly CommandDef[] = [
  defineCommand({
    name: 'entity.spawn',
    title: 'Spawn entity',
    description:
      'Spawn a new entity with an optional name, components ([{ type, data? }]), and parent entity. The new entity is selected. Undoable.',
    domain: 'entity',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'optional Name component value' },
        components: {
          type: 'array',
          description: 'components to attach',
          items: {
            type: 'object',
            properties: { type: { type: 'string' }, data: { type: 'object' } },
            required: ['type'],
          },
        },
        parent: { type: 'integer', description: 'optional parent entity (omit for a scene root)' },
      },
    },
    handler: (ctx, args) => {
      const record = asRecord(args);
      const name = optString(record, 'name');
      const built = parseComponentSpecs(record.components).map((spec) =>
        decodeComponentInstance(ctx, spec.type, spec.data),
      );
      const hasName = built.some((b) => b.reg.name === 'Name');
      const parent: Entity | null = record.parent === undefined || record.parent === null ? null : reqEntity(record, 'parent');
      if (parent !== null && !ctx.world.hasEntity(parent)) {
        throw new Error(`mcp: parent ${String(parent)} does not exist`);
      }
      const id = ctx.world.reserveEntity();
      const cmd: CustomCommand = {
        kind: 'custom',
        entity: id,
        componentName: '',
        label: `Spawn ${name !== undefined && name.length > 0 ? name : 'Entity'}`,
        apply: (world) => {
          const instances = built.map((b) => snapshotComponent(b.reg, b.instance));
          if (name !== undefined && name.length > 0 && !hasName) instances.push(new Name(name));
          if (parent !== null) instances.push(new Parent(parent));
          world.spawnReserved(id, instances);
          if (parent !== null) linkChild(world, parent, id);
        },
        revert: (world) => {
          if (!world.hasEntity(id)) return;
          if (parent !== null && world.hasEntity(parent)) unlinkChild(world, parent, id);
          world.despawn(id);
        },
      };
      ctx.history.apply(cmd);
      ctx.state.selectedEntity = id;
      return { entity: id };
    },
  }),
  defineCommand({
    name: 'entity.despawn',
    title: 'Despawn entity',
    description:
      'Remove an entity from the scene. Undo restores the entity and its own components (descendants are not restored). Undoable.',
    domain: 'entity',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: { entity: { type: 'integer' } },
      required: ['entity'],
    },
    handler: (ctx, args) => {
      const entity = reqEntity(asRecord(args));
      if (!ctx.world.hasEntity(entity)) throw new Error(`mcp: entity ${String(entity)} does not exist`);
      const snapshot = encodeEntityComponents(ctx, entity).filter((c) => c.serializable);
      const cmd: CustomCommand = {
        kind: 'custom',
        entity,
        componentName: '',
        label: 'Despawn entity',
        apply: (world) => {
          if (world.hasEntity(entity)) world.despawn(entity);
        },
        revert: (world) => {
          if (world.hasEntity(entity)) return;
          const instances = snapshot.map((c) => decodeComponentInstance(ctx, c.name, c.data).instance);
          world.spawnReserved(entity, instances);
        },
      };
      ctx.history.apply(cmd);
      if (ctx.state.selectedEntity === entity) ctx.state.selectedEntity = null;
      return { entity, despawned: true };
    },
  }),
  defineCommand({
    name: 'entity.despawnRecursive',
    title: 'Delete entity subtree',
    description:
      'Remove an entity and its whole subtree (all descendants) from the scene. Undo restores the subtree with its original entity ids. Undoable.',
    domain: 'entity',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: { entity: { type: 'integer' } },
      required: ['entity'],
    },
    handler: (ctx, args) => {
      const root = reqEntity(asRecord(args));
      if (!ctx.world.hasEntity(root)) throw new Error(`mcp: entity ${String(root)} does not exist`);
      const ids = collectSubtreeIds(ctx.world, root);
      const idSet = new Set(ids);
      // Snapshot each node's serializable components (Parent included; the derived
      // Children list is not serialized and is rebuilt from Parent edges on undo).
      const snapshots = ids.map((id) => ({
        id,
        components: encodeEntityComponents(ctx, id).filter((c) => c.serializable),
      }));
      const rootParent = parentOf(ctx.world, root);
      const cmd: CustomCommand = {
        kind: 'custom',
        entity: root,
        componentName: '',
        label: 'Delete entity',
        apply: (world) => {
          if (rootParent !== null && world.hasEntity(rootParent)) unlinkChild(world, rootParent, root);
          despawnSubtree(world, root);
        },
        revert: (world) => {
          for (const snap of snapshots) {
            if (world.hasEntity(snap.id)) continue;
            const instances = snap.components.map((c) => decodeComponentInstance(ctx, c.name, c.data).instance);
            world.spawnReserved(snap.id, instances);
          }
          // Every node is live again: rebuild the reciprocal Children edges from the
          // restored Parent components (raw spawnReserved does not fire the sugar).
          for (const snap of snapshots) {
            const parent = parentOf(world, snap.id);
            if (parent !== null && world.hasEntity(parent)) linkChild(world, parent, snap.id);
          }
        },
      };
      ctx.history.apply(cmd);
      const sel = ctx.state.selectedEntity;
      if (sel !== null && idSet.has(sel)) ctx.state.selectedEntity = null;
      return { entity: root, despawned: ids.length };
    },
  }),
  defineCommand({
    name: 'entity.duplicate',
    title: 'Duplicate entity',
    description:
      "Deep-copy an entity and its whole subtree, placing the copy under the same parent with a deduped '<name> (n)' name. The copy is selected. Undoable.",
    domain: 'entity',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: { entity: { type: 'integer' } },
      required: ['entity'],
    },
    handler: (ctx, args) => {
      const source = reqEntity(asRecord(args));
      if (!ctx.world.hasEntity(source)) throw new Error(`mcp: entity ${String(source)} does not exist`);
      // Capture the subtree once (serializePrefab drops the root's Parent, so the
      // copy is self-contained and mounts wherever we reparent it).
      const data: SceneData = serializePrefab(ctx.app, source);
      const sourceParent = parentOf(ctx.world, source);
      const dupName = nextDuplicateName(ctx, sourceParent, nameOf(ctx, source));
      const nameReg = ctx.registry.get('Name');
      let root: Entity | null = null;
      const cmd: CustomCommand = {
        kind: 'custom',
        entity: source,
        componentName: '',
        label: 'Duplicate entity',
        apply: (world) => {
          const map = spawnScene(ctx.app, data);
          // The one spawned entity with no Parent is the copy's root.
          let newRoot: Entity | undefined;
          for (const e of map.values()) {
            if (world.getComponent(e, Parent) === undefined) {
              newRoot = e;
              break;
            }
          }
          if (newRoot === undefined) throw new Error('mcp: duplicate produced no root entity');
          root = newRoot;
          if (sourceParent !== null && world.hasEntity(sourceParent)) {
            world.insertBundle(newRoot, [new Parent(sourceParent)]);
            world.markChanged(newRoot, Parent);
            linkChild(world, sourceParent, newRoot);
          }
          if (nameReg !== undefined) {
            const existing = world.getComponent(newRoot, nameReg.ctor) as { value: string } | undefined;
            if (existing !== undefined) existing.value = dupName;
            else world.insertBundle(newRoot, [new Name(dupName)]);
          }
          ctx.state.selectedEntity = newRoot;
        },
        revert: (world) => {
          if (root === null) return;
          if (sourceParent !== null && world.hasEntity(sourceParent)) unlinkChild(world, sourceParent, root);
          despawnSubtree(world, root);
          if (ctx.state.selectedEntity === root) ctx.state.selectedEntity = source;
          root = null;
        },
      };
      ctx.history.apply(cmd);
      return { entity: root, source, name: dupName };
    },
  }),
  defineCommand({
    name: 'entity.rename',
    title: 'Rename entity',
    description: "Set an entity's Name (adding the Name component if absent). Undoable.",
    domain: 'entity',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: { entity: { type: 'integer' }, name: { type: 'string' } },
      required: ['entity', 'name'],
    },
    handler: (ctx, args) => {
      const record = asRecord(args);
      const entity = reqEntity(record);
      const name = record.name;
      if (typeof name !== 'string') throw new Error("mcp: 'name' must be a string");
      if (!ctx.world.hasEntity(entity)) throw new Error(`mcp: entity ${String(entity)} does not exist`);
      const reg = ctx.registry.get('Name');
      if (reg === undefined) throw new Error('mcp: the Name component is not registered');
      const existing = ctx.world.getComponent(entity, reg.ctor) as { value: string } | undefined;
      if (existing !== undefined) {
        ctx.history.commit(entity, 'Name', [{ kind: 'field', name: 'value' }], existing.value, name);
      } else {
        ctx.history.apply({ kind: 'addComponent', entity, componentName: 'Name', after: new Name(name), label: 'Add Name' });
      }
      return { entity, name };
    },
  }),
  defineCommand({
    name: 'entity.get',
    title: 'Get entity',
    description: "An entity's name and every component with its serialized field values.",
    domain: 'entity',
    mutating: false,
    inputSchema: {
      type: 'object',
      properties: { entity: { type: 'integer' } },
      required: ['entity'],
    },
    handler: (ctx, args) => {
      const entity = reqEntity(asRecord(args));
      if (!ctx.world.hasEntity(entity)) throw new Error(`mcp: entity ${String(entity)} does not exist`);
      const reg = ctx.registry.get('Name');
      const nameInst = reg !== undefined ? (ctx.world.getComponent(entity, reg.ctor) as { value: string } | undefined) : undefined;
      return {
        entity,
        name: nameInst?.value ?? null,
        components: encodeEntityComponents(ctx, entity),
      };
    },
  }),
  defineCommand({
    name: 'entity.anchor',
    title: 'Get composition anchor',
    description:
      'The stable composition anchor of an entity that lives inside a derived subtree — e.g. a glTF node, returning { mount, kind, anchor: { node, path } } — or null if the entity is not inside one. This is what an attachment parented under the entity records to survive a save/reload.',
    domain: 'entity',
    mutating: false,
    inputSchema: {
      type: 'object',
      properties: { entity: { type: 'integer' } },
      required: ['entity'],
    },
    handler: (ctx, args) => {
      const entity = reqEntity(asRecord(args));
      if (!ctx.world.hasEntity(entity)) throw new Error(`mcp: entity ${String(entity)} does not exist`);
      const composition = ctx.app.getResource(CompositionRegistry);
      if (composition !== undefined) {
        for (const provider of composition.providers) {
          const anchor = provider.anchorFor(ctx.world, entity);
          if (anchor !== undefined) {
            return { entity, mount: anchor.mount, kind: anchor.kind, anchor: anchor.anchor };
          }
        }
      }
      return { entity, mount: null, kind: null, anchor: null };
    },
  }),
];
