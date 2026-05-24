import type { Entity } from '@retro-engine/ecs';
import type { Mat4, Vec3 } from '@retro-engine/math';
import type {
  BindGroup,
  BindGroupLayout,
  Buffer,
} from '@retro-engine/renderer-core';

import type { RenderLabel } from '../render-graph/render-label';
import type { CameraRenderTarget, ClearColorConfig, Viewport } from './camera';

/**
 * Render-world component carrying a single frame's snapshot of a main-world
 * camera. Spawned by the camera plugin's `extractCameras` system in
 * `RenderSet.Extract`; consumed by `prepareCameras` in `RenderSet.Prepare`.
 *
 * Render-world entities are cleared each frame (per ADR-0019), so this
 * component is rebuilt every frame — do not retain references across frames.
 * Matrices are deep-copied from the main-world `Camera.computed` snapshot, so
 * mutations in render-side systems do not bleed back into gameplay state.
 *
 * @internal Plugin-internal type. End users consume the {@link CameraView}
 *           exposed via `RenderCtx.camera` instead.
 */
export class ExtractedCamera {
  /** Main-world entity this snapshot came from. Stable across frames. */
  sourceEntity: Entity;
  /** Mirrored `Camera.order` for sort visibility. */
  order: number;
  /** Engine-level target. `primary` is resolved against the App surface in prepare. */
  target: CameraRenderTarget;
  /** Optional sub-rect. Undefined → full target. */
  viewport: Viewport | undefined;
  /** Clear-config snapshot. */
  clearColor: ClearColorConfig;
  /** Bitmask snapshot of the camera's `RenderLayers`. */
  renderLayers: number;
  /** Deep-copied matrices. */
  viewMatrix: Mat4;
  projectionMatrix: Mat4;
  viewProjectionMatrix: Mat4;
  /** Deep-copied translation column of `GlobalTransform`. */
  worldPosition: Vec3;
  /** Physical-pixel size of the target at extract time. */
  targetSize: { width: number; height: number };
  /** Mirrored from `Camera.subGraph`. */
  subGraph: RenderLabel;

  constructor(init: {
    sourceEntity: Entity;
    order: number;
    target: CameraRenderTarget;
    viewport: Viewport | undefined;
    clearColor: ClearColorConfig;
    renderLayers: number;
    viewMatrix: Mat4;
    projectionMatrix: Mat4;
    viewProjectionMatrix: Mat4;
    worldPosition: Vec3;
    targetSize: { width: number; height: number };
    subGraph: RenderLabel;
  }) {
    this.sourceEntity = init.sourceEntity;
    this.order = init.order;
    this.target = init.target;
    this.viewport = init.viewport;
    this.clearColor = init.clearColor;
    this.renderLayers = init.renderLayers;
    this.viewMatrix = init.viewMatrix;
    this.projectionMatrix = init.projectionMatrix;
    this.viewProjectionMatrix = init.viewProjectionMatrix;
    this.worldPosition = init.worldPosition;
    this.targetSize = init.targetSize;
    this.subGraph = init.subGraph;
  }
}

/** Slots for one camera's GPU-side view resources. */
export interface CameraGpuSlots {
  /** Backing uniform buffer for the view bind group. */
  buffer: Buffer;
  /** `@group(0)` bind group; binding 0 is the view uniform. */
  bindGroup: BindGroup;
}

/**
 * Engine-internal resource caching the layout and per-camera bind-group /
 * buffer pair for the view uniform. Keyed by main-world camera entity (stable
 * across frames; render-world entity ids are not, because the render world
 * clears every frame).
 *
 * Created lazily on the first frame a camera is extracted; not pruned in
 * Phase 2 (entities don't recycle, and per-camera GPU cost is small).
 *
 * @internal
 */
export class ViewBindGroupCache {
  /** `@group(0)` bind-group layout; allocated on first use. */
  layout: BindGroupLayout | undefined;
  /** Scratch typed-array used to upload view uniforms; sized to one `ViewUniform`. */
  readonly scratch: Float32Array = new Float32Array(VIEW_UNIFORM_FLOAT_COUNT);
  /** Per-source-entity GPU resources. */
  readonly perCamera: Map<Entity, CameraGpuSlots> = new Map();
}

/**
 * Size in bytes of the `ViewUniform` struct uploaded to each camera's view
 * bind group. Must equal the WGSL layout of {@link VIEW_UNIFORM_WGSL}.
 *
 * Layout (288 bytes):
 * - `view_proj: mat4x4<f32>` — bytes 0..64
 * - `view: mat4x4<f32>` — bytes 64..128
 * - `inverse_view: mat4x4<f32>` — bytes 128..192
 * - `projection: mat4x4<f32>` — bytes 192..256
 * - `world_position: vec4<f32>` (xyz = position, w = 0) — bytes 256..272
 * - `viewport: vec4<f32>` (x, y, width, height in physical pixels) — bytes 272..288
 */
export const VIEW_UNIFORM_BYTE_SIZE = 288 as const;

/** `VIEW_UNIFORM_BYTE_SIZE / 4` — number of `f32` slots in a {@link ViewUniformGpu} buffer. */
export const VIEW_UNIFORM_FLOAT_COUNT = VIEW_UNIFORM_BYTE_SIZE / 4;

/**
 * WGSL source for the engine's view uniform. End-user shaders that read the
 * view bind group `@import` this snippet (once the shader-preprocessor lands;
 * before then, copy-paste it).
 */
export const VIEW_UNIFORM_WGSL = /* wgsl */ `
struct ViewUniform {
  view_proj: mat4x4<f32>,
  view: mat4x4<f32>,
  inverse_view: mat4x4<f32>,
  projection: mat4x4<f32>,
  world_position: vec4<f32>,
  viewport: vec4<f32>,
};

@group(0) @binding(0) var<uniform> view: ViewUniform;
` as const;
