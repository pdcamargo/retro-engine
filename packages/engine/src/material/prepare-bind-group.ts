import type {
  BindGroup,
  BindGroupLayout,
  BindGroupLayoutEntry,
  Buffer,
  Renderer,
  Sampler,
  TextureView,
} from '@retro-engine/renderer-core';
import { BufferUsage } from '@retro-engine/renderer-core';

import type { ImageHandle } from '../image/images';
import type { Images } from '../image/images';
import type { RenderImage } from '../image/render-image';
import type { RenderImages } from '../image/image-plugin';

import type {
  BindGroupEntry,
  BindGroupSamplerType,
  BindGroupSchema,
  ImageFallback,
  UniformField,
} from './bind-group-schema';
import {
  uniformFieldAlignment,
  uniformFieldByteSize,
  visibilityToFlags,
} from './bind-group-schema';

/**
 * Byte size of one uniform slot's packed UBO, following WGSL `std140`-style
 * alignment: each field's alignment is `uniformFieldAlignment(pack)`, and the
 * struct's total size is rounded up to a multiple of 16.
 *
 * Author the schema's `fields` array in the same order as the WGSL `struct`
 * declaration; the walker assumes the orderings match.
 */
export const uniformSlotByteSize = <M>(fields: readonly UniformField<M>[]): number => {
  let offset = 0;
  for (const field of fields) {
    const align = uniformFieldAlignment(field.pack);
    offset = alignUp(offset, align);
    offset += uniformFieldByteSize(field.pack);
  }
  return alignUp(offset, 16);
};

/**
 * Per-field byte offsets in the packed UBO, parallel to the schema's `fields`
 * array. Useful for tests and for the schema walker's `packUniformFields`
 * helper.
 */
export const uniformFieldOffsets = <M>(fields: readonly UniformField<M>[]): readonly number[] => {
  const offsets: number[] = [];
  let offset = 0;
  for (const field of fields) {
    const align = uniformFieldAlignment(field.pack);
    offset = alignUp(offset, align);
    offsets.push(offset);
    offset += uniformFieldByteSize(field.pack);
  }
  return offsets;
};

const alignUp = (value: number, alignment: number): number =>
  Math.ceil(value / alignment) * alignment;

/**
 * Build a {@link BindGroupLayout} from a {@link BindGroupSchema}. Runs once
 * per material type at `MaterialPlugin<M>.build()` time; the result is cached
 * on the plugin's per-type state.
 *
 * The schema's `binding` numbers carry through unmodified — the layout's
 * entries match the WGSL `@binding(N)` declarations 1:1.
 */
export const schemaToBindGroupLayout = <M>(
  renderer: Renderer,
  schema: BindGroupSchema<M>,
  label?: string,
): BindGroupLayout => {
  const entries: BindGroupLayoutEntry[] = schema.map((entry) => toLayoutEntry(entry));
  const desc = label !== undefined ? { label, entries } : { entries };
  return renderer.createBindGroupLayout(desc);
};

const toLayoutEntry = <M>(entry: BindGroupEntry<M>): BindGroupLayoutEntry => {
  const base = {
    binding: entry.binding,
    visibility: visibilityToFlags(entry.visibility),
  };
  switch (entry.kind) {
    case 'uniform':
      return { ...base, buffer: { type: 'uniform' } };
    case 'texture':
      return {
        ...base,
        texture: {
          ...(entry.sampleType !== undefined ? { sampleType: entry.sampleType } : {}),
          ...(entry.viewDimension !== undefined ? { viewDimension: entry.viewDimension } : {}),
          ...(entry.multisampled !== undefined ? { multisampled: entry.multisampled } : {}),
        },
      };
    case 'sampler': {
      const sampler: { type?: BindGroupSamplerType } = {};
      if (entry.type !== undefined) sampler.type = entry.type;
      return { ...base, sampler };
    }
    case 'storageBuffer':
      return {
        ...base,
        buffer: {
          type: entry.access === 'read-only' ? 'read-only-storage' : 'storage',
        },
      };
    case 'storageTexture':
      return {
        ...base,
        storageTexture: {
          format: entry.format,
          ...(entry.access !== undefined ? { access: entry.access } : {}),
          ...(entry.viewDimension !== undefined ? { viewDimension: entry.viewDimension } : {}),
        },
      };
  }
};

/**
 * Per-material cached state held by `RenderMaterials<M>`. The uniform buffer
 * is allocated once per material handle and re-uploaded each prepare pass
 * when the material instance changes; the bind group is rebuilt when any
 * referenced resource handle changes.
 */
export interface PreparedMaterial {
  bindGroup: BindGroup;
  uniformBuffer?: Buffer;
}

/**
 * Lift one material instance into a {@link BindGroup} matching `layout`.
 *
 * Walks the schema:
 * - Uniform slots pack their fields into `scratch` (a reused CPU `Float32Array`/
 *   `DataView` pair) and upload via `renderer.writeBuffer` to a per-material
 *   uniform buffer allocated lazily on first prepare.
 * - Texture and sampler entries come in two modes (per {@link BindGroupEntry}):
 *   `'handle'` mode resolves an `ImageHandle | undefined` field through
 *   `RenderImages`, falling back to `images.WHITE` / `.BLACK` /
 *   `.NORMAL_FLAT` per the entry's `fallback`. `'view'` / `'sampler'` mode
 *   reads the field directly and throws on `undefined`.
 * - Storage entries read the named field directly from `material` and bind it.
 *
 * `scratch` is reused across every prepare call — the caller (typically
 * `prepareMaterials<M>`) maintains one scratch buffer per `MaterialPlugin<M>`.
 *
 * `images` + `renderImages` are required by handle-mode entries; they're
 * inserted by `ImagePlugin` early in App build, and `MaterialPlugin<M>`'s
 * prepare system declares `after: ['image-prepare']` so the GPU resources
 * exist by the time this walker runs.
 *
 * Throws if a required resource cannot be resolved, if `image.dimension` is
 * `'cube'` or `'3d'` (no Phase 7.5 consumer wired up yet), or if a view-mode
 * field is `undefined`.
 */
export const prepareBindGroup = <M extends object>(
  renderer: Renderer,
  schema: BindGroupSchema<M>,
  layout: BindGroupLayout,
  material: M,
  previous: PreparedMaterial | undefined,
  scratch: ArrayBuffer,
  images: Images,
  renderImages: RenderImages,
  label?: string,
): PreparedMaterial => {
  const view = new DataView(scratch);
  const f32 = new Float32Array(scratch);

  let uniformBuffer = previous?.uniformBuffer;
  const entries: { binding: number; resource: BindingResourceInternal }[] = [];

  for (const entry of schema) {
    if (entry.kind === 'uniform') {
      const size = uniformSlotByteSize(entry.fields);
      const offsets = uniformFieldOffsets(entry.fields);
      packUniformSlot(material, entry.fields, offsets, view, f32);
      if (uniformBuffer === undefined || uniformBuffer.size < size) {
        if (uniformBuffer !== undefined) uniformBuffer.destroy();
        uniformBuffer = renderer.createBuffer({
          size,
          usage: BufferUsage.UNIFORM | BufferUsage.COPY_DST,
          ...(label !== undefined ? { label: `${label}#uniform` } : {}),
        });
      }
      renderer.writeBuffer(uniformBuffer, 0, scratch.slice(0, size));
      entries.push({
        binding: entry.binding,
        resource: { buffer: uniformBuffer, offset: 0, size },
      });
      continue;
    }
    if (entry.kind === 'texture') {
      if (entry.imageMode === 'handle') {
        const renderImage = resolveImageBinding(
          material,
          entry.fieldKey,
          entry.fallback,
          images,
          renderImages,
          'texture',
          entry.binding,
        );
        entries.push({ binding: entry.binding, resource: renderImage.view });
        continue;
      }
      const value = (material as Record<string, unknown>)[entry.fieldKey];
      if (value === undefined || value === null) {
        throw new Error(
          `prepareBindGroup: texture binding ${entry.binding} requires material field '${entry.fieldKey}' to be a TextureView; got ${value}.`,
        );
      }
      entries.push({ binding: entry.binding, resource: value as TextureView });
      continue;
    }
    if (entry.kind === 'sampler') {
      if (entry.imageMode === 'handle') {
        const renderImage = resolveImageBinding(
          material,
          entry.fieldKey,
          entry.fallback,
          images,
          renderImages,
          'sampler',
          entry.binding,
        );
        entries.push({ binding: entry.binding, resource: renderImage.sampler });
        continue;
      }
      const value = (material as Record<string, unknown>)[entry.fieldKey];
      if (value === undefined || value === null) {
        throw new Error(
          `prepareBindGroup: sampler binding ${entry.binding} requires material field '${entry.fieldKey}' to be a Sampler; got ${value}.`,
        );
      }
      entries.push({ binding: entry.binding, resource: value as Sampler });
      continue;
    }
    if (entry.kind === 'storageBuffer') {
      const value = (material as Record<string, unknown>)[entry.fieldKey];
      if (value === undefined || value === null) {
        throw new Error(
          `prepareBindGroup: storage buffer binding ${entry.binding} requires material field '${entry.fieldKey}' to be a Buffer; got ${value}.`,
        );
      }
      entries.push({ binding: entry.binding, resource: { buffer: value as Buffer } });
      continue;
    }
    if (entry.kind === 'storageTexture') {
      const value = (material as Record<string, unknown>)[entry.fieldKey];
      if (value === undefined || value === null) {
        throw new Error(
          `prepareBindGroup: storage texture binding ${entry.binding} requires material field '${entry.fieldKey}' to be a TextureView; got ${value}.`,
        );
      }
      entries.push({ binding: entry.binding, resource: value as TextureView });
      continue;
    }
  }

  // Previous bind group is discarded — we rebuild every prepare for now.
  // A handle-vs-resource diff could amortise this, but it's premature.
  if (previous?.bindGroup) previous.bindGroup.destroy();

  const bindGroup = renderer.createBindGroup({
    layout,
    entries: entries.map((e) => ({ binding: e.binding, resource: e.resource })),
    ...(label !== undefined ? { label } : {}),
  });

  const prepared: PreparedMaterial = { bindGroup };
  if (uniformBuffer !== undefined) prepared.uniformBuffer = uniformBuffer;
  return prepared;
};

/**
 * Resolve an `imageMode: 'handle'` texture or sampler entry: read the
 * material's named field (an `ImageHandle | undefined`), fall back to the
 * named default when undefined, look up the `RenderImage` in `RenderImages`,
 * and reject `'cube'` / `'3d'` images (no Phase 7.5 consumer is wired up yet
 * — the type-level support is for future cube / volume materials).
 */
const resolveImageBinding = <M>(
  material: M,
  fieldKey: string,
  fallback: ImageFallback,
  images: Images,
  renderImages: RenderImages,
  kind: 'texture' | 'sampler',
  binding: number,
): RenderImage => {
  const raw = (material as Record<string, unknown>)[fieldKey] as ImageHandle | undefined;
  const handle: ImageHandle =
    raw !== undefined && raw !== null
      ? raw
      : fallback === 'white'
        ? images.WHITE
        : fallback === 'black'
          ? images.BLACK
          : images.NORMAL_FLAT;
  const renderImage = renderImages.get(handle);
  if (renderImage === undefined) {
    throw new Error(
      `prepareBindGroup: ${kind} binding ${binding} could not resolve ImageHandle ${String(handle)} via RenderImages — make sure ImagePlugin is registered before any MaterialPlugin (its prepare system runs in RenderSet.Prepare with label 'image-prepare').`,
    );
  }
  const sourceImage = images.get(handle);
  if (sourceImage !== undefined && sourceImage.dimension !== '2d') {
    throw new Error(
      `prepareBindGroup: ${kind} binding ${binding} resolved to an image with dimension '${sourceImage.dimension}'; Phase 7.5 only wires up '2d' images. Cube and 3D consumers light up alongside their first real consumer (skybox, volumetrics, etc.).`,
    );
  }
  return renderImage;
};

/**
 * Internal resource union — wider than the exported {@link BindingResource}
 * union because we hand the renderer the same shapes for uniform and storage
 * buffers but distinguish them at the schema level.
 */
type BindingResourceInternal =
  | { buffer: Buffer; offset?: number; size?: number }
  | Sampler
  | TextureView;

const packUniformSlot = <M>(
  material: M,
  fields: readonly UniformField<M>[],
  offsets: readonly number[],
  view: DataView,
  f32: Float32Array,
): void => {
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]!;
    const offset = offsets[i]!;
    const value = (material as unknown as Record<string, unknown>)[field.fieldKey];
    switch (field.pack) {
      case 'f32': {
        const v = toF32(value);
        view.setFloat32(offset, v, true);
        break;
      }
      case 'u32': {
        const v = toU32(value);
        view.setUint32(offset, v, true);
        break;
      }
      case 'i32': {
        const v = toI32(value);
        view.setInt32(offset, v, true);
        break;
      }
      case 'vec2f': {
        const v = toVec2(value);
        f32[offset / 4] = v[0];
        f32[offset / 4 + 1] = v[1];
        break;
      }
      case 'vec3f': {
        const v = toVec3(value);
        f32[offset / 4] = v[0];
        f32[offset / 4 + 1] = v[1];
        f32[offset / 4 + 2] = v[2];
        break;
      }
      case 'vec4f': {
        const v = toVec4(value);
        f32[offset / 4] = v[0];
        f32[offset / 4 + 1] = v[1];
        f32[offset / 4 + 2] = v[2];
        f32[offset / 4 + 3] = v[3];
        break;
      }
    }
  }
};

const toF32 = (value: unknown): number => {
  if (typeof value === 'number') return value;
  throw new TypeError(`Expected number for f32 uniform field; got ${typeof value}.`);
};
const toU32 = (value: unknown): number => {
  if (typeof value === 'number') return value | 0;
  throw new TypeError(`Expected number for u32 uniform field; got ${typeof value}.`);
};
const toI32 = (value: unknown): number => {
  if (typeof value === 'number') return value | 0;
  throw new TypeError(`Expected number for i32 uniform field; got ${typeof value}.`);
};
const isIndexable = (value: unknown, min: number): value is ArrayLike<number> =>
  value !== null &&
  typeof value === 'object' &&
  typeof (value as { length?: number }).length === 'number' &&
  (value as { length: number }).length >= min;

const toVec2 = (value: unknown): readonly [number, number] => {
  if (isIndexable(value, 2)) return [value[0] as number, value[1] as number];
  if (isVecLike(value, 'x', 'y')) return [value.x, value.y];
  throw new TypeError(`Expected vec2 (array, Float32Array, or {x,y}) for vec2f uniform field.`);
};
const toVec3 = (value: unknown): readonly [number, number, number] => {
  if (isIndexable(value, 3))
    return [value[0] as number, value[1] as number, value[2] as number];
  if (isVecLike(value, 'x', 'y', 'z')) return [value.x, value.y, value.z];
  throw new TypeError(`Expected vec3 (array, Float32Array, or {x,y,z}) for vec3f uniform field.`);
};
const toVec4 = (value: unknown): readonly [number, number, number, number] => {
  if (isIndexable(value, 4))
    return [value[0] as number, value[1] as number, value[2] as number, value[3] as number];
  if (isVecLike(value, 'x', 'y', 'z', 'w'))
    return [value.x, value.y, value.z, value.w];
  throw new TypeError(`Expected vec4 (array, Float32Array, or {x,y,z,w}) for vec4f uniform field.`);
};

type VecXY = { readonly x: number; readonly y: number };
type VecXYZ = VecXY & { readonly z: number };
type VecXYZW = VecXYZ & { readonly w: number };
function isVecLike(value: unknown, ...keys: ['x', 'y']): value is VecXY;
function isVecLike(value: unknown, ...keys: ['x', 'y', 'z']): value is VecXYZ;
function isVecLike(value: unknown, ...keys: ['x', 'y', 'z', 'w']): value is VecXYZW;
function isVecLike(value: unknown, ...keys: string[]): boolean {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return keys.every((k) => typeof v[k] === 'number');
}
