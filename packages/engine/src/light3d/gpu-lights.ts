import type { Mat4 } from '@retro-engine/math';
import type {
  BindGroup,
  BindGroupLayout,
  Buffer,
  Renderer,
  Sampler,
  TextureView,
} from '@retro-engine/renderer-core';
import { BufferUsage, ShaderStage } from '@retro-engine/renderer-core';

import type { AmbientLight } from './ambient-light';
import type { DirectionalLight3d } from './directional-light-3d';
import type { PointLight3d } from './point-light-3d';
import type { SpotLight3d } from './spot-light-3d';

/**
 * Maximum directional lights packed into {@link GpuLights} per frame. Lights
 * beyond this cap (in visible-iteration order) are dropped. Mirrors the WGSL
 * `MAX_DIRECTIONAL_LIGHTS` in `retro_engine::light3d`.
 */
export const MAX_DIRECTIONAL_LIGHTS = 4 as const;
/** Maximum point lights packed per frame. Mirrors the WGSL constant. */
export const MAX_POINT_LIGHTS = 64 as const;
/** Maximum spot lights packed per frame. Mirrors the WGSL constant. */
export const MAX_SPOT_LIGHTS = 64 as const;

/**
 * Maximum shadow-casting layers resolved per frame — the depth of the shadow
 * atlas's 2D-array texture and the length of the `shadow_view_proj` matrix
 * array in {@link GpuLights}. A spot light consumes one layer; a directional
 * light consumes one layer per cascade (consecutive layers). Casters beyond
 * this budget (in visible-iteration order) render unshadowed. Mirrors the WGSL
 * `MAX_SHADOW_CASTERS` in `retro_engine::light3d`.
 */
export const MAX_SHADOW_CASTERS = 12 as const;

// std140 uniform layout (bytes), matching the WGSL `GpuLights` struct exactly:
//
//   ambient: vec4<f32>   @ 0    (16)  rgb + a = brightness
//   counts:  vec4<u32>   @ 16   (16)  x = dir, y = point, z = spot, w = cascade count
//   directional: array<DirectionalLightGpu, 4>  @ 32   (4 * 32  = 128)
//   point:       array<PointLightGpu, 64>        @ 160  (64 * 48 = 3072)
//   spot:        array<SpotLightGpu, 64>          @ 3232 (64 * 64 = 4096)
//   cascade_splits: vec4<f32>                     @ 7328 (16)  far view-depth per cascade
//   shadow_view_proj: array<mat4x4<f32>, 12>      @ 7344 (12 * 64 = 768)
//
// Each sub-struct is a whole number of 16-byte slots, so std140 array stride
// equals the struct size with no inter-element padding. `cascade_splits` is a
// 16-byte vec4 on a 16-byte boundary; the `mat4x4<f32>` array follows it (64 B
// columns, 16-byte aligned), so neither needs extra padding.
const HEADER_BYTES = 32;
const DIRECTIONAL_STRIDE_F32 = 8; // 2 × vec4
const POINT_STRIDE_F32 = 12; // 3 × vec4
const SPOT_STRIDE_F32 = 16; // 4 × vec4
const CASCADE_SPLITS_F32 = 4; // vec4<f32>
const SHADOW_MATRIX_F32 = 16; // mat4x4<f32>

const DIRECTIONAL_BASE_F32 = HEADER_BYTES / 4; // 8
const POINT_BASE_F32 = DIRECTIONAL_BASE_F32 + MAX_DIRECTIONAL_LIGHTS * DIRECTIONAL_STRIDE_F32; // 40
const SPOT_BASE_F32 = POINT_BASE_F32 + MAX_POINT_LIGHTS * POINT_STRIDE_F32; // 808
/** First `f32` slot of the `cascade_splits` vec4 (1832). */
const CASCADE_SPLITS_BASE_F32 = SPOT_BASE_F32 + MAX_SPOT_LIGHTS * SPOT_STRIDE_F32; // 1832
/** First `f32` slot of the trailing `shadow_view_proj` matrix array (1836). */
const SHADOW_VIEW_PROJ_BASE_F32 = CASCADE_SPLITS_BASE_F32 + CASCADE_SPLITS_F32; // 1836

/**
 * Sentinel caster index meaning "this light casts no shadow" — packed into the
 * unused `w` of a directional light's `direction` / a spot light's `params`.
 * The WGSL `shadow_factor` returns `1.0` (fully lit) for any index `< 0`.
 */
export const NO_SHADOW_CASTER = -1 as const;

/** Total byte size of the {@link GpuLights} uniform buffer (8112 B). */
export const GPU_LIGHTS_BYTE_SIZE =
  HEADER_BYTES +
  MAX_DIRECTIONAL_LIGHTS * DIRECTIONAL_STRIDE_F32 * 4 +
  MAX_POINT_LIGHTS * POINT_STRIDE_F32 * 4 +
  MAX_SPOT_LIGHTS * SPOT_STRIDE_F32 * 4 +
  CASCADE_SPLITS_F32 * 4 +
  MAX_SHADOW_CASTERS * SHADOW_MATRIX_F32 * 4;

/** `GPU_LIGHTS_BYTE_SIZE / 4` — number of `f32` slots in the lights buffer (2028). */
export const GPU_LIGHTS_FLOAT_COUNT = GPU_LIGHTS_BYTE_SIZE / 4;

/**
 * Extract the normalized world-space forward axis (−Z) from a column-major
 * model matrix — the direction a `DirectionalLight3d` / `SpotLight3d` entity
 * "points". Writes the three components into `out` at `outIndex` and returns
 * `out`. The −Z basis is column 2 of the matrix (`m[8..10]`), negated.
 */
export const forwardFromMatrix = (m: Mat4, out: Float32Array, outIndex: number): Float32Array => {
  let x = -(m[8] as number);
  let y = -(m[9] as number);
  let z = -(m[10] as number);
  const len = Math.hypot(x, y, z) || 1;
  x /= len;
  y /= len;
  z /= len;
  out[outIndex] = x;
  out[outIndex + 1] = y;
  out[outIndex + 2] = z;
  return out;
};

/**
 * Pack the {@link AmbientLight} resource into the header of the lights scratch.
 * `f32[0..2]` = colour, `f32[3]` = brightness.
 *
 * @internal
 */
export const packAmbient = (ambient: AmbientLight, f32: Float32Array): void => {
  f32[0] = ambient.color[0] as number;
  f32[1] = ambient.color[1] as number;
  f32[2] = ambient.color[2] as number;
  f32[3] = ambient.brightness;
};

/**
 * Write the per-kind light counts into the header (`counts: vec4<u32>` at byte
 * offset 16 → `u32[4..7]`). `cascadeCount` (the number of cascades each shadowed
 * directional light uses, `0` when none cascade) goes in `counts.w`; the shader
 * uses it to bound cascade selection. Already-clamped counts are expected.
 *
 * @internal
 */
export const packCounts = (
  u32: Uint32Array,
  directionalCount: number,
  pointCount: number,
  spotCount: number,
  cascadeCount = 0,
): void => {
  u32[4] = directionalCount;
  u32[5] = pointCount;
  u32[6] = spotCount;
  u32[7] = cascadeCount;
};

/**
 * Pack one {@link DirectionalLight3d} into the `directional` array at `index`.
 * `direction.xyz` = the entity's forward (−Z) from `gtMatrix`; `direction.w` =
 * shadow caster index (defaults to {@link NO_SHADOW_CASTER}; set by
 * {@link packDirectionalCascadeBase} for cascaded shadows or
 * {@link packDirectionalCasterIndex} for the fixed-box fallback when the light
 * is assigned atlas layers); `color.rgb` + `color.a` = intensity.
 *
 * @internal
 */
export const packDirectionalLight = (
  light: DirectionalLight3d,
  gtMatrix: Mat4,
  f32: Float32Array,
  index: number,
): void => {
  const base = DIRECTIONAL_BASE_F32 + index * DIRECTIONAL_STRIDE_F32;
  forwardFromMatrix(gtMatrix, f32, base);
  f32[base + 3] = NO_SHADOW_CASTER;
  f32[base + 4] = light.color[0] as number;
  f32[base + 5] = light.color[1] as number;
  f32[base + 6] = light.color[2] as number;
  f32[base + 7] = light.intensity;
};

/**
 * Pack one {@link PointLight3d} into the `point` array at `index`.
 * `position.xyz` from `gtMatrix` translation, `position.w` = range,
 * `color.rgb` + `color.a` = intensity, `params.x` = radius,
 * `params.y` = `1/range²` (inverse-square denominator, precomputed).
 *
 * @internal
 */
export const packPointLight = (
  light: PointLight3d,
  gtMatrix: Mat4,
  f32: Float32Array,
  index: number,
): void => {
  const base = POINT_BASE_F32 + index * POINT_STRIDE_F32;
  const range = light.range;
  f32[base + 0] = gtMatrix[12] as number;
  f32[base + 1] = gtMatrix[13] as number;
  f32[base + 2] = gtMatrix[14] as number;
  f32[base + 3] = range;
  f32[base + 4] = light.color[0] as number;
  f32[base + 5] = light.color[1] as number;
  f32[base + 6] = light.color[2] as number;
  f32[base + 7] = light.intensity;
  f32[base + 8] = light.radius;
  f32[base + 9] = range > 0 ? 1 / (range * range) : 0;
  f32[base + 10] = 0;
  f32[base + 11] = 0;
};

/**
 * Pack one {@link SpotLight3d} into the `spot` array at `index`.
 * `position.xyz` + `position.w` = range; `direction.xyz` = cone forward (−Z),
 * `direction.w` = `cos(innerAngle)`; `color.rgb` + `color.a` = intensity;
 * `params.x` = radius, `params.y` = `cos(outerAngle)`, `params.z` = `1/range²`,
 * `params.w` = shadow caster index (defaults to {@link NO_SHADOW_CASTER}; set
 * by {@link packSpotCasterIndex} when the light is assigned an atlas layer).
 *
 * @internal
 */
export const packSpotLight = (
  light: SpotLight3d,
  gtMatrix: Mat4,
  f32: Float32Array,
  index: number,
): void => {
  const base = SPOT_BASE_F32 + index * SPOT_STRIDE_F32;
  const range = light.range;
  f32[base + 0] = gtMatrix[12] as number;
  f32[base + 1] = gtMatrix[13] as number;
  f32[base + 2] = gtMatrix[14] as number;
  f32[base + 3] = range;
  forwardFromMatrix(gtMatrix, f32, base + 4);
  f32[base + 7] = Math.cos(light.innerAngle);
  f32[base + 8] = light.color[0] as number;
  f32[base + 9] = light.color[1] as number;
  f32[base + 10] = light.color[2] as number;
  f32[base + 11] = light.intensity;
  f32[base + 12] = light.radius;
  f32[base + 13] = Math.cos(light.outerAngle);
  f32[base + 14] = range > 0 ? 1 / (range * range) : 0;
  f32[base + 15] = NO_SHADOW_CASTER;
};

/**
 * Write a directional light's assigned shadow atlas layer (`casterIndex`) into
 * its `direction.w` slot. The WGSL `shadow_factor` uses it as both the
 * `shadow_view_proj` matrix index and the depth-atlas array layer.
 *
 * @internal
 */
export const packDirectionalCasterIndex = (
  f32: Float32Array,
  index: number,
  casterIndex: number,
): void => {
  f32[DIRECTIONAL_BASE_F32 + index * DIRECTIONAL_STRIDE_F32 + 3] = casterIndex;
};

/**
 * Write a cascaded directional light's **base** shadow-atlas layer into its
 * `direction.w` slot. Its cascades occupy the consecutive layers
 * `[baseLayer, baseLayer + cascadeCount)`; the WGSL `directional_shadow_factor`
 * adds the per-fragment cascade index to this base. Same slot as
 * {@link packDirectionalCasterIndex} (used for the non-cascaded fallback).
 *
 * @internal
 */
export const packDirectionalCascadeBase = (
  f32: Float32Array,
  index: number,
  baseLayer: number,
): void => {
  f32[DIRECTIONAL_BASE_F32 + index * DIRECTIONAL_STRIDE_F32 + 3] = baseLayer;
};

/**
 * Write a spot light's assigned shadow atlas layer (`casterIndex`) into its
 * `params.w` slot. See {@link packDirectionalCasterIndex}.
 *
 * @internal
 */
export const packSpotCasterIndex = (
  f32: Float32Array,
  index: number,
  casterIndex: number,
): void => {
  f32[SPOT_BASE_F32 + index * SPOT_STRIDE_F32 + 15] = casterIndex;
};

/**
 * Write one light-space view-projection matrix (column-major, 16 floats) into
 * the trailing `shadow_view_proj` array at `casterIndex`. The same matrix is
 * uploaded to the shadow depth pass's `@group(0)` so the depth render and the
 * shading-time projection agree.
 *
 * @internal
 */
export const packShadowViewProj = (
  f32: Float32Array,
  casterIndex: number,
  viewProj: Mat4,
): void => {
  f32.set(viewProj as Float32Array, SHADOW_VIEW_PROJ_BASE_F32 + casterIndex * SHADOW_MATRIX_F32);
};

/**
 * Write the directional cascade split distances into the `cascade_splits` vec4.
 * Each component is a cascade's far edge in camera view-space distance (world
 * units); the WGSL `directional_shadow_factor` compares a fragment's view-space
 * depth against them to pick its cascade. Only the first `cascadeCount`
 * components are meaningful. Copies up to four values from `splits`.
 *
 * @internal
 */
export const packCascadeSplits = (f32: Float32Array, splits: Float32Array): void => {
  f32[CASCADE_SPLITS_BASE_F32] = splits[0] as number;
  f32[CASCADE_SPLITS_BASE_F32 + 1] = splits[1] as number;
  f32[CASCADE_SPLITS_BASE_F32 + 2] = splits[2] as number;
  f32[CASCADE_SPLITS_BASE_F32 + 3] = splits[3] as number;
};

/**
 * Render-world resource owning the engine's analytic-light uniform buffer and
 * its `@group(2)` bind group. The buffer is fixed-size (see
 * {@link GPU_LIGHTS_BYTE_SIZE}) and allocated once — only its contents change
 * per frame, written by the `light3d-prepare` system.
 *
 * The `@group(2)` layout has three bindings: the lights uniform at `0`, the
 * shadow depth atlas (`texture_depth_2d_array`) at `1`, and a comparison
 * sampler at `2`. The layout is built here (it needs no textures) so lit
 * material pipelines can append it as their third bind-group layout
 * (`[view, material, lights]`). The bind GROUP needs the shadow atlas view +
 * comparison sampler, which the `Shadow3dState` resource owns — so it is built
 * by {@link buildShadowBindGroup} once that resource's GPU bootstrap runs (one
 * frame's lazy init), not here. Until then {@link bindGroup} is `undefined` and
 * the Core3d phase nodes skip the `@group(2)` bind.
 *
 * @internal
 */
export class GpuLights {
  /** Backing uniform buffer (`UNIFORM | COPY_DST`). Allocated by {@link ensureInitialised}. */
  buffer: Buffer | undefined;
  /** `@group(2)` bind-group layout (lights uniform + shadow atlas + comparison sampler). */
  layout: BindGroupLayout | undefined;
  /** `@group(2)` bind group bound by the Core3d phase nodes. Built by {@link buildShadowBindGroup}. */
  bindGroup: BindGroup | undefined;

  /** CPU scratch mirroring the buffer; `f32`/`u32` are views over one ArrayBuffer. */
  readonly data = new ArrayBuffer(GPU_LIGHTS_BYTE_SIZE);
  readonly f32 = new Float32Array(this.data);
  readonly u32 = new Uint32Array(this.data);

  private initialised = false;

  /**
   * Lazily allocate the GPU buffer and the `@group(2)` bind-group layout.
   * Idempotent; returns `true` once ready. The bind group itself is built
   * separately by {@link buildShadowBindGroup} once the shadow atlas exists.
   */
  ensureInitialised(renderer: Renderer): boolean {
    if (this.initialised) return true;
    this.buffer = renderer.createBuffer({
      label: 'gpu-lights',
      size: GPU_LIGHTS_BYTE_SIZE,
      usage: BufferUsage.UNIFORM | BufferUsage.COPY_DST,
    });
    this.layout = renderer.createBindGroupLayout({
      label: 'light3d-layout',
      entries: [
        { binding: 0, visibility: ShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        {
          binding: 1,
          visibility: ShaderStage.FRAGMENT,
          texture: { sampleType: 'depth', viewDimension: '2d-array' },
        },
        { binding: 2, visibility: ShaderStage.FRAGMENT, sampler: { type: 'comparison' } },
      ],
    });
    this.initialised = true;
    return true;
  }

  /**
   * Build the `@group(2)` bind group from the lights uniform plus the shadow
   * atlas view + comparison sampler (owned by `Shadow3dState`). Idempotent per
   * `(atlasView, sampler)` identity — the caller rebuilds only when those
   * change (they don't, the atlas is fixed-size). No-op before
   * {@link ensureInitialised}.
   */
  buildShadowBindGroup(renderer: Renderer, atlasView: TextureView, sampler: Sampler): void {
    if (this.buffer === undefined || this.layout === undefined) return;
    this.bindGroup = renderer.createBindGroup({
      label: 'light3d',
      layout: this.layout,
      entries: [
        { binding: 0, resource: { buffer: this.buffer } },
        { binding: 1, resource: atlasView },
        { binding: 2, resource: sampler },
      ],
    });
  }

  /** Upload the current scratch contents to the GPU buffer. No-op before init. */
  upload(renderer: Renderer): void {
    if (this.buffer === undefined) return;
    renderer.writeBuffer(this.buffer, 0, this.f32 as unknown as BufferSource);
  }

  /** Drop every GPU resource. Tests call this on teardown. */
  dispose(): void {
    this.buffer?.destroy();
    this.layout?.destroy();
    this.buffer = undefined;
    this.layout = undefined;
    this.bindGroup = undefined;
    this.initialised = false;
  }
}
