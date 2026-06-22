import { snapshotComponent } from '@retro-engine/editor-sdk';

import { asRecord, reqEntity, reqString } from '../args';
import { type CommandDef, defineCommand } from '../registry';
import { ctorOf, decodeComponentInstance, decodeFieldValue, describeFields, fieldTypeOf } from '../reflect-json';

/** Components: enumerate registered types and add / remove / set components on entities. */
export const componentCommands: readonly CommandDef[] = [
  defineCommand({
    name: 'component.types',
    title: 'List component types',
    description: 'Every registered (serializable) component type with its version and authored fields.',
    domain: 'component',
    mutating: false,
    inputSchema: { type: 'object', properties: {} },
    handler: (ctx) => ({
      types: [...ctx.registry.components()].map((reg) => ({
        name: reg.name,
        version: reg.version,
        attachable: reg.attachable,
        fields: describeFields(reg),
      })),
    }),
  }),
  defineCommand({
    name: 'component.add',
    title: 'Add component',
    description: 'Attach a component to an entity, with optional field data (defaults fill the rest). Undoable.',
    domain: 'component',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: {
        entity: { type: 'integer' },
        type: { type: 'string', description: 'component reflection name' },
        data: { type: 'object', description: 'optional field values' },
      },
      required: ['entity', 'type'],
    },
    handler: (ctx, args) => {
      const record = asRecord(args);
      const entity = reqEntity(record);
      const type = reqString(record, 'type');
      if (!ctx.world.hasEntity(entity)) throw new Error(`mcp: entity ${String(entity)} does not exist`);
      const ctor = ctorOf(ctx, type);
      if (ctx.world.has(entity, ctor)) throw new Error(`mcp: entity already has '${type}'`);
      const data = record.data;
      const { instance } = decodeComponentInstance(
        ctx,
        type,
        data !== undefined && typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : undefined,
      );
      ctx.history.apply({ kind: 'addComponent', entity, componentName: type, after: instance, label: `Add ${type}` });
      return { entity, type };
    },
  }),
  defineCommand({
    name: 'component.remove',
    title: 'Remove component',
    description: 'Detach a component from an entity. Undo restores it. Undoable.',
    domain: 'component',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: { entity: { type: 'integer' }, type: { type: 'string' } },
      required: ['entity', 'type'],
    },
    handler: (ctx, args) => {
      const record = asRecord(args);
      const entity = reqEntity(record);
      const type = reqString(record, 'type');
      if (!ctx.world.hasEntity(entity)) throw new Error(`mcp: entity ${String(entity)} does not exist`);
      const reg = ctx.registry.get(type);
      if (reg === undefined) throw new Error(`mcp: unknown component type '${type}'`);
      const current = ctx.world.getComponent(entity, reg.ctor);
      if (current === undefined) throw new Error(`mcp: entity does not have '${type}'`);
      ctx.history.apply({
        kind: 'removeComponent',
        entity,
        componentName: type,
        before: snapshotComponent(reg, current),
        label: `Remove ${type}`,
      });
      return { entity, type };
    },
  }),
  defineCommand({
    name: 'component.set',
    title: 'Set component field',
    description:
      'Set one top-level field of a component on an entity. The value is decoded into the field type (vectors are number arrays, entity refs are ids, handles are GUIDs). Undoable.',
    domain: 'component',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: {
        entity: { type: 'integer' },
        type: { type: 'string' },
        field: { type: 'string' },
        value: { description: 'the new field value' },
      },
      required: ['entity', 'type', 'field', 'value'],
    },
    handler: (ctx, args) => {
      const record = asRecord(args);
      const entity = reqEntity(record);
      const type = reqString(record, 'type');
      const field = reqString(record, 'field');
      if (!ctx.world.hasEntity(entity)) throw new Error(`mcp: entity ${String(entity)} does not exist`);
      const reg = ctx.registry.get(type);
      if (reg === undefined) throw new Error(`mcp: unknown component type '${type}'`);
      const instance = ctx.world.getComponent(entity, reg.ctor) as Record<string, unknown> | undefined;
      if (instance === undefined) throw new Error(`mcp: entity does not have '${type}'`);
      const ft = fieldTypeOf(ctx, type, field);
      const next = decodeFieldValue(ctx, ft, record.value);
      ctx.history.commit(entity, type, [{ kind: 'field', name: field }], instance[field], next);
      return { entity, type, field };
    },
  }),
];
