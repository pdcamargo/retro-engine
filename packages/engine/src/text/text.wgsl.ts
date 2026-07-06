/**
 * WGSL source for the engine's built-in MSDF text pipeline. Registered with
 * `ShaderRegistry` under `retro_engine::text` at plugin build time.
 *
 * Bind groups:
 *
 * - `@group(0)`: view uniform (auto-bound by the Core2d phase node). Imported
 *   via `#import retro_engine::view`.
 * - `@group(1)`: per-font atlas bind group — `text_tex` at binding 0,
 *   `text_sampler` at binding 1 (a filtering sampler; MSDF relies on bilinear
 *   interpolation of the distance field).
 *
 * Vertex layout (two buffers, the second steps per-instance):
 *
 * | Buffer | Slot | Format    | `@location` | Step     | Field                       |
 * |--------|------|-----------|-------------|----------|-----------------------------|
 * | 0      | 0    | float32x2 | 0           | vertex   | unit-quad UV                |
 * | 1      | 0    | float32x4 | 2           | instance | `center.xy` + `basisX.xy`   |
 * | 1      | 1    | float32x4 | 3           | instance | `basisY.xy` + `uvMin.xy`    |
 * | 1      | 2    | float32x4 | 4           | instance | `uvMax.xy` + `unitRange.xy` |
 * | 1      | 3    | unorm8x4  | 5           | instance | RGBA tint                   |
 *
 * The fragment shader reconstructs a crisp edge from the multi-channel signed
 * distance field: the median of the RGB channels is the signed distance, scaled
 * into screen pixels via the atlas's `distanceRange` (`unitRange`) and the
 * screen-space derivative of the texture coordinate, then thresholded at 0.5 for
 * a resolution-independent antialiased coverage. Output is straight-alpha
 * (`tint.rgb`, `tint.a * coverage`) to match the transparent 2D blend state.
 */
export const TEXT_WGSL = /* wgsl */ `
#import retro_engine::view

@group(1) @binding(0) var text_tex: texture_2d<f32>;
@group(1) @binding(1) var text_sampler: sampler;

struct VsIn {
  @location(0) quad_uv: vec2<f32>,
  @location(2) instance_a: vec4<f32>,
  @location(3) instance_b: vec4<f32>,
  @location(4) instance_c: vec4<f32>,
  @location(5) instance_color: vec4<f32>,
};

struct VsOut {
  @builtin(position) clip_position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) unit_range: vec2<f32>,
  @location(2) tint: vec4<f32>,
};

@vertex
fn vs_main(input: VsIn) -> VsOut {
  var out: VsOut;
  let center = input.instance_a.xy;
  let basis_x = input.instance_a.zw;
  let basis_y = input.instance_b.xy;
  let uv_min = input.instance_b.zw;
  let uv_max = input.instance_c.xy;
  let unit_range = input.instance_c.zw;

  let world_pos2 = center + input.quad_uv.x * basis_x + input.quad_uv.y * basis_y;
  out.clip_position = view.view_proj * vec4<f32>(world_pos2.x, world_pos2.y, 0.0, 1.0);
  out.uv = uv_min + input.quad_uv * (uv_max - uv_min);
  out.unit_range = unit_range;
  out.tint = input.instance_color;
  return out;
}

fn median3(v: vec3<f32>) -> f32 {
  return max(min(v.r, v.g), min(max(v.r, v.g), v.b));
}

@fragment
fn fs_main(input: VsOut) -> @location(0) vec4<f32> {
  let msd = textureSample(text_tex, text_sampler, input.uv).rgb;
  let sd = median3(msd);
  // Distance range expressed in screen pixels at this fragment. fwidth(uv) is
  // the per-pixel UV change; 1/fwidth is screen pixels per UV unit.
  let screen_tex_size = vec2<f32>(1.0) / fwidth(input.uv);
  let screen_px_range = max(0.5 * dot(input.unit_range, screen_tex_size), 1.0);
  let coverage = clamp(screen_px_range * (sd - 0.5) + 0.5, 0.0, 1.0);
  return vec4<f32>(input.tint.rgb, input.tint.a * coverage);
}
` as const;
