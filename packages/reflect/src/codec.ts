import type { Entity } from '@retro-engine/ecs';
import type { Handle } from '@retro-engine/assets';
import type { Color } from '@retro-engine/math';

import type { FieldType } from './field-type';
import type { RegisteredType, TypeRegistry } from './type-registry';

/**
 * Context the codec needs to serialize references. Generic kinds (numbers,
 * vectors, structs…) need none of this; `entity` and `handle` delegate here so
 * the remap/resolve logic stays where the `World` and `Assets` stores live.
 */
export interface EncodeEnv {
  /** Registry used to resolve nested `t.type` fields. */
  readonly registry: TypeRegistry;
  /** Map a live entity to its stable id within the output. */
  entityId(entity: Entity): number;
  /** Persistent reference for an asset handle, or `undefined` to omit it (e.g. no GUID). */
  handleRef(assetType: string, handle: Handle<unknown>): string | undefined;
}

/** Context the codec needs to reconstruct references on load. */
export interface DecodeEnv {
  /** Registry used to resolve nested `t.type` fields. */
  readonly registry: TypeRegistry;
  /** Resolve a stable id back to a freshly-spawned entity. */
  entity(serializedId: number): Entity;
  /** Reconstruct an asset handle from its persistent reference. */
  resolveHandle(assetType: string, guid: string): Handle<unknown>;
}

/** A serialized value or component: its stable type name, schema version, and field data. */
export interface SerializedValue {
  readonly type: string;
  readonly version: number;
  readonly data: Record<string, unknown>;
}

const assertNever = (value: never): never => {
  throw new Error(`reflect: unhandled field kind '${String(value)}'`);
};

const encodeFields = (
  schema: Readonly<Record<string, FieldType<unknown>>>,
  obj: Record<string, unknown>,
  env: EncodeEnv,
): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [key, ft] of Object.entries(schema)) {
    if (ft.isSkipped) continue;
    const value = obj[key];
    if (value === undefined) continue;
    const encoded = encodeValue(ft, value, env);
    if (encoded === undefined) continue;
    out[key] = encoded;
  }
  return out;
};

const applyFields = (
  schema: Readonly<Record<string, FieldType<unknown>>>,
  instance: Record<string, unknown>,
  data: Record<string, unknown>,
  env: DecodeEnv,
): void => {
  for (const [key, ft] of Object.entries(schema)) {
    if (ft.isSkipped) continue;
    const raw = data[key];
    if (raw === undefined) {
      if (ft.defaultFactory !== undefined) instance[key] = ft.defaultFactory();
      continue;
    }
    instance[key] = decodeValue(ft, raw, env);
  }
};

const migrateData = (
  reg: RegisteredType,
  fromVersion: number,
  data: Record<string, unknown>,
): Record<string, unknown> => {
  if (fromVersion > reg.version) {
    throw new Error(
      `reflect: '${reg.name}' data is version ${fromVersion}, newer than the registered version ${reg.version}`,
    );
  }
  if (fromVersion === reg.version || reg.migrations.length === 0) return data;
  const ordered = [...reg.migrations].sort((a, b) => a.to - b.to);
  let current = data;
  let version = fromVersion;
  for (const migration of ordered) {
    if (migration.to > version && migration.to <= reg.version) {
      current = migration.migrate(current);
      version = migration.to;
    }
  }
  return current;
};

/**
 * Encode a single value against its field type into a JSON-ready form. Returns
 * `undefined` for values that should be omitted (an unset optional, a handle
 * with no persistent identity).
 */
export const encodeValue = (ft: FieldType<unknown>, value: unknown, env: EncodeEnv): unknown => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  switch (ft.kind) {
    case 'number':
    case 'string':
    case 'boolean':
    case 'enum':
      return value;
    case 'vec2':
    case 'vec3':
    case 'vec4':
    case 'quat':
    case 'mat4':
      return Array.from(value as Float32Array);
    case 'color': {
      const c = value as Color;
      return { r: c.r, g: c.g, b: c.b, a: c.a };
    }
    case 'array': {
      const element = ft.element;
      if (element === undefined) throw new Error("reflect: 'array' field is missing its element type");
      return (value as unknown[]).map((item) => encodeValue(element, item, env));
    }
    case 'tuple': {
      const elements = ft.elements;
      if (elements === undefined) throw new Error("reflect: 'tuple' field is missing its element types");
      return (value as unknown[]).map((item, i) => {
        const el = elements[i];
        if (el === undefined) {
          throw new Error(`reflect: tuple value has more elements than its schema (${elements.length})`);
        }
        return encodeValue(el, item, env);
      });
    }
    case 'struct': {
      const fields = ft.fields;
      if (fields === undefined) throw new Error("reflect: 'struct' field is missing its fields");
      return encodeFields(fields, value as Record<string, unknown>, env);
    }
    case 'entity':
      return env.entityId(value as Entity);
    case 'handle': {
      const assetType = ft.assetType;
      if (assetType === undefined) throw new Error("reflect: 'handle' field is missing its asset type");
      return env.handleRef(assetType, value as Handle<unknown>);
    }
    case 'type': {
      const ctor = ft.nestedCtor;
      if (ctor === undefined) throw new Error("reflect: 'type' field is missing its constructor");
      const reg = env.registry.getByCtor(ctor);
      if (reg === undefined) {
        throw new Error(`reflect: nested type ${ctor.name || '<anonymous>'} is not registered`);
      }
      return encodeComponent(reg, value as object, env);
    }
    default:
      return assertNever(ft.kind);
  }
};

/** Decode a single JSON value against its field type back into a runtime value. */
export const decodeValue = (ft: FieldType<unknown>, json: unknown, env: DecodeEnv): unknown => {
  if (json === null) return null;
  if (json === undefined) return undefined;
  switch (ft.kind) {
    case 'number':
    case 'string':
    case 'boolean':
    case 'enum':
      return json;
    case 'vec2':
    case 'vec3':
    case 'vec4':
    case 'quat':
    case 'mat4':
      return new Float32Array(json as number[]);
    case 'color': {
      const c = json as Color;
      return { r: c.r, g: c.g, b: c.b, a: c.a };
    }
    case 'array': {
      const element = ft.element;
      if (element === undefined) throw new Error("reflect: 'array' field is missing its element type");
      return (json as unknown[]).map((item) => decodeValue(element, item, env));
    }
    case 'tuple': {
      const elements = ft.elements;
      if (elements === undefined) throw new Error("reflect: 'tuple' field is missing its element types");
      return (json as unknown[]).map((item, i) => {
        const el = elements[i];
        if (el === undefined) {
          throw new Error(`reflect: tuple data has more elements than its schema (${elements.length})`);
        }
        return decodeValue(el, item, env);
      });
    }
    case 'struct': {
      const fields = ft.fields;
      if (fields === undefined) throw new Error("reflect: 'struct' field is missing its fields");
      const out: Record<string, unknown> = {};
      applyFields(fields, out, json as Record<string, unknown>, env);
      return out;
    }
    case 'entity':
      return env.entity(json as number);
    case 'handle': {
      const assetType = ft.assetType;
      if (assetType === undefined) throw new Error("reflect: 'handle' field is missing its asset type");
      return env.resolveHandle(assetType, json as string);
    }
    case 'type': {
      const ctor = ft.nestedCtor;
      if (ctor === undefined) throw new Error("reflect: 'type' field is missing its constructor");
      const reg = env.registry.getByCtor(ctor);
      if (reg === undefined) {
        throw new Error(`reflect: nested type ${ctor.name || '<anonymous>'} is not registered`);
      }
      return decodeComponent(reg, json as { version: number; data: Record<string, unknown> }, env);
    }
    default:
      return assertNever(ft.kind);
  }
};

/** Encode a component (or nested registered value) into a {@link SerializedValue}. */
export const encodeComponent = (reg: RegisteredType, instance: object, env: EncodeEnv): SerializedValue => ({
  type: reg.name,
  version: reg.version,
  data: encodeFields(reg.schema, instance as Record<string, unknown>, env),
});

/**
 * Decode a {@link SerializedValue} back onto a fresh instance of its registered
 * type, running any version migrations first. Fields absent from the data keep
 * the constructor's default (or the field's `.default()`), so skip-serialized
 * and newly-added fields survive an old file.
 */
export const decodeComponent = (
  reg: RegisteredType,
  serialized: { readonly version: number; readonly data: Record<string, unknown> },
  env: DecodeEnv,
): object => {
  const data = migrateData(reg, serialized.version, serialized.data);
  const instance = reg.make();
  applyFields(reg.schema, instance as Record<string, unknown>, data, env);
  return instance;
};
