/**
 * WGSL for the screen-space motion-blur pass. A fullscreen triangle samples the
 * HDR scene along each pixel's reconstructed velocity vector and averages the
 * taps. Registered as `retro_engine::motion_blur`.
 */
export const MOTION_BLUR_WGSL = /* wgsl */ `
struct VsOut {
  @builtin(position) clip_position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VsOut {
  var out: VsOut;
  let x = f32((vertex_index << 1u) & 2u);
  let y = f32(vertex_index & 2u);
  out.clip_position = vec4<f32>(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
  out.uv = vec2<f32>(x, y);
  return out;
}

struct Params {
  samples: u32,
  velocity_scale: f32,
  max_velocity: f32,
  _pad: f32,
};

@group(0) @binding(0) var scene_tex: texture_2d<f32>;
@group(0) @binding(1) var scene_sampler: sampler;
@group(0) @binding(2) var motion_tex: texture_2d<f32>;
@group(0) @binding(3) var<uniform> params: Params;

// textureSampleLevel (explicit LOD 0) is used throughout instead of
// textureSample: the velocity early-out below introduces non-uniform control
// flow, under which implicit-LOD sampling is a uniformity violation.
@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  let center = textureSampleLevel(scene_tex, scene_sampler, in.uv, 0.0);

  // The motion target stores the half-NDC delta (prev - curr) * 0.5. Converting
  // to a UV displacement is NDC->UV scale 0.5 on X and -0.5 on Y (Y is flipped
  // between NDC and UV); the half-NDC's 0.5 and the NDC->UV 2x cancel, leaving
  // just an axis flip on Y.
  let mv = textureSampleLevel(motion_tex, scene_sampler, in.uv, 0.0).rg;
  var vel = vec2<f32>(mv.x, -mv.y) * params.velocity_scale;

  let len = length(vel);
  if (len < 1e-5) {
    return center;
  }
  if (len > params.max_velocity) {
    vel = vel * (params.max_velocity / len);
  }

  // Clamp the tap count for bounded register pressure regardless of the
  // requested sample budget.
  let n = clamp(params.samples, 1u, 32u);
  let denom = max(f32(n) - 1.0, 1.0);
  var accum = vec3<f32>(0.0);
  for (var i: u32 = 0u; i < n; i = i + 1u) {
    // Spread taps across [-vel/2, +vel/2], the shutter-open interval centered on now.
    let t = (f32(i) / denom) - 0.5;
    accum = accum + textureSampleLevel(scene_tex, scene_sampler, in.uv + vel * t, 0.0).rgb;
  }
  return vec4<f32>(accum / f32(n), center.a);
}
`;
