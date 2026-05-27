/**
 * WGSL for 3D shadow mapping, in two pieces:
 *
 * - {@link SHADOW3D_WGSL} — the *sampling* module, registered with
 *   `ShaderRegistry` as `retro_engine::shadow3d`. Lit material shaders
 *   (`#import retro_engine::shadow3d`, after `retro_engine::light3d`) gain the
 *   shadow atlas + comparison sampler at `@group(2) @binding(1..2)`, a
 *   `shadow_factor(caster_index, world_pos)` helper for single-map (spot)
 *   shadows, and a `directional_shadow_factor(base_index, world_pos, view_z)`
 *   helper that selects a cascade by view-space depth. Both return the lit
 *   fraction `[0, 1]` for one light at one fragment.
 * - {@link SHADOW3D_DEPTH_WGSL} — the standalone *depth-render* shader for the
 *   shadow pass. Vertex-only (no fragment stage): it transforms mesh positions
 *   by a per-light light-space view-projection at its own `@group(0)`, writing
 *   depth into one atlas layer. Compiled directly by `Shadow3dState`; **not**
 *   imported by material shaders (its `@group(0)` would collide with the view
 *   uniform).
 */

/**
 * Comparison bias subtracted from the fragment's light-space depth before the
 * shadow test, in normalized depth units. Combined with the pipeline's
 * `depthBias` / `depthBiasSlopeScale`, it suppresses self-shadow acne. A
 * compile-time constant in this stage; promote to a uniform if runtime tuning
 * is needed.
 */
const SHADOW3D_DEPTH_COMPARE_BIAS = '0.0015';

/**
 * Fraction of a cascade's far distance over which it cross-fades into the next,
 * softening the seam at a cascade boundary. A compile-time constant in this
 * stage; the per-light `CascadeShadowConfig.overlapProportion` is the runtime
 * hook once it is uploaded. Set to `0.0` for hard cascade selection.
 */
const SHADOW3D_CASCADE_BLEND = '0.1';

export const SHADOW3D_WGSL = /* wgsl */ `
#import retro_engine::light3d

@group(2) @binding(1) var shadow_atlas: texture_depth_2d_array;
@group(2) @binding(2) var shadow_sampler: sampler_comparison;

// Comparison-sample one atlas \`layer\` at \`world_pos\`, returning the lit fraction
// [0, 1]; fragments outside that layer's light frustum read as fully lit.
//
// textureSampleCompare must run in uniform control flow, so the atlas is sampled
// unconditionally (the array layer index may vary per fragment) and the
// "outside frustum" case is resolved with select() rather than a branch.
fn sample_cascade(layer: i32, world_pos: vec3<f32>) -> f32 {
  let clip = lights.shadow_view_proj[layer] * vec4<f32>(world_pos, 1.0);
  let ndc = clip.xyz / clip.w;
  let uv = vec2<f32>(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
  let depth_ref = clamp(ndc.z - ${SHADOW3D_DEPTH_COMPARE_BIAS}, 0.0, 1.0);
  let sampled = textureSampleCompare(shadow_atlas, shadow_sampler, uv, layer, depth_ref);
  let inside =
    ndc.x >= -1.0 && ndc.x <= 1.0 &&
    ndc.y >= -1.0 && ndc.y <= 1.0 &&
    ndc.z >= 0.0 && ndc.z <= 1.0;
  return select(1.0, sampled, inside);
}

// Lit fraction for a single-map (spot) shadow. \`caster_index\` is the light's
// shadow-atlas layer, or < 0 when the light casts no shadow (→ fully lit).
fn shadow_factor(caster_index: f32, world_pos: vec3<f32>) -> f32 {
  let has_shadow = caster_index >= 0.0;
  let layer = max(i32(caster_index), 0);
  return select(1.0, sample_cascade(layer, world_pos), has_shadow);
}

// Lit fraction for a cascaded (directional) shadow. \`base_index\` is the light's
// base atlas layer (cascade c occupies layer base + c), or < 0 when it casts no
// shadow. \`view_z\` is the fragment's camera view-space depth (positive, into the
// scene): the cascade whose far edge first exceeds it is selected, with a small
// cross-fade into the next cascade near the seam.
fn directional_shadow_factor(base_index: f32, world_pos: vec3<f32>, view_z: f32) -> f32 {
  let has_shadow = base_index >= 0.0;
  let base = max(i32(base_index), 0);
  let count = max(i32(lights.counts.w), 1);

  var splits = array<f32, 4>(
    lights.cascade_splits.x,
    lights.cascade_splits.y,
    lights.cascade_splits.z,
    lights.cascade_splits.w,
  );

  var c = 0;
  if (view_z > splits[0]) { c = 1; }
  if (view_z > splits[1]) { c = 2; }
  if (view_z > splits[2]) { c = 3; }
  c = min(c, count - 1);
  let next = min(c + 1, count - 1);

  // Sample this cascade and the next unconditionally (uniform control flow);
  // blend across a band near this cascade's far edge.
  let f_c = sample_cascade(base + c, world_pos);
  let f_next = sample_cascade(base + next, world_pos);
  let far_c = splits[c];
  let band = max(far_c * ${SHADOW3D_CASCADE_BLEND}, 1e-4);
  let w = clamp((far_c - view_z) / band, 0.0, 1.0);
  return select(1.0, mix(f_next, f_c, w), has_shadow);
}
` as const;

export const SHADOW3D_DEPTH_WGSL = /* wgsl */ `
struct ShadowView {
  view_proj: mat4x4<f32>,
};
@group(0) @binding(0) var<uniform> shadow_view: ShadowView;

struct VsIn {
  @location(0) position: vec3<f32>,
  @location(8) model_c0: vec4<f32>,
  @location(9) model_c1: vec4<f32>,
  @location(10) model_c2: vec4<f32>,
  @location(11) model_c3: vec4<f32>,
};

@vertex
fn vs_main(in: VsIn) -> @builtin(position) vec4<f32> {
  let model = mat4x4<f32>(in.model_c0, in.model_c1, in.model_c2, in.model_c3);
  return shadow_view.view_proj * model * vec4<f32>(in.position, 1.0);
}
` as const;
