/**
 * WGSL for the temporal anti-aliasing resolve. A fullscreen triangle blends the
 * current (sub-pixel jittered) HDR scene against the previous resolved frame,
 * reprojected along each pixel's motion vector. Registered as `retro_engine::taa`.
 *
 * Two pieces keep it stable in HDR:
 *
 * - **Neighborhood variance clipping** (Salvi) in YCoCg space rejects stale
 *   history: the reprojected sample is clipped into the color box of the current
 *   3×3 neighborhood, so geometry that moved or was disoccluded cannot ghost.
 * - **Karis tonemap-weighted blend** weights each sample by `1/(1+luma)` before
 *   averaging, which suppresses the firefly trails a naive linear-HDR blend
 *   leaves behind.
 */
export const TAA_WGSL = /* wgsl */ `
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
  blend: f32,
  reset: u32,
  _pad0: f32,
  _pad1: f32,
};

@group(0) @binding(0) var scene_tex: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var history_tex: texture_2d<f32>;
@group(0) @binding(3) var motion_tex: texture_2d<f32>;
@group(0) @binding(4) var<uniform> params: Params;

// Width of the neighborhood color box in standard deviations. ~1 is the usual
// trade-off: tighter ghosts less but flickers more, wider is the reverse.
const VARIANCE_GAMMA: f32 = 1.25;

fn luma(c: vec3<f32>) -> f32 {
  return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}

fn rgb_to_ycocg(c: vec3<f32>) -> vec3<f32> {
  let co = c.r - c.b;
  let t = c.b + co * 0.5;
  let cg = c.g - t;
  let y = t + cg * 0.5;
  return vec3<f32>(y, co, cg);
}

fn ycocg_to_rgb(c: vec3<f32>) -> vec3<f32> {
  let t = c.x - c.z * 0.5;
  let g = c.z + t;
  let b = t - c.y * 0.5;
  let r = b + c.y;
  return vec3<f32>(r, g, b);
}

// Clip \`history\` to the AABB [aabb_min, aabb_max] by walking it back toward the
// box center along the line to the current sample — sharper than a per-axis
// clamp, which rounds corners and over-darkens.
fn clip_to_aabb(aabb_min: vec3<f32>, aabb_max: vec3<f32>, history: vec3<f32>) -> vec3<f32> {
  let center = 0.5 * (aabb_max + aabb_min);
  let extent = max(0.5 * (aabb_max - aabb_min), vec3<f32>(1e-5));
  let v = history - center;
  let units = abs(v / extent);
  let ma = max(units.x, max(units.y, units.z));
  if (ma > 1.0) {
    return center + v / ma;
  }
  return history;
}

// textureSampleLevel (explicit LOD 0) is used throughout: the reprojection
// early-outs introduce non-uniform control flow, under which implicit-LOD
// sampling is a uniformity violation.
@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  let current = textureSampleLevel(scene_tex, samp, in.uv, 0.0);

  // First frame / post-resize: no usable history yet, so output the current
  // scene and let it become next frame's history.
  if (params.reset != 0u) {
    return current;
  }

  // The motion target stores the half-NDC delta (prev - curr) * 0.5; converting
  // to a UV offset is just an axis flip on Y (the 0.5 and the NDC->UV 2x
  // cancel). Adding it walks from this pixel back to where it was last frame.
  let mv = textureSampleLevel(motion_tex, samp, in.uv, 0.0).rg;
  let history_uv = in.uv + vec2<f32>(mv.x, -mv.y);

  // Reprojection that lands off-screen has no history to draw from
  // (disocclusion at the frame edge) — keep the current sample.
  if (history_uv.x < 0.0 || history_uv.x > 1.0 || history_uv.y < 0.0 || history_uv.y > 1.0) {
    return current;
  }

  // Build the current 3×3 neighborhood's color box in YCoCg via mean + variance.
  let texel = 1.0 / vec2<f32>(textureDimensions(scene_tex, 0));
  var m1 = vec3<f32>(0.0);
  var m2 = vec3<f32>(0.0);
  for (var dy = -1; dy <= 1; dy = dy + 1) {
    for (var dx = -1; dx <= 1; dx = dx + 1) {
      let s = textureSampleLevel(
        scene_tex,
        samp,
        in.uv + vec2<f32>(f32(dx), f32(dy)) * texel,
        0.0,
      ).rgb;
      let c = rgb_to_ycocg(s);
      m1 = m1 + c;
      m2 = m2 + c * c;
    }
  }
  let inv_n = 1.0 / 9.0;
  let mean = m1 * inv_n;
  let variance = max(m2 * inv_n - mean * mean, vec3<f32>(0.0));
  let stddev = sqrt(variance);
  let aabb_min = mean - VARIANCE_GAMMA * stddev;
  let aabb_max = mean + VARIANCE_GAMMA * stddev;

  let history_rgb = textureSampleLevel(history_tex, samp, history_uv, 0.0).rgb;
  let clipped = ycocg_to_rgb(clip_to_aabb(aabb_min, aabb_max, rgb_to_ycocg(history_rgb)));

  // Karis tonemap-weighted blend: weight each sample by 1/(1+luma) so a single
  // bright pixel cannot dominate the average and leave a trail.
  let wc = params.blend / (1.0 + luma(current.rgb));
  let wh = (1.0 - params.blend) / (1.0 + luma(clipped));
  let resolved = (current.rgb * wc + clipped * wh) / max(wc + wh, 1e-5);
  return vec4<f32>(resolved, current.a);
}
`;
