/**
 * WGSL for the in-game UI image pipeline: screen-space textured quads.
 *
 * Like the UI quad + text pipelines, the per-instance rect is already in clip
 * space (mapped from logical pixels on the CPU), so there is no view uniform. The
 * only bind group is the source image (`@group(0)`). The fragment samples the
 * texture at the interpolated source UV and multiplies by the per-instance tint.
 *
 * Vertex layout (two buffers, the second steps per-instance):
 *
 * | Buffer | Slot | Format    | `@location` | Step     | Field                        |
 * |--------|------|-----------|-------------|----------|------------------------------|
 * | 0      | 0    | float32x2 | 0           | vertex   | unit-quad corner (TL→BR)     |
 * | 1      | 0    | float32x4 | 1           | instance | clip rect `(l, t, r, b)`     |
 * | 1      | 1    | float32x4 | 2           | instance | source uv `(u0, v0, u1, v1)` |
 * | 1      | 2    | unorm8x4  | 3           | instance | RGBA tint                    |
 */
export const UI_IMAGE_WGSL = /* wgsl */ `
@group(0) @binding(0) var img_tex: texture_2d<f32>;
@group(0) @binding(1) var img_sampler: sampler;

struct VsIn {
  @location(0) corner: vec2<f32>,
  @location(1) rect: vec4<f32>,
  @location(2) uv_rect: vec4<f32>,
  @location(3) tint: vec4<f32>,
};

struct VsOut {
  @builtin(position) clip_position: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) tint: vec4<f32>,
};

@vertex
fn vs_main(input: VsIn) -> VsOut {
  var out: VsOut;
  let x = mix(input.rect.x, input.rect.z, input.corner.x);
  let y = mix(input.rect.y, input.rect.w, input.corner.y);
  out.clip_position = vec4<f32>(x, y, 0.0, 1.0);
  out.uv = input.uv_rect.xy + input.corner * (input.uv_rect.zw - input.uv_rect.xy);
  out.tint = input.tint;
  return out;
}

@fragment
fn fs_main(input: VsOut) -> @location(0) vec4<f32> {
  let texel = textureSample(img_tex, img_sampler, input.uv);
  return texel * input.tint;
}
` as const;
