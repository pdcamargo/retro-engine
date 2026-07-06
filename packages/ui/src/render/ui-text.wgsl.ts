/**
 * WGSL for the in-game UI text pipeline: screen-space MSDF glyph quads.
 *
 * Like the UI quad pipeline, the per-instance rect is already in clip space
 * (mapped from logical pixels on the CPU), so there is no view uniform. The only
 * bind group is the glyph atlas (`@group(0)`). The fragment reconstructs a crisp
 * edge from the multi-channel signed distance field (median of RGB, scaled to
 * screen pixels via `unitRange` and `fwidth`), matching the engine text shader.
 *
 * Vertex layout (two buffers, the second steps per-instance):
 *
 * | Buffer | Slot | Format    | `@location` | Step     | Field                        |
 * |--------|------|-----------|-------------|----------|------------------------------|
 * | 0      | 0    | float32x2 | 0           | vertex   | unit-quad corner (TL→BR)     |
 * | 1      | 0    | float32x4 | 1           | instance | clip rect `(l, t, r, b)`     |
 * | 1      | 1    | float32x4 | 2           | instance | atlas uv `(u0, v0, u1, v1)`  |
 * | 1      | 2    | float32x2 | 3           | instance | `unitRange.xy`               |
 * | 1      | 3    | unorm8x4  | 4           | instance | RGBA fill                    |
 */
export const UI_TEXT_WGSL = /* wgsl */ `
@group(0) @binding(0) var text_tex: texture_2d<f32>;
@group(0) @binding(1) var text_sampler: sampler;

struct VsIn {
  @location(0) corner: vec2<f32>,
  @location(1) rect: vec4<f32>,
  @location(2) uv_rect: vec4<f32>,
  @location(3) unit_range: vec2<f32>,
  @location(4) color: vec4<f32>,
};

struct VsOut {
  @builtin(position) clip_position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) unit_range: vec2<f32>,
  @location(2) color: vec4<f32>,
};

@vertex
fn vs_main(input: VsIn) -> VsOut {
  var out: VsOut;
  let x = mix(input.rect.x, input.rect.z, input.corner.x);
  let y = mix(input.rect.y, input.rect.w, input.corner.y);
  out.clip_position = vec4<f32>(x, y, 0.0, 1.0);
  out.uv = input.uv_rect.xy + input.corner * (input.uv_rect.zw - input.uv_rect.xy);
  out.unit_range = input.unit_range;
  out.color = input.color;
  return out;
}

fn median3(v: vec3<f32>) -> f32 {
  return max(min(v.r, v.g), min(max(v.r, v.g), v.b));
}

@fragment
fn fs_main(input: VsOut) -> @location(0) vec4<f32> {
  let msd = textureSample(text_tex, text_sampler, input.uv).rgb;
  let sd = median3(msd);
  let screen_tex_size = vec2<f32>(1.0) / fwidth(input.uv);
  let screen_px_range = max(0.5 * dot(input.unit_range, screen_tex_size), 1.0);
  let coverage = clamp(screen_px_range * (sd - 0.5) + 0.5, 0.0, 1.0);
  return vec4<f32>(input.color.rgb, input.color.a * coverage);
}
` as const;
