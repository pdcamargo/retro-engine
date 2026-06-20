import { type FieldType, type Schema, t } from '@retro-engine/reflect';

import { ASSET_TYPE } from '../asset/asset-stores';

import type { BindGroupSchema, UniformFieldPack } from './bind-group-schema';
import type { FieldMeta } from '@retro-engine/reflect';
import type { Material } from './material';

/**
 * The static surface {@link materialReflectionSchema} reads off a material class
 * to derive its serialization schema: the GPU bind-group schema (the single
 * source of truth for a material's authored fields) plus an optional explicit
 * augment for CPU-only fields the bind group doesn't cover.
 */
export interface MaterialReflectSource<M> {
  readonly bindGroup: BindGroupSchema<M>;
  /**
   * Extra serialized fields not present in the bind group (e.g. material knobs
   * like `doubleSided`). Merged over the derived fields, so a material can also
   * override a derived field's type/hints.
   */
  readonly serializedExtras?: Readonly<Record<string, FieldType<unknown>>>;
}

/** Map a uniform pack to its reflection field type, applying any inspector hints. */
const packFieldType = (
  pack: UniformFieldPack,
  semantic: 'color' | undefined,
  meta: FieldMeta | undefined,
): FieldType<unknown> => {
  const ft = baseFieldType(pack);
  const widget = semantic === 'color' ? { widget: 'color' } : undefined;
  if (widget === undefined && meta === undefined) return ft;
  return ft.meta({ ...widget, ...meta });
};

const baseFieldType = (pack: UniformFieldPack): FieldType<unknown> => {
  switch (pack) {
    case 'vec4f':
      return t.vec4 as FieldType<unknown>;
    case 'vec3f':
      return t.vec3 as FieldType<unknown>;
    case 'vec2f':
      return t.vec2 as FieldType<unknown>;
    case 'f32':
    case 'u32':
    case 'i32':
      return t.number as FieldType<unknown>;
  }
};

/**
 * Derive a reflection {@link Schema} for a material class from its bind-group
 * schema, so the material's authored fields round-trip through the codec with
 * no separately-maintained schema. Uniform fields map by pack (`vec4f` → `vec4`,
 * `f32` → `number`, …, carrying any `semantic` / `meta` inspector hints); handle
 * textures map to optional `Handle<Image>` fields (resolved/streamed by GUID).
 * Sampler entries share their texture's field and storage / raw-view entries are
 * runtime-only, so both are skipped. A material's optional `serializedExtras` is
 * merged last.
 *
 * The result is built dynamically from the runtime schema, so it is cast to
 * `Schema<M>` — fields absent from it simply keep their constructor default on
 * load, the same as a `.skip()`-ed field.
 */
export const materialReflectionSchema = <M extends Material>(
  source: MaterialReflectSource<M>,
): Schema<M> => {
  const fields: Record<string, FieldType<unknown>> = {};
  for (const entry of source.bindGroup) {
    if (entry.kind === 'uniform') {
      for (const field of entry.fields) {
        fields[field.fieldKey] = packFieldType(field.pack, field.semantic, field.meta);
      }
    } else if (entry.kind === 'texture' && entry.imageMode === 'handle') {
      fields[entry.fieldKey] = t.handle(ASSET_TYPE.image).optional() as FieldType<unknown>;
    }
    // sampler-handle entries reuse the texture's field; raw view / sampler /
    // storage entries hold runtime GPU resources — neither is serializable.
  }
  if (source.serializedExtras !== undefined) Object.assign(fields, source.serializedExtras);
  return fields as Schema<M>;
};
