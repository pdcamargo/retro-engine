/**
 * WGSL source for the engine's 2D light accumulation pipeline. Registered with
 * `ShaderRegistry` under `retro_engine::light2d_accumulation` at plugin build
 * time.
 *
 * Bind groups:
 *
 * - `@group(0)`: view uniform — imported via `#import retro_engine::view`.
 *   Auto-bound by the accumulation pass node before any draw.
 *
 * Vertex layout (two buffers; the second steps per-instance):
 *
 * | Buffer | Slot | Format    | `@location` | Step      | Field                              |
 * |--------|------|-----------|-------------|-----------|------------------------------------|
 * | 0      | 0    | float32x2 | 0           | vertex    | unit-quad UV `[0, 1]²`             |
 * | 1      | 0    | float32x4 | 2           | instance  | `center.xy + range + radius`       |
 * | 1      | 1    | float32x4 | 3           | instance  | `color.rgb + intensity`            |
 *
 * Vertex shader places each per-instance quad as an axis-aligned square of
 * side `2 * range` centred on the light's world position; beyond `range` the
 * falloff is zero, so a tighter footprint clips empty fragments.
 *
 * Fragment shader computes `falloff = 1.0 - smoothstep(radius, range, d)`
 * where `d` is the world-space distance from the fragment to the light's
 * centre. Inside `radius` the light is at full brightness; between `radius`
 * and `range` it ramps smoothly to zero. The light's RGB tint times its
 * intensity is multiplied by the falloff and emitted at full alpha — the
 * pipeline's additive blend (`One/One`) sums contributions from overlapping
 * lights into the per-camera `lightAccum` target.
 */
export const LIGHT2D_ACCUMULATION_WGSL = /* wgsl */ `
#import retro_engine::view

struct VsIn {
  @location(0) quad_uv: vec2<f32>,
  @location(2) instance_a: vec4<f32>,
  @location(3) instance_b: vec4<f32>,
};

struct VsOut {
  @builtin(position) clip_position: vec4<f32>,
  @location(0) world_pos: vec2<f32>,
  @location(1) light_center: vec2<f32>,
  @location(2) light_params: vec2<f32>,
  @location(3) light_color: vec3<f32>,
  @location(4) light_intensity: f32,
};

@vertex
fn vs_main(input: VsIn) -> VsOut {
  var out: VsOut;
  let center = input.instance_a.xy;
  let range = input.instance_a.z;
  let radius = input.instance_a.w;
  let local = (input.quad_uv * 2.0 - vec2<f32>(1.0, 1.0)) * range;
  let world_xy = center + local;
  let world_pos = vec4<f32>(world_xy.x, world_xy.y, 0.0, 1.0);
  out.clip_position = view.view_proj * world_pos;
  out.world_pos = world_xy;
  out.light_center = center;
  out.light_params = vec2<f32>(range, radius);
  out.light_color = input.instance_b.rgb;
  out.light_intensity = input.instance_b.a;
  return out;
}

@fragment
fn fs_main(input: VsOut) -> @location(0) vec4<f32> {
  let d = distance(input.world_pos, input.light_center);
  let range = input.light_params.x;
  let radius = input.light_params.y;
  let falloff = 1.0 - smoothstep(radius, range, d);
  let lit = input.light_color * input.light_intensity * falloff;
  return vec4<f32>(lit, 1.0);
}
` as const;
