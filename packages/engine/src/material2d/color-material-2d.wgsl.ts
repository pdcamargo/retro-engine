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
 * - `@group(1)`: per-entity model + inverse-transpose-model. The 2D fragment
 *   shader does not consume the inverse-transpose, but the struct shape
 *   matches the engine's shared `EntityTransformGpuCache` 128-byte UBO so the
 *   cache can be reused across 2D and 3D meshes.
 * - `@group(2)`: material — packed UBO with `color: vec4f` at offset 0 and
 *   `alpha_cutoff: f32` at offset 16.
 *
 * Vertex layout consumes the engine's standard `Mesh.POSITION + NORMAL + UV_0`
 * attribute order — every Phase 6 2D primitive (Rectangle / Circle /
 * RegularPolygon) emits this shape. `NORMAL` and `UV_0` are unused by the
 * fragment but declared so the vertex layout matches all primitives.
 *
 * The fragment branch on `alpha_cutoff` is uniform control flow — the GPU
 * evaluates the condition once per draw, not once per pixel. Mask-mode
 * materials set `alpha_cutoff` to their threshold; opaque and blend modes
 * leave it at 0 so the branch is skipped.
 */
export const COLOR_MATERIAL_2D_WGSL = /* wgsl */ `
#import retro_engine::view

struct EntityTransform {
  model: mat4x4<f32>,
  inverse_transpose_model: mat4x4<f32>,
};
@group(1) @binding(0) var<uniform> entity: EntityTransform;

struct ColorMaterial2dUniform {
  color: vec4<f32>,
  alpha_cutoff: f32,
};
@group(2) @binding(0) var<uniform> material: ColorMaterial2dUniform;

struct VsIn {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
};

struct VsOut {
  @builtin(position) clip_position: vec4<f32>,
};

@vertex
fn vs_main(input: VsIn) -> VsOut {
  var out: VsOut;
  let world_position = entity.model * vec4<f32>(input.position, 1.0);
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
