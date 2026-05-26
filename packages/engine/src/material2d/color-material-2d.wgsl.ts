/**
 * WGSL source for {@link ColorMaterial2d}.
 *
 * Registered with `ShaderRegistry` under `retro_engine::color_material_2d`
 * at plugin build time. Both `vs_main` and `fs_main` live in one module.
 *
 * Bind groups:
 *
 * - `@group(0)`: view uniform (auto-bound by the Core2d phase node). Imported
 *   via `#import retro_engine::view`.
 * - `@group(1)`: material — packed UBO with `color: vec4f` at offset 0 and
 *   `alpha_cutoff: f32` at offset 16.
 *
 * The per-entity model matrix arrives as per-instance vertex attributes at
 * `@location(8..11)` (vertex buffer slot 1, `stepMode: 'instance'`); 2D ignores
 * the inverse-transpose columns the instance buffer also carries. Vertex slot 0
 * consumes the engine's standard `Mesh.POSITION + NORMAL + UV_0` order — every
 * 2D primitive (Rectangle / Circle / RegularPolygon) emits this shape;
 * `NORMAL` and `UV_0` are unused by the fragment but declared so the vertex
 * layout matches all primitives.
 *
 * The fragment branch on `alpha_cutoff` is uniform control flow — the GPU
 * evaluates the condition once per draw, not once per pixel. Mask-mode
 * materials set `alpha_cutoff` to their threshold; opaque and blend modes
 * leave it at 0 so the branch is skipped.
 */
export const COLOR_MATERIAL_2D_WGSL = /* wgsl */ `
#import retro_engine::view

struct ColorMaterial2dUniform {
  color: vec4<f32>,
  alpha_cutoff: f32,
};
@group(1) @binding(0) var<uniform> material: ColorMaterial2dUniform;

struct VsIn {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
  @location(8) model_c0: vec4<f32>,
  @location(9) model_c1: vec4<f32>,
  @location(10) model_c2: vec4<f32>,
  @location(11) model_c3: vec4<f32>,
};

struct VsOut {
  @builtin(position) clip_position: vec4<f32>,
};

@vertex
fn vs_main(input: VsIn) -> VsOut {
  var out: VsOut;
  let model = mat4x4<f32>(input.model_c0, input.model_c1, input.model_c2, input.model_c3);
  let world_position = model * vec4<f32>(input.position, 1.0);
  out.clip_position = view.view_proj * world_position;
  return out;
}

@fragment
fn fs_main(_in: VsOut) -> @location(0) vec4<f32> {
  if (material.alpha_cutoff > 0.0 && material.color.a < material.alpha_cutoff) {
    discard;
  }
  return material.color;
}
` as const;
