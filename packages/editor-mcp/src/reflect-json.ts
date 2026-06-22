import type { AssetGuid } from '@retro-engine/assets';
import type { ComponentType, Entity } from '@retro-engine/ecs';
import {
  decodeComponent,
  type DecodeEnv,
  decodeValue,
  encodeComponent,
  type EncodeEnv,
  type FieldType,
  type RegisteredType,
  type TypeRegistry,
} from '@retro-engine/reflect';
import type { AssetServer } from '@retro-engine/engine';

import type { JsonSchema } from '@retro-engine/mcp-protocol';

import type { CommandContext } from './context';

/**
 * Encode env for round-tripping live component values to JSON: entity references
 * serialize as their raw numeric id; asset handles as their GUID. Symmetric with
 * {@link decodeEnvFor}.
 */
export const encodeEnvFor = (registry: TypeRegistry): EncodeEnv => ({
  registry,
  entityId: (entity) => entity as unknown as number,
  handleRef: (_assetType, handle) => handle.guid,
});

/** Decode env mirroring {@link encodeEnvFor}: ids become entities, GUIDs resolve through the AssetServer. */
export const decodeEnvFor = (registry: TypeRegistry, server: AssetServer | undefined): DecodeEnv => ({
  registry,
  entity: (id) => id as unknown as Entity,
  resolveHandle: (_assetType, guid) => {
    if (server === undefined) throw new Error('mcp: no AssetServer available to resolve an asset handle');
    return server.loadByGuid(guid as AssetGuid);
  },
});

/** One component on an entity, with its serialized field data when it round-trips. */
export interface EncodedComponent {
  readonly name: string;
  readonly serializable: boolean;
  readonly data?: Record<string, unknown>;
}

/** Encode every component on an entity: serializable ones with their data, derived ones name-only. */
export const encodeEntityComponents = (ctx: CommandContext, entity: Entity): EncodedComponent[] => {
  const env = encodeEnvFor(ctx.registry);
  const out: EncodedComponent[] = [];
  for (const ctor of ctx.world.componentTypesOf(entity)) {
    const reg = ctx.registry.getByCtor(ctor);
    if (reg === undefined) {
      out.push({ name: ctor.name, serializable: false });
      continue;
    }
    const instance = ctx.world.getComponent(entity, reg.ctor);
    if (instance === undefined) continue;
    out.push({ name: reg.name, serializable: true, data: encodeComponent(reg, instance, env).data });
  }
  return out;
};

/**
 * Build a live component instance from `{ type, data }`, applying defaults for
 * any omitted fields. Throws if the type is not registered.
 */
export const decodeComponentInstance = (
  ctx: CommandContext,
  typeName: string,
  data: Record<string, unknown> | undefined,
): { reg: RegisteredType; instance: object } => {
  const reg = ctx.registry.get(typeName);
  if (reg === undefined) throw new Error(`mcp: unknown component type '${typeName}'`);
  const env = decodeEnvFor(ctx.registry, ctx.assetServer);
  const instance = decodeComponent(reg, { version: reg.version, data: data ?? {} }, env);
  return { reg, instance };
};

/** A JSON-schema-ish description of a reflection field, for `component.types`. */
export const fieldTypeToSchema = (ft: FieldType<unknown>): JsonSchema => {
  switch (ft.kind) {
    case 'number':
      return { type: 'number' };
    case 'string':
      return { type: 'string' };
    case 'boolean':
      return { type: 'boolean' };
    case 'vec2':
    case 'vec3':
    case 'vec4':
    case 'quat':
    case 'color':
    case 'mat4':
      return { type: 'array', items: { type: 'number' }, description: ft.kind };
    case 'enum':
      return ft.enumValues !== undefined ? { enum: ft.enumValues } : { type: 'string' };
    case 'entity':
      return { type: 'integer', description: 'entity id' };
    case 'handle':
      return { type: 'string', description: `asset handle (${ft.assetType ?? 'asset'} GUID)` };
    case 'array':
      return ft.element !== undefined
        ? { type: 'array', items: fieldTypeToSchema(ft.element) }
        : { type: 'array' };
    case 'tuple':
      return { type: 'array', description: 'tuple' };
    case 'struct': {
      const properties: Record<string, JsonSchema> = {};
      if (ft.fields !== undefined) {
        for (const [name, child] of Object.entries(ft.fields)) properties[name] = fieldTypeToSchema(child);
      }
      return { type: 'object', properties };
    }
    case 'type':
      return ft.nestedCtor !== undefined ? { type: 'object', description: ft.nestedCtor.name } : { type: 'object' };
    case 'variant':
      return { type: 'object', description: 'variant' };
    default:
      return {};
  }
};

/** Describe a registered component's fields for `component.types`. */
export interface FieldDescription {
  readonly name: string;
  readonly kind: string;
  readonly optional: boolean;
  readonly nullable: boolean;
  readonly schema: JsonSchema;
}

/** All authored fields of a registered type (skipped fields excluded). */
export const describeFields = (reg: RegisteredType): FieldDescription[] => {
  const out: FieldDescription[] = [];
  for (const [name, ft] of reg.fields) {
    if (ft.isSkipped) continue;
    out.push({ name, kind: ft.kind, optional: ft.isOptional, nullable: ft.isNullable, schema: fieldTypeToSchema(ft) });
  }
  return out;
};

/** Resolve the registered field type for `type.field`, or throw with a clear message. */
export const fieldTypeOf = (ctx: CommandContext, typeName: string, field: string): FieldType<unknown> => {
  const reg = ctx.registry.get(typeName);
  if (reg === undefined) throw new Error(`mcp: unknown component type '${typeName}'`);
  const ft = reg.schema[field];
  if (ft === undefined) throw new Error(`mcp: '${typeName}' has no field '${field}'`);
  return ft;
};

/** Decode a single JSON value into the runtime type a reflection field expects. */
export const decodeFieldValue = (ctx: CommandContext, ft: FieldType<unknown>, json: unknown): unknown =>
  decodeValue(ft, json, decodeEnvFor(ctx.registry, ctx.assetServer));

/** The constructor for a registered component name, or throw. */
export const ctorOf = (ctx: CommandContext, typeName: string): ComponentType<object> => {
  const reg = ctx.registry.get(typeName);
  if (reg === undefined) throw new Error(`mcp: unknown component type '${typeName}'`);
  return reg.ctor;
};
