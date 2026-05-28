/**
 * Shared WGSL module for the screen-space prepass family. Registered with
 * `ShaderRegistry` under `retro_engine::prepass` by `PrepassPlugin`.
 *
 * Provides:
 *
 * - `encode_normal_roughness(world_normal, roughness)` — pack a unit
 *   world-space normal into `.rgb` (mapped from `[-1, 1]` to `[0, 1]`) plus
 *   roughness in `.a`. The target is `rgba16float`, so the encode is
 *   conservative — half precision is sufficient for downstream consumers
 *   (TAA history clipping, SSAO surface response).
 *
 * - `compute_motion_vector(prev_clip, curr_clip)` — return the half-NDC
 *   delta `(prev - curr) * 0.5`. Reprojection consumers add this to the
 *   current pixel's NDC to find the previous frame's sample. Half-NDC
 *   matches the convention TAA implementations expect after a `* 0.5`
 *   bake-in on the producer side.
 *
 * No bindings; this module is `#import`-only. The fragment-output struct
 * lives in the consuming material's shader (each material decides its own
 * `#ifdef` mix of outputs); the helpers here are pure functions.
 */
export const PREPASS_WGSL = /* wgsl */ `
fn encode_normal_roughness(world_normal: vec3<f32>, roughness: f32) -> vec4<f32> {
  let n = normalize(world_normal);
  return vec4<f32>(n * 0.5 + vec3<f32>(0.5), roughness);
}

fn compute_motion_vector(prev_clip: vec4<f32>, curr_clip: vec4<f32>) -> vec2<f32> {
  let prev_ndc = prev_clip.xy / max(abs(prev_clip.w), 0.0001) * sign(prev_clip.w);
  let curr_ndc = curr_clip.xy / max(abs(curr_clip.w), 0.0001) * sign(curr_clip.w);
  return (prev_ndc - curr_ndc) * 0.5;
}
` as const;
