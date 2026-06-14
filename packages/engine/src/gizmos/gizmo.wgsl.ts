/**
 * WGSL for the gizmo line pass.
 *
 * Registered with `ShaderRegistry` under `retro_engine::gizmo` at plugin build
 * time. One module, both stages. Vertices are world-space line endpoints carried
 * in the per-vertex buffer; the vertex stage transforms them to clip space with
 * the `@group(0)` view uniform (imported via `#import retro_engine::view`) and
 * the fragment stage emits the interpolated vertex color unchanged.
 */
export const GIZMO_WGSL = /* wgsl */ `
#import retro_engine::view

struct VsIn {
  @location(0) position: vec3<f32>,
  @location(1) color: vec4<f32>,
};

struct VsOut {
  @builtin(position) clip_position: vec4<f32>,
  @location(0) color: vec4<f32>,
};

@vertex
fn vs_main(input: VsIn) -> VsOut {
  var out: VsOut;
  out.clip_position = view.view_proj * vec4<f32>(input.position, 1.0);
  out.color = input.color;
  return out;
}

@fragment
fn fs_main(input: VsOut) -> @location(0) vec4<f32> {
  return input.color;
}
` as const;
