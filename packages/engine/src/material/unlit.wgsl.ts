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
 * - `@group(1)`: material — `color: vec4f` packed at binding 0, color texture
 *   at binding 1, sampler at binding 2.
 *
 * The per-entity model matrix arrives as per-instance vertex attributes at
 * `@location(8..11)` (vertex buffer slot 1, `stepMode: 'instance'`); unlit does
 * not transform normals, so it ignores the inverse-transpose columns the
 * instance buffer also carries. Vertex slot 0 consumes the engine's standard
 * `Mesh.POSITION + NORMAL + UV_0` order (`NORMAL` is kept so `UnlitMaterial`
 * and `StandardMaterial` share one vertex-buffer shape).
 */
export const UNLIT_WGSL = /* wgsl */ `
#import retro_engine::view

struct UnlitMaterialUniform {
  color: vec4<f32>,
};
@group(1) @binding(0) var<uniform> material: UnlitMaterialUniform;
@group(1) @binding(1) var color_texture: texture_2d<f32>;
@group(1) @binding(2) var color_sampler: sampler;

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
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(input: VsIn) -> VsOut {
  var out: VsOut;
  let model = mat4x4<f32>(input.model_c0, input.model_c1, input.model_c2, input.model_c3);
  let world_position = model * vec4<f32>(input.position, 1.0);
  out.clip_position = view.view_proj * world_position;
  out.uv = input.uv;
  return out;
}

@fragment
fn fs_main(input: VsOut) -> @location(0) vec4<f32> {
  let sampled = textureSample(color_texture, color_sampler, input.uv);
  return material.color * sampled;
}

struct VsPrepassOut {
  @builtin(position) clip_position: vec4<f32>,
};

@vertex
fn vs_prepass(input: VsIn) -> VsPrepassOut {
  var out: VsPrepassOut;
  let model = mat4x4<f32>(input.model_c0, input.model_c1, input.model_c2, input.model_c3);
  let world_position = model * vec4<f32>(input.position, 1.0);
  out.clip_position = view.view_proj * world_position;
  return out;
}
` as const;
