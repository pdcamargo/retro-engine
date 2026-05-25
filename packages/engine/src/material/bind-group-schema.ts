import type { TextureFormat } from '@retro-engine/renderer-core';
import { ShaderStage, type ShaderStageFlags } from '@retro-engine/renderer-core';

/**
 * Higher-level alias over the {@link ShaderStage} bitfield. Material authors
 * write `'fragment'`, `'vertex'`, or `'both'` rather than
 * `ShaderStage.VERTEX | ShaderStage.FRAGMENT`; the schema walker translates
 * to the bitfield.
 *
 * The bitfield remains the canonical HAL shape — `'both'` is sugar for the
 * common material case where one resource is read in both stages.
 */
export type BindingVisibility = 'vertex' | 'fragment' | 'both';

/**
 * Translate the high-level visibility alias to the HAL bitfield. Exported for
 * the schema walker and for tests; material authors should not need to call
 * this directly.
 */
export const visibilityToFlags = (vis: BindingVisibility): ShaderStageFlags => {
  switch (vis) {
    case 'vertex':
      return ShaderStage.VERTEX;
    case 'fragment':
      return ShaderStage.FRAGMENT;
    case 'both':
      return ShaderStage.VERTEX | ShaderStage.FRAGMENT;
  }
};

/**
 * How a material's instance field is packed into the slot's uniform buffer.
 *
 * The schema walker treats the slot as a single packed UBO laid out in
 * WGSL `std140`-style alignment: every `vecNf` occupies its natural alignment,
 * scalars fill the gaps in declared order. Author the schema's `fields` array
 * to match the order in the WGSL `struct` exactly.
 */
export type UniformFieldPack = 'vec4f' | 'vec3f' | 'vec2f' | 'f32' | 'u32' | 'i32';

/**
 * Byte size of one occurrence of a packed uniform field. `vec3f` has a stride
 * of 16 bytes (12-byte payload + 4-byte alignment pad) when followed by
 * another field in a WGSL `struct`; the walker handles the padding.
 */
export const uniformFieldByteSize = (pack: UniformFieldPack): number => {
  switch (pack) {
    case 'f32':
    case 'u32':
    case 'i32':
      return 4;
    case 'vec2f':
      return 8;
    case 'vec3f':
      return 12;
    case 'vec4f':
      return 16;
  }
};

/**
 * Natural alignment of a packed uniform field, in bytes. `vec3f`'s alignment
 * is 16, not 12 — WGSL `std140` rules.
 */
export const uniformFieldAlignment = (pack: UniformFieldPack): number => {
  switch (pack) {
    case 'f32':
    case 'u32':
    case 'i32':
      return 4;
    case 'vec2f':
      return 8;
    case 'vec3f':
    case 'vec4f':
      return 16;
  }
};

/**
 * One scalar / vector packed into a uniform buffer slot. References the
 * material's instance field by string key; the key is type-checked against
 * `keyof M & string` when the schema is built via {@link MaterialSchema}.
 */
export interface UniformField<M> {
  fieldKey: keyof M & string;
  pack: UniformFieldPack;
}

/**
 * Texture sample type the layout entry advertises to the shader. Mirrors
 * `GPUTextureSampleType`.
 */
export type BindGroupTextureSampleType =
  | 'float'
  | 'unfilterable-float'
  | 'depth'
  | 'sint'
  | 'uint';

/**
 * Texture view dimension the layout entry advertises. Mirrors
 * `GPUTextureViewDimension`.
 */
export type BindGroupTextureViewDimension =
  | '1d'
  | '2d'
  | '2d-array'
  | 'cube'
  | 'cube-array'
  | '3d';

/**
 * Sampler binding type. Mirrors `GPUSamplerBindingType`.
 */
export type BindGroupSamplerType = 'filtering' | 'non-filtering' | 'comparison';

/**
 * One entry in a material's bind-group schema. Discriminated by `kind`.
 *
 * Every entry carries a `binding` (matching the WGSL `@binding(N)` attribute),
 * a `visibility`, and — for non-uniform entries — a `fieldKey` pointing at the
 * material's instance field that supplies the resource at prepare time.
 *
 * Uniform entries pack one or more material fields into a single UBO at the
 * slot. Texture / sampler entries reference a single field. Storage buffer
 * entries reference a single field whose value is the resource.
 */
export type BindGroupEntry<M> =
  | {
      readonly kind: 'uniform';
      readonly binding: number;
      readonly visibility: BindingVisibility;
      readonly fields: readonly UniformField<M>[];
    }
  | {
      readonly kind: 'texture';
      readonly binding: number;
      readonly visibility: BindingVisibility;
      readonly fieldKey: keyof M & string;
      readonly sampleType?: BindGroupTextureSampleType;
      readonly viewDimension?: BindGroupTextureViewDimension;
      readonly multisampled?: boolean;
    }
  | {
      readonly kind: 'sampler';
      readonly binding: number;
      readonly visibility: BindingVisibility;
      readonly fieldKey?: keyof M & string;
      readonly type?: BindGroupSamplerType;
    }
  | {
      readonly kind: 'storageBuffer';
      readonly binding: number;
      readonly visibility: BindingVisibility;
      readonly fieldKey: keyof M & string;
      readonly access: 'read-only' | 'read-write';
    }
  | {
      readonly kind: 'storageTexture';
      readonly binding: number;
      readonly visibility: BindingVisibility;
      readonly fieldKey: keyof M & string;
      readonly format: TextureFormat;
      readonly access?: 'write-only' | 'read-only' | 'read-write';
      readonly viewDimension?: BindGroupTextureViewDimension;
    };

/** A material's bind-group schema. */
export type BindGroupSchema<M> = readonly BindGroupEntry<M>[];

/**
 * Build a bind-group schema for material class `C`. The class reference binds
 * the schema's generic parameter — every `fieldKey` in the schema is checked
 * against `keyof InstanceType<C>` at compile time.
 *
 * Refactor safety: renaming a referenced field surfaces a TS error on the
 * schema entry. A schema declared as a raw object literal (`static bindGroup =
 * [...] as const satisfies BindGroupSchema<Self>`) does *not* catch renames —
 * the literal's element shape is checked against `BindGroupSchema`, not
 * against the material's instance type. Use this helper for the canonical
 * shape; see ADR-0027.
 *
 * @param _classRef The material class. Unused at runtime — binds the generic.
 * @param schema The schema entries; each `fieldKey` is type-checked.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function MaterialSchema<C extends abstract new (...a: any[]) => any>(
  _classRef: C,
  schema: BindGroupSchema<InstanceType<C>>,
): BindGroupSchema<InstanceType<C>> {
  return schema;
}
