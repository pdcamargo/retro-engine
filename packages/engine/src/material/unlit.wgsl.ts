/**
 * WGSL source for {@link UnlitMaterial}.
 *
 * Registered with `ShaderRegistry` under `retro_engine::unlit_vertex` and
 * `retro_engine::unlit_fragment` at plugin build time. The two stages share
 * one module — both `vs_main` and `fs_main` live here.
 *
 * Bind groups:
 *
 * - `@group(0)`: view uniform (auto-bound by the Core3d phase node). Imported
 *   via `#import retro_engine::view`.
 * - `@group(1)`: per-entity model + inverse-transpose-model.
 * - `@group(2)`: material — `color: vec4f` packed at binding 0, color texture
 *   at binding 1, sampler at binding 2.
 *
 * Vertex layout consumes the engine's standard `Mesh.POSITION + NORMAL + UV_0`
 * attribute order. `NORMAL` is unused by the fragment but kept in the layout
 * so `UnlitMaterial` and `StandardMaterial` share a single vertex-buffer
 * shape.
 */
export const UNLIT_WGSL = /* wgsl */ `
#import retro_engine::view

struct EntityTransform {
  model: mat4x4<f32>,
  inverse_transpose_model: mat4x4<f32>,
};
@group(1) @binding(0) var<uniform> entity: EntityTransform;

struct UnlitMaterialUniform {
  color: vec4<f32>,
};
@group(2) @binding(0) var<uniform> material: UnlitMaterialUniform;
@group(2) @binding(1) var color_texture: texture_2d<f32>;
@group(2) @binding(2) var color_sampler: sampler;

struct VsIn {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
};

struct VsOut {
  @builtin(position) clip_position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(input: VsIn) -> VsOut {
  var out: VsOut;
  let world_position = entity.model * vec4<f32>(input.position, 1.0);
  out.clip_position = view.view_proj * world_position;
  out.uv = input.uv;
  return out;
}

@fragment
fn fs_main(input: VsOut) -> @location(0) vec4<f32> {
  let sampled = textureSample(color_texture, color_sampler, input.uv);
  return material.color * sampled;
}
` as const;
