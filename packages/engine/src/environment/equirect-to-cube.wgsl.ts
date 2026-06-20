/**
 * WGSL converting an equirectangular 2D texture into a cubemap face, registered
 * under `retro_engine::equirect_to_cube`. One fullscreen-triangle render per
 * face (`params.data.x` selects it). The cube is the single internal
 * representation the skybox and IBL prefilter consume, so an equirectangular
 * `.hdr` becomes a regular cube source after this one-shot bake.
 */
export const EQUIRECT_TO_CUBE_WGSL = /* wgsl */ `
const PI: f32 = 3.14159265359;
const TWO_PI: f32 = 6.28318530718;

struct Params {
  // x = face index (0..5).
  data: vec4<f32>,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var equirect: texture_2d<f32>;
@group(0) @binding(2) var equirect_sampler: sampler;

struct VsOut {
  @builtin(position) clip_position: vec4<f32>,
  @location(0) ndc: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VsOut {
  let uv = vec2<f32>(f32((vertex_index << 1u) & 2u), f32(vertex_index & 2u));
  let ndc = uv * 2.0 - 1.0;
  var out: VsOut;
  out.clip_position = vec4<f32>(ndc, 0.0, 1.0);
  out.ndc = ndc;
  return out;
}

fn face_direction(face: u32, ndc: vec2<f32>) -> vec3<f32> {
  // The rasterizer already maps ndc.y = +1 to the framebuffer top (cube texel
  // row t = 0), and the cube convention puts dir.y = +1 at t = 0 — so t tracks
  // ndc.y directly (a leading negation here double-flips the result).
  let s = ndc.x;
  let t = ndc.y;
  var dir: vec3<f32>;
  switch face {
    case 0u: { dir = vec3<f32>( 1.0,    t,  -s); } // +X
    case 1u: { dir = vec3<f32>(-1.0,    t,   s); } // -X
    case 2u: { dir = vec3<f32>(   s,  1.0,  -t); } // +Y
    case 3u: { dir = vec3<f32>(   s, -1.0,   t); } // -Y
    case 4u: { dir = vec3<f32>(   s,    t, 1.0); }  // +Z
    default: { dir = vec3<f32>(  -s,    t,-1.0); }  // -Z
  }
  return normalize(dir);
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  let dir = face_direction(u32(params.data.x), in.ndc);
  // Equirectangular lookup: longitude from atan2(z, x), latitude from the
  // up-component. v = 0 is the top row (+Y), matching a top-left-origin image.
  let u = atan2(dir.z, dir.x) / TWO_PI + 0.5;
  let v = acos(clamp(dir.y, -1.0, 1.0)) / PI;
  return vec4<f32>(textureSampleLevel(equirect, equirect_sampler, vec2<f32>(u, v), 0.0).rgb, 1.0);
}
` as const;
