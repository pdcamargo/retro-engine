/**
 * WGSL for 3D shadow mapping, in two pieces:
 *
 * - {@link SHADOW3D_WGSL} — the *sampling* module, registered with
 *   `ShaderRegistry` as `retro_engine::shadow3d`. Lit material shaders
 *   (`#import retro_engine::shadow3d`, after `retro_engine::light3d`) gain the
 *   shadow atlas + comparison sampler at `@group(2) @binding(1..2)` and a
 *   `shadow_factor(caster_index, world_pos)` helper that returns the lit
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

export const SHADOW3D_WGSL = /* wgsl */ `
#import retro_engine::light3d

@group(2) @binding(1) var shadow_atlas: texture_depth_2d_array;
@group(2) @binding(2) var shadow_sampler: sampler_comparison;

// Lit fraction in [0, 1] for one light at \`world_pos\`. \`caster_index\` is the
// light's shadow-atlas layer (and shadow_view_proj index), or < 0 when the
// light casts no shadow — in which case the fragment is fully lit.
//
// textureSampleCompare must run in uniform control flow, so the atlas is
// sampled unconditionally and the "no shadow" / "outside frustum" cases are
// resolved with select() afterwards rather than by branching around the call.
fn shadow_factor(caster_index: f32, world_pos: vec3<f32>) -> f32 {
  let has_shadow = caster_index >= 0.0;
  let layer = max(i32(caster_index), 0);
  let clip = lights.shadow_view_proj[layer] * vec4<f32>(world_pos, 1.0);
  let ndc = clip.xyz / clip.w;
  let uv = vec2<f32>(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
  let depth_ref = clamp(ndc.z - ${SHADOW3D_DEPTH_COMPARE_BIAS}, 0.0, 1.0);
  let sampled = textureSampleCompare(shadow_atlas, shadow_sampler, uv, layer, depth_ref);
  let inside =
    ndc.x >= -1.0 && ndc.x <= 1.0 &&
    ndc.y >= -1.0 && ndc.y <= 1.0 &&
    ndc.z >= 0.0 && ndc.z <= 1.0;
  // Outside the light's frustum (or no shadow) → fully lit.
  return select(1.0, select(1.0, sampled, inside), has_shadow);
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
