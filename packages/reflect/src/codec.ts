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
    case 'variant': {
      const { variantTag: tag, variants } = ft;
      if (tag === undefined || variants === undefined) {
        throw new Error("reflect: 'variant' field is missing its tag or arms");
      }
      if (typeof value === 'string') return value;
      const obj = value as Record<string, unknown>;
      const disc = obj[tag];
      if (typeof disc === 'string') {
        const arm = variants[disc];
        // A discriminant naming no schema arm carries runtime-only data; omit it so
        // the field falls back to its constructed default on load.
        if (arm === undefined) return undefined;
        return { [tag]: disc, ...encodeFields(arm, obj, env) };
      }
      if (ft.variantStringArms) {
        const untagged = untaggedArm(variants);
        if (untagged !== undefined) return encodeFields(untagged, obj, env);
      }
      throw new Error(`reflect: 'variant' value is missing its '${tag}' discriminant`);
    }
    default:
      return assertNever(ft.kind);
  }
};

/** The lone arm carrying a payload — the untagged object form used by string-or-struct variants. */
const untaggedArm = (
  variants: Readonly<Record<string, Readonly<Record<string, FieldType<unknown>>>>>,
): Readonly<Record<string, FieldType<unknown>>> | undefined => {
  for (const schema of Object.values(variants)) {
    if (Object.keys(schema).length > 0) return schema;
  }
  return undefined;
};

/** Decode a single JSON value against its field type back into a runtime value. */
export const decodeValue = (ft: FieldType<unknown>, json: unknown, env: DecodeEnv): unknown => {
  if (json === null) return null;
  if (json === undefined) return undefined;
  switch (ft.kind) {
    case 'number': {
      // Coerce a numeric string (an editor/MCP field-set may pass "0.15"), and
      // reject anything non-numeric here — so a bad value fails fast at decode
      // rather than poisoning a downstream consumer (e.g. a GPU uniform packer).
      if (typeof json === 'number') return json;
      const n = typeof json === 'string' && json.trim() !== '' ? Number(json) : NaN;
      if (Number.isFinite(n)) return n;
      throw new Error(`reflect: expected a number for a 'number' field, got ${typeof json}`);
    }
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
    case 'variant': {
      const { variantTag: tag, variants } = ft;
      if (tag === undefined || variants === undefined) {
        throw new Error("reflect: 'variant' field is missing its tag or arms");
      }
      if (typeof json === 'string') return json;
      const data = json as Record<string, unknown>;
      const disc = data[tag];
      if (typeof disc === 'string') {
        const arm = variants[disc];
        if (arm === undefined) return undefined;
        const out: Record<string, unknown> = { [tag]: disc };
        applyFields(arm, out, data, env);
        return out;
      }
      if (ft.variantStringArms) {
        const untagged = untaggedArm(variants);
        if (untagged !== undefined) {
          const out: Record<string, unknown> = {};
          applyFields(untagged, out, data, env);
          return out;
        }
      }
      throw new Error(`reflect: 'variant' data is missing its '${tag}' discriminant`);
    }
    default:
      return assertNever(ft.kind);
  }
};

/** A reference to an asset by its store name and persistent GUID, as found in serialized data. */
export interface HandleRef {
  /** The asset store the handle targets (e.g. `'Image'`, `'Mesh'`). */
  readonly assetType: string;
  /** The referenced asset's persistent GUID. */
  readonly guid: string;
}

/**
 * Enumerate every asset reference reachable in `json` under `ft`, appending each
 * to `out` — without decoding. Mirrors {@link decodeValue}'s structural recursion
 * but emits a {@link HandleRef} for each `handle` field instead of resolving it,
 * so a scene's dependencies can be discovered before any resolver exists.
 */
const collectValueRefs = (
  ft: FieldType<unknown>,
  json: unknown,
  registry: TypeRegistry,
  out: HandleRef[],
): void => {
  if (json === null || json === undefined) return;
  switch (ft.kind) {
    case 'number':
    case 'string':
    case 'boolean':
    case 'enum':
    case 'vec2':
    case 'vec3':
    case 'vec4':
    case 'quat':
    case 'mat4':
    case 'color':
    case 'entity':
      return;
    case 'array': {
      const element = ft.element;
      if (element === undefined) throw new Error("reflect: 'array' field is missing its element type");
      for (const item of json as unknown[]) collectValueRefs(element, item, registry, out);
      return;
    }
    case 'tuple': {
      const elements = ft.elements;
      if (elements === undefined) throw new Error("reflect: 'tuple' field is missing its element types");
      (json as unknown[]).forEach((item, i) => {
        const el = elements[i];
        if (el !== undefined) collectValueRefs(el, item, registry, out);
      });
      return;
    }
    case 'struct': {
      const fields = ft.fields;
      if (fields === undefined) throw new Error("reflect: 'struct' field is missing its fields");
      collectHandleRefs(fields, json as Record<string, unknown>, registry, out);
      return;
    }
    case 'handle': {
      const assetType = ft.assetType;
      if (assetType === undefined) throw new Error("reflect: 'handle' field is missing its asset type");
      // The encoder writes the GUID string for a handle with identity, and omits it
      // otherwise — so a string here is exactly a resolvable reference.
      if (typeof json === 'string') out.push({ assetType, guid: json });
      return;
    }
    case 'type': {
      const ctor = ft.nestedCtor;
      if (ctor === undefined) throw new Error("reflect: 'type' field is missing its constructor");
      const reg = registry.getByCtor(ctor);
      // An unregistered nested type contributes no refs (and can't, with no schema).
      if (reg === undefined) return;
      const nested = json as { data?: Record<string, unknown> };
      if (nested.data !== undefined) collectHandleRefs(reg.schema, nested.data, registry, out);
      return;
    }
    case 'variant': {
      const { variantTag: tag, variants } = ft;
      if (tag === undefined || variants === undefined) {
        throw new Error("reflect: 'variant' field is missing its tag or arms");
      }
      if (typeof json === 'string') return; // a payload-less arm carries no refs
      const data = json as Record<string, unknown>;
      const disc = data[tag];
      if (typeof disc === 'string') {
        const arm = variants[disc];
        if (arm !== undefined) collectHandleRefs(arm, data, registry, out);
        return;
      }
      if (ft.variantStringArms) {
        const untagged = untaggedArm(variants);
        if (untagged !== undefined) collectHandleRefs(untagged, data, registry, out);
      }
      return;
    }
    default:
      assertNever(ft.kind);
  }
};

/**
 * Enumerate every asset reference reachable in `jsonData` under `fields`,
 * appending each {@link HandleRef} to `out`. The resolver-free counterpart to
 * {@link applyFields}: it discovers what a serialized value depends on so those
 * assets can be loaded before it is decoded.
 */
export const collectHandleRefs = (
  fields: Readonly<Record<string, FieldType<unknown>>>,
  jsonData: Record<string, unknown>,
  registry: TypeRegistry,
  out: HandleRef[],
): void => {
  for (const [key, ft] of Object.entries(fields)) {
    if (ft.isSkipped) continue;
    const raw = jsonData[key];
    if (raw === undefined) continue;
    collectValueRefs(ft, raw, registry, out);
  }
};

/**
 * Enumerate the asset references a serialized component depends on, appending
 * each to `out`. Walks the current schema over the raw data (no migration, since
 * nothing is reconstructed) — refs a migration would add are discovered lazily on
 * first decode instead.
 */
export const collectComponentHandleRefs = (
  reg: RegisteredType,
  serialized: { readonly data: Record<string, unknown> },
  registry: TypeRegistry,
  out: HandleRef[],
): void => {
  collectHandleRefs(reg.schema, serialized.data, registry, out);
};

/**
 * Whether `ft` carries an entity reference anywhere in its shape (directly, or
 * nested in an array/tuple/struct/variant/registered type). Recursion into
 * registered nested types is guarded against cycles via `seen`.
 */
export const fieldHasEntityRef = (
  ft: FieldType<unknown>,
  registry: TypeRegistry,
  seen: Set<object> = new Set(),
): boolean => {
  switch (ft.kind) {
    case 'entity':
      return true;
    case 'array':
      return ft.element !== undefined && fieldHasEntityRef(ft.element, registry, seen);
    case 'tuple':
      return (ft.elements ?? []).some((el) => fieldHasEntityRef(el, registry, seen));
    case 'struct':
      return ft.fields !== undefined && schemaHasEntityField(ft.fields, registry, seen);
    case 'variant':
      return (
        ft.variants !== undefined &&
        Object.values(ft.variants).some((arm) => schemaHasEntityField(arm, registry, seen))
      );
    case 'type': {
      const ctor = ft.nestedCtor;
      if (ctor === undefined) return false;
      const reg = registry.getByCtor(ctor);
      if (reg === undefined || seen.has(reg.schema)) return false;
      seen.add(reg.schema);
      return schemaHasEntityField(reg.schema, registry, seen);
    }
    default:
      return false;
  }
};

/**
 * Whether any non-skipped field in `fields` carries an entity reference. Used to
 * recognize components whose entity refs cannot survive a derived-subtree
 * round-trip (the targets are rebuilt with fresh ids on load), so they are kept
 * out of composition overrides.
 */
export const schemaHasEntityField = (
  fields: Readonly<Record<string, FieldType<unknown>>>,
  registry: TypeRegistry,
  seen: Set<object> = new Set(),
): boolean => {
  for (const ft of Object.values(fields)) {
    if (ft.isSkipped) continue;
    if (fieldHasEntityRef(ft, registry, seen)) return true;
  }
  return false;
};

/** A partial overlay of a component: the subset of fields to patch, by name, with no schema version. */
export interface FieldOverride {
  /** Stable type name of the component being patched. */
  readonly type: string;
  /** The fields that differ, in encoded form, keyed by field name. */
  readonly data: Record<string, unknown>;
}

/** Structural equality of two already-encoded (JSON-ready) values. */
const encodedEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) if (!encodedEqual(a[i], b[i])) return false;
    return true;
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
    for (const key of keys) if (!encodedEqual(ao[key], bo[key])) return false;
    return true;
  }
  return false;
};

/**
 * Compare a baseline component against the live one (both already encoded against
 * comparable environments) and return only the fields that changed as a
 * {@link FieldOverride}, or `undefined` when nothing differs. This is the
 * field-level delta a prefab/instance override records: untouched fields are
 * omitted so they keep inheriting the source's value. Compares exact encoded
 * forms (no float epsilon) so a saved override matches what serialization writes.
 */
export const diffComponent = (
  baseline: SerializedValue,
  live: SerializedValue,
): FieldOverride | undefined => {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(live.data)) {
    if (!encodedEqual(value, baseline.data[key])) data[key] = value;
  }
  return Object.keys(data).length > 0 ? { type: live.type, data } : undefined;
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
