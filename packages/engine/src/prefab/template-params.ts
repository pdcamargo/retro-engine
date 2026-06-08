import type { DecodeEnv, RegisteredType } from '@retro-engine/reflect';
import { decodeValue } from '@retro-engine/reflect';

import type { ParamSchema } from './template';

/**
 * Resolve live (already-decoded) param values against a schema, filling defaults.
 * Used by the code-driven spawn/patch path where the caller passes runtime values
 * directly. A provided value wins; otherwise the field's `.default()` applies; an
 * optional field with neither is omitted; a required field with neither throws.
 *
 * @internal
 */
export const resolveParams = (
  schema: ParamSchema,
  provided: Record<string, unknown>,
): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [key, ft] of Object.entries(schema)) {
    const value = provided[key];
    if (value !== undefined) {
      out[key] = value;
    } else if (ft.defaultFactory !== undefined) {
      out[key] = ft.defaultFactory();
    } else if (!ft.isOptional) {
      throw new Error(`prefab: missing required template param '${key}'`);
    }
  }
  return out;
};

/**
 * Decode serialized param data against a schema, filling defaults. Used by the
 * scene-embedding path: present fields decode through the codec (so entity and
 * handle params remap/resolve), absent fields fall back to `.default()`.
 *
 * @internal
 */
export const decodeParams = (
  schema: ParamSchema,
  data: Record<string, unknown>,
  env: DecodeEnv,
): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [key, ft] of Object.entries(schema)) {
    const raw = data[key];
    if (raw === undefined) {
      if (ft.defaultFactory !== undefined) out[key] = ft.defaultFactory();
      else if (!ft.isOptional) throw new Error(`prefab: missing required template param '${key}'`);
    } else {
      out[key] = decodeValue(ft, raw, env);
    }
  }
  return out;
};

/**
 * Overlay a partial field set onto an existing instance: only the fields *present*
 * in `data` are decoded and assigned, so absent fields keep their current value.
 * This is the field-level override primitive — a scene patches just the fields it
 * names on a template-produced component. Fields not in the component's schema are
 * ignored.
 *
 * @internal
 */
export const applyFieldOverrides = (
  reg: RegisteredType,
  instance: Record<string, unknown>,
  data: Record<string, unknown>,
  env: DecodeEnv,
): void => {
  for (const [key, raw] of Object.entries(data)) {
    if (raw === undefined) continue;
    const ft = reg.schema[key];
    if (ft === undefined) continue;
    instance[key] = decodeValue(ft, raw, env);
  }
};
