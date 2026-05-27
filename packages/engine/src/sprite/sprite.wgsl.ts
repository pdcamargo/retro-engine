/**
 * WGSL source for the engine's built-in sprite pipeline. Registered with
 * `ShaderRegistry` under `retro_engine::sprite` at plugin build time.
 *
 * Bind groups:
 *
 * - `@group(0)`: view uniform (auto-bound by the Core2d phase node). Imported
 *   via `#import retro_engine::view`.
 * - `@group(1)`: per-image bind group — `sprite_tex` at binding 0,
 *   `sprite_sampler` at binding 1. Owned by {@link SpritePipeline}'s per-image
 *   `BindGroup` cache; rebound per batch by the queue system's draw closure.
 *
 * Vertex layout (two buffers, the second steps per-instance):
 *
 * | Buffer | Slot | Format    | `@location` | Step      | Field                       |
 * |--------|------|-----------|-------------|-----------|-----------------------------|
 * | 0      | 0    | float32x2 | 0           | vertex    | unit-quad UV                |
 * | 1      | 0    | float32x4 | 2           | instance  | `center.xy` + `basisX.xy`   |
 * | 1      | 1    | float32x4 | 3           | instance  | `basisY.xy` + `uvMin.xy`    |
 * | 1      | 2    | float32x2 | 4           | instance  | `uvMax.xy`                  |
 * | 1      | 3    | unorm8x4  | 5           | instance  | RGBA tint                   |
 *
 * Vertex shader composes world position as
 * `center + uv.x * basisX + uv.y * basisY` and source UV as
 * `uvMin + uv * (uvMax - uvMin)`. `fs_main` samples and multiplies by tint;
 * `fs_normal` reinterprets the bound `@group(1)` texture as a tangent-space
 * normal map and writes the (re-encoded) world normal — used by the 2D
 * lighting normal prepass, which reuses this module's `vs_main`.
 */
export const SPRITE_WGSL = /* wgsl */ `
#import retro_engine::view

@group(1) @binding(0) var sprite_tex: texture_2d<f32>;
@group(1) @binding(1) var sprite_sampler: sampler;

struct VsIn {
  @location(0) quad_uv: vec2<f32>,
  @location(2) instance_a: vec4<f32>,
  @location(3) instance_b: vec4<f32>,
  @location(4) instance_uv_max: vec2<f32>,
  @location(5) instance_color: vec4<f32>,
};

struct VsOut {
  @builtin(position) clip_position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) tint: vec4<f32>,
};

@vertex
fn vs_main(input: VsIn) -> VsOut {
  var out: VsOut;
  let center = input.instance_a.xy;
  let basis_x = input.instance_a.zw;
  let basis_y = input.instance_b.xy;
  let uv_min = input.instance_b.zw;
  let uv_max = input.instance_uv_max;

  let world_pos2 = center + input.quad_uv.x * basis_x + input.quad_uv.y * basis_y;
  let world_pos = vec4<f32>(world_pos2.x, world_pos2.y, 0.0, 1.0);
  out.clip_position = view.view_proj * world_pos;
  out.uv = uv_min + input.quad_uv * (uv_max - uv_min);
  out.tint = input.instance_color;
  return out;
}

@fragment
fn fs_main(input: VsOut) -> @location(0) vec4<f32> {
  let sampled = textureSample(sprite_tex, sprite_sampler, input.uv);
  return sampled * input.tint;
}

@fragment
fn fs_normal(input: VsOut) -> @location(0) vec4<f32> {
  // Decode the tangent-space normal map (rgb in [0,1] -> [-1,1]). v1 treats
  // tangent space as world space (sprite rotation is not applied), then
  // re-encodes to [0,1] for the rgba8unorm normal buffer.
  let n = normalize(textureSample(sprite_tex, sprite_sampler, input.uv).xyz * 2.0 - 1.0);
  return vec4<f32>(n * 0.5 + 0.5, 1.0);
}
` as const;
