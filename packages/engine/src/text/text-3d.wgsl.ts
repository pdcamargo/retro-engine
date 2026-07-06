/**
 * WGSL for the engine's world-space (3D) MSDF text pipeline. Registered with
 * `ShaderRegistry` under `retro_engine::text3d` at plugin build time.
 *
 * Like the 2D text shader it imports the camera view uniform (`@group(0)`, bound
 * by the Core3d transparent pass) and samples a per-font atlas (`@group(1)`). The
 * difference is the vertex transform: the per-instance glyph center + both quad
 * basis vectors are **3D** (baked from the entity's `GlobalTransform` on the CPU),
 * composed as `center + quad_uv.x * basisX + quad_uv.y * basisY` and projected by
 * the 3D `view_proj` with the real world `z` — so text lives in the scene and is
 * depth-tested. The fragment path (median-of-RGB MSDF, screen-px-range AA) is
 * identical to the 2D shader.
 *
 * Vertex layout (two buffers, the second per-instance; 68-byte stride):
 *
 * | Slot | Format    | `@location` | Field                          |
 * |------|-----------|-------------|--------------------------------|
 * | 0    | float32x2 | 0           | unit-quad UV                   |
 * | 1    | float32x4 | 2           | `center.xyz` + `unitRange.x`   |
 * | 1    | float32x4 | 3           | `basisX.xyz` + `unitRange.y`   |
 * | 1    | float32x4 | 4           | `basisY.xyz` + pad             |
 * | 1    | float32x4 | 5           | `uvMin.xy` + `uvMax.xy`        |
 * | 1    | unorm8x4  | 6           | RGBA tint                      |
 */
export const TEXT3D_WGSL = /* wgsl */ `
#import retro_engine::view

@group(1) @binding(0) var text_tex: texture_2d<f32>;
@group(1) @binding(1) var text_sampler: sampler;

struct VsIn {
  @location(0) quad_uv: vec2<f32>,
  @location(2) instance_a: vec4<f32>,
  @location(3) instance_b: vec4<f32>,
  @location(4) instance_c: vec4<f32>,
  @location(5) instance_uv: vec4<f32>,
  @location(6) instance_color: vec4<f32>,
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
  let center = input.instance_a.xyz;
  let basis_x = input.instance_b.xyz;
  let basis_y = input.instance_c.xyz;
  let unit_range = vec2<f32>(input.instance_a.w, input.instance_b.w);
  let uv_min = input.instance_uv.xy;
  let uv_max = input.instance_uv.zw;

  let world_pos = center + input.quad_uv.x * basis_x + input.quad_uv.y * basis_y;
  out.clip_position = view.view_proj * vec4<f32>(world_pos, 1.0);
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
  let screen_tex_size = vec2<f32>(1.0) / fwidth(input.uv);
  let screen_px_range = max(0.5 * dot(input.unit_range, screen_tex_size), 1.0);
  let coverage = clamp(screen_px_range * (sd - 0.5) + 0.5, 0.0, 1.0);
  return vec4<f32>(input.tint.rgb, input.tint.a * coverage);
}
` as const;
