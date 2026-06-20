/**
 * Default WGSL for the skybox pass, registered with `ShaderRegistry` under
 * `retro_engine::skybox` at plugin build time.
 *
 * The pass draws one fullscreen triangle at the far plane (clip `z = w`, so the
 * post-divide depth is `1.0`). With the pipeline's `depthCompare: 'less-equal'`
 * and `depthWriteEnabled: false`, the sky survives only where no opaque
 * fragment wrote a nearer depth — geometry occludes it for free, and the sky
 * never blocks later passes.
 *
 * The per-pixel world ray is reconstructed from the projection's focal terms
 * (`projection[0][0]` / `projection[1][1]`) and the camera's `inverse_view`,
 * which avoids materializing an inverse-projection matrix for the common
 * perspective case. The result is rotated by the skybox's own rotation matrix
 * before sampling the cube.
 *
 * To replace the look (gradient, stars, procedural sky) without forking the
 * engine, register a different module name and pass it to `SkyboxPlugin`, or
 * re-register this name with your own source. A replacement must keep the
 * `@group(0)` view binding, the `@group(1)` layout (uniform + cube texture +
 * sampler), and the `vs_main` / `fs_main` entry points.
 */
export const SKYBOX_WGSL = /* wgsl */ `
#import retro_engine::view

struct SkyboxUniform {
  // World-space rotation applied to the sampling direction.
  rotation: mat4x4<f32>,
  // x = brightness multiplier; y/z/w reserved.
  params: vec4<f32>,
};

@group(1) @binding(0) var<uniform> skybox: SkyboxUniform;
@group(1) @binding(1) var sky_texture: texture_cube<f32>;
@group(1) @binding(2) var sky_sampler: sampler;

struct VsOut {
  @builtin(position) clip_position: vec4<f32>,
  @location(0) ndc: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VsOut {
  // Fullscreen triangle: vertices (0,0), (2,0), (0,2) in UV → (-1,-1), (3,-1),
  // (-1,3) in NDC, covering the whole viewport with one primitive.
  let uv = vec2<f32>(f32((vertex_index << 1u) & 2u), f32(vertex_index & 2u));
  let ndc = uv * 2.0 - 1.0;
  var out: VsOut;
  out.clip_position = vec4<f32>(ndc, 1.0, 1.0);
  out.ndc = ndc;
  return out;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  // View-space ray for this pixel. The camera looks down -Z in view space; the
  // focal terms undo the perspective scale so the ray points through the pixel.
  let dir_view = vec3<f32>(
    in.ndc.x / view.projection[0][0],
    in.ndc.y / view.projection[1][1],
    -1.0,
  );
  let dir_world = normalize((view.inverse_view * vec4<f32>(dir_view, 0.0)).xyz);
  let dir = (skybox.rotation * vec4<f32>(dir_world, 0.0)).xyz;
  let color = textureSample(sky_texture, sky_sampler, dir).rgb * skybox.params.x;
  return vec4<f32>(color, 1.0);
}
` as const;
