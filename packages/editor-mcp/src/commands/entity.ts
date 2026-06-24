import { type CustomCommand, snapshotComponent } from '@retro-engine/editor-sdk';
import { CompositionRegistry, Name } from '@retro-engine/engine';

import { asRecord, optString, reqEntity } from '../args';
import { type CommandDef, defineCommand } from '../registry';
import { decodeComponentInstance, encodeEntityComponents } from '../reflect-json';

interface ComponentSpec {
  readonly type: string;
  readonly data?: Record<string, unknown>;
}

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

/** Entity lifecycle: spawn, despawn, rename, and read. All writes are undoable. */
export const entityCommands: readonly CommandDef[] = [
  defineCommand({
    name: 'entity.spawn',
    title: 'Spawn entity',
    description:
      'Spawn a new entity with an optional name and components ([{ type, data? }]). The new entity is selected. Undoable.',
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
      },
    },
    handler: (ctx, args) => {
      const record = asRecord(args);
      const name = optString(record, 'name');
      const built = parseComponentSpecs(record.components).map((spec) =>
        decodeComponentInstance(ctx, spec.type, spec.data),
      );
      const hasName = built.some((b) => b.reg.name === 'Name');
      const id = ctx.world.reserveEntity();
      const cmd: CustomCommand = {
        kind: 'custom',
        entity: id,
        componentName: '',
        label: `Spawn ${name !== undefined && name.length > 0 ? name : 'Entity'}`,
        apply: (world) => {
          const instances = built.map((b) => snapshotComponent(b.reg, b.instance));
          if (name !== undefined && name.length > 0 && !hasName) instances.push(new Name(name));
          world.spawnReserved(id, instances);
        },
        revert: (world) => {
          if (world.hasEntity(id)) world.despawn(id);
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
