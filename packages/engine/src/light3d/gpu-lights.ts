import type { Mat4 } from '@retro-engine/math';
import type { BindGroup, BindGroupLayout, Buffer, Renderer } from '@retro-engine/renderer-core';
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

// std140 uniform layout (bytes), matching the WGSL `GpuLights` struct exactly:
//
//   ambient: vec4<f32>   @ 0   (16)  rgb + a = brightness
//   counts:  vec4<u32>   @ 16  (16)  x = dir, y = point, z = spot
//   directional: array<DirectionalLightGpu, 4>  @ 32   (4 * 32  = 128)
//   point:       array<PointLightGpu, 64>        @ 160  (64 * 48 = 3072)
//   spot:        array<SpotLightGpu, 64>          @ 3232 (64 * 64 = 4096)
//
// Each sub-struct is a whole number of 16-byte slots, so std140 array stride
// equals the struct size with no inter-element padding.
const HEADER_BYTES = 32;
const DIRECTIONAL_STRIDE_F32 = 8; // 2 × vec4
const POINT_STRIDE_F32 = 12; // 3 × vec4
const SPOT_STRIDE_F32 = 16; // 4 × vec4

const DIRECTIONAL_BASE_F32 = HEADER_BYTES / 4; // 8
const POINT_BASE_F32 = DIRECTIONAL_BASE_F32 + MAX_DIRECTIONAL_LIGHTS * DIRECTIONAL_STRIDE_F32; // 40
const SPOT_BASE_F32 = POINT_BASE_F32 + MAX_POINT_LIGHTS * POINT_STRIDE_F32; // 808

/** Total byte size of the {@link GpuLights} uniform buffer (7328 B). */
export const GPU_LIGHTS_BYTE_SIZE =
  HEADER_BYTES +
  MAX_DIRECTIONAL_LIGHTS * DIRECTIONAL_STRIDE_F32 * 4 +
  MAX_POINT_LIGHTS * POINT_STRIDE_F32 * 4 +
  MAX_SPOT_LIGHTS * SPOT_STRIDE_F32 * 4;

/** `GPU_LIGHTS_BYTE_SIZE / 4` — number of `f32` slots in the lights buffer (1832). */
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
 * offset 16 → `u32[4..6]`). Already-clamped counts are expected.
 *
 * @internal
 */
export const packCounts = (
  u32: Uint32Array,
  directionalCount: number,
  pointCount: number,
  spotCount: number,
): void => {
  u32[4] = directionalCount;
  u32[5] = pointCount;
  u32[6] = spotCount;
  u32[7] = 0;
};

/**
 * Pack one {@link DirectionalLight3d} into the `directional` array at `index`.
 * `direction.xyz` = the entity's forward (−Z) from `gtMatrix`; `color.rgb` +
 * `color.a` = intensity.
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
  f32[base + 3] = 0;
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
 * `params.x` = radius, `params.y` = `cos(outerAngle)`, `params.z` = `1/range²`.
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
  f32[base + 15] = 0;
};

/**
 * Render-world resource owning the engine's analytic-light uniform buffer and
 * its `@group(2)` bind group. The buffer is fixed-size (see
 * {@link GPU_LIGHTS_BYTE_SIZE}) and allocated once — only its contents change
 * per frame, written by the `light3d-prepare` system. The bind group is built
 * once and reused (the buffer identity never changes), so unlike the 2D
 * lighting targets there is no per-frame bind-group churn.
 *
 * Lit material pipelines append {@link layout} as their third bind-group layout
 * (`[view, material, lights]`); the Core3d phase nodes bind {@link bindGroup}
 * at `@group(2)`.
 *
 * @internal
 */
export class GpuLights {
  /** Backing uniform buffer (`UNIFORM | COPY_DST`). Allocated by {@link ensureInitialised}. */
  buffer: Buffer | undefined;
  /** `@group(2)` bind-group layout (one uniform buffer at binding 0, fragment-visible). */
  layout: BindGroupLayout | undefined;
  /** `@group(2)` bind group bound by the Core3d phase nodes. */
  bindGroup: BindGroup | undefined;

  /** CPU scratch mirroring the buffer; `f32`/`u32` are views over one ArrayBuffer. */
  readonly data = new ArrayBuffer(GPU_LIGHTS_BYTE_SIZE);
  readonly f32 = new Float32Array(this.data);
  readonly u32 = new Uint32Array(this.data);

  private initialised = false;

  /**
   * Lazily allocate the GPU buffer, bind-group layout, and bind group.
   * Idempotent; returns `true` once ready. Unlike the camera-dependent
   * pipelines this has no first-frame race — the lights buffer needs only the
   * renderer's device, available from the first system tick.
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
      entries: [{ binding: 0, visibility: ShaderStage.FRAGMENT, buffer: { type: 'uniform' } }],
    });
    this.bindGroup = renderer.createBindGroup({
      label: 'light3d',
      layout: this.layout,
      entries: [{ binding: 0, resource: { buffer: this.buffer } }],
    });
    this.initialised = true;
    return true;
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
