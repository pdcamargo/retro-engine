/**
 * WGSL for the screen-space ambient-occlusion pass. A full-screen triangle
 * reconstructs view-space position from the depth prepass, reads the world-space
 * normal from the normal prepass, and estimates occlusion with a horizon search
 * along a few rotated slices (the GTAO / HBAO family). Registered as
 * `retro_engine::ao_gtao`.
 *
 * Depth and normal are read with `textureLoad` at integer texel coordinates —
 * no sampler — which sidesteps depth-format filterability limits and keeps every
 * tap on uniform control flow. View-space position is reconstructed with the
 * camera's jittered inverse-projection (supplied in the params uniform), so the
 * reconstruction is exact for the geometry the depth prepass actually
 * rasterized, jittered or not.
 */
export const AO_GTAO_WGSL = /* wgsl */ `
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
  inv_proj: mat4x4<f32>,
  view: mat4x4<f32>,
  resolution: vec2<f32>,
  inv_resolution: vec2<f32>,
  radius: f32,
  intensity: f32,
  bias: f32,
  focal_y: f32,
  slices: f32,
  steps: f32,
  frame_index: f32,
  _pad: f32,
};

@group(0) @binding(0) var depth_tex: texture_depth_2d;
@group(0) @binding(1) var normal_tex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: Params;

const PI: f32 = 3.14159265358979;

// Reconstruct view-space position from the stored depth at an integer texel.
fn reconstruct(coord: vec2<i32>) -> vec3<f32> {
  let d = textureLoad(depth_tex, coord, 0);
  let uv = (vec2<f32>(coord) + vec2<f32>(0.5)) * params.inv_resolution;
  let ndc = vec2<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let clip = vec4<f32>(ndc, d, 1.0);
  let v = params.inv_proj * clip;
  return v.xyz / v.w;
}

fn hash12(p: vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(12.9898, 78.233))) * 43758.5453);
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  let res = vec2<i32>(params.resolution);
  let center = vec2<i32>(floor(in.clip_position.xy));
  let center_depth = textureLoad(depth_tex, center, 0);
  // Background (no geometry): fully unoccluded.
  if (center_depth >= 1.0) {
    return vec4<f32>(1.0);
  }

  let p = reconstruct(center);
  let world_n = normalize(textureLoad(normal_tex, center, 0).xyz * 2.0 - 1.0);
  let n = normalize((params.view * vec4<f32>(world_n, 0.0)).xyz);

  // View-space screen radius (pixels) of the world-space sample radius at this
  // depth. Clamped so near-camera surfaces don't march the whole screen.
  let screen_radius = clamp(
    params.radius * params.focal_y * params.resolution.y * 0.5 / max(-p.z, 1e-3),
    2.0,
    256.0,
  );

  let slices = clamp(u32(params.slices), 1u, 8u);
  let steps = clamp(u32(params.steps), 1u, 16u);
  let noise = hash12(vec2<f32>(center) + params.frame_index * 17.0);
  let step_px = screen_radius / f32(steps);

  var occ = 0.0;
  for (var s = 0u; s < slices; s = s + 1u) {
    let phi = (f32(s) + noise) * PI / f32(slices);
    let dir = vec2<f32>(cos(phi), sin(phi));
    // March both halves of the slice.
    for (var hemi = 0u; hemi < 2u; hemi = hemi + 1u) {
      let dir_sign = select(-1.0, 1.0, hemi == 0u);
      for (var i = 1u; i <= steps; i = i + 1u) {
        let offset = dir * dir_sign * (step_px * f32(i));
        let sc = center + vec2<i32>(i32(round(offset.x)), i32(round(offset.y)));
        if (sc.x < 0 || sc.y < 0 || sc.x >= res.x || sc.y >= res.y) {
          continue;
        }
        let sd = textureLoad(depth_tex, sc, 0);
        if (sd >= 1.0) {
          continue;
        }
        let s_pos = reconstruct(sc);
        let h = s_pos - p;
        let dist = length(h);
        if (dist < 1e-4 || dist > params.radius) {
          continue;
        }
        // Horizon elevation above the surface tangent, distance-attenuated.
        let n_dot_h = dot(n, h / dist);
        let falloff = 1.0 - dist / params.radius;
        occ = occ + max(n_dot_h - params.bias, 0.0) * falloff;
      }
    }
  }

  occ = occ / f32(slices * steps);
  let ao = clamp(occ * 2.0, 0.0, 1.0);
  let visibility = pow(1.0 - ao, max(params.intensity, 0.0));
  return vec4<f32>(visibility, visibility, visibility, 1.0);
}
`;

/**
 * WGSL for the AO denoise pass: a depth-aware bilateral blur. A full-screen
 * triangle averages a small box of AO samples around each pixel, weighting taps
 * by view-space depth similarity (reconstructed from the same jittered
 * inverse-projection) so the blur smooths the GTAO noise without bleeding across
 * silhouettes / depth discontinuities. Registered as `retro_engine::ao_blur`.
 *
 * Reuses the AO params uniform (it carries the inverse-projection + resolution
 * the reconstruction needs). Reads AO + depth with `textureLoad` — no sampler.
 */
export const AO_BLUR_WGSL = /* wgsl */ `
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
  inv_proj: mat4x4<f32>,
  view: mat4x4<f32>,
  resolution: vec2<f32>,
  inv_resolution: vec2<f32>,
  radius: f32,
  intensity: f32,
  bias: f32,
  focal_y: f32,
  slices: f32,
  steps: f32,
  frame_index: f32,
  _pad: f32,
};

@group(0) @binding(0) var ao_tex: texture_2d<f32>;
@group(0) @binding(1) var depth_tex: texture_depth_2d;
@group(0) @binding(2) var<uniform> params: Params;

// View-space Z (negative, into the scene) reconstructed from the stored depth.
fn view_z(coord: vec2<i32>) -> f32 {
  let d = textureLoad(depth_tex, coord, 0);
  let uv = (vec2<f32>(coord) + vec2<f32>(0.5)) * params.inv_resolution;
  let ndc = vec2<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let v = params.inv_proj * vec4<f32>(ndc, d, 1.0);
  return v.z / v.w;
}

const BLUR_RADIUS: i32 = 2;

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  let res = vec2<i32>(params.resolution);
  let center = vec2<i32>(floor(in.clip_position.xy));
  let z_center = view_z(center);
  // Depth-rejection scale relative to the sample radius: taps farther than a
  // fraction of the AO radius in view-space depth are rejected as a different
  // surface, so the blur never bleeds across a silhouette.
  let depth_scale = 1.0 / max(params.radius * 0.5, 1e-3);

  var sum = 0.0;
  var wsum = 0.0;
  for (var dy = -BLUR_RADIUS; dy <= BLUR_RADIUS; dy = dy + 1) {
    for (var dx = -BLUR_RADIUS; dx <= BLUR_RADIUS; dx = dx + 1) {
      let sc = center + vec2<i32>(dx, dy);
      if (sc.x < 0 || sc.y < 0 || sc.x >= res.x || sc.y >= res.y) {
        continue;
      }
      let dz = (view_z(sc) - z_center) * depth_scale;
      let w = exp(-dz * dz);
      sum = sum + textureLoad(ao_tex, sc, 0).r * w;
      wsum = wsum + w;
    }
  }
  let ao = select(textureLoad(ao_tex, center, 0).r, sum / wsum, wsum > 0.0);
  return vec4<f32>(ao, ao, ao, 1.0);
}
`;

/**
 * WGSL for the AO temporal accumulation pass. A full-screen triangle reprojects
 * last frame's accumulated AO along the motion-vector prepass, rejects it where
 * the reprojected view-space depth disagrees (disocclusion) or it lands
 * off-screen, and blends it with the current (blurred) AO. Output is
 * `rg16float`: accumulated AO in `.r`, current view-space depth in `.g` (next
 * frame's disocclusion reference). Registered as `retro_engine::ao_temporal`.
 *
 * The `_pad` slot of the shared AO params doubles as a `reset` flag (1 on the
 * first frame / after a resize) that forces current-only output until history
 * has primed.
 */
export const AO_TEMPORAL_WGSL = /* wgsl */ `
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
  inv_proj: mat4x4<f32>,
  view: mat4x4<f32>,
  resolution: vec2<f32>,
  inv_resolution: vec2<f32>,
  radius: f32,
  intensity: f32,
  bias: f32,
  focal_y: f32,
  slices: f32,
  steps: f32,
  frame_index: f32,
  reset: f32,
};

@group(0) @binding(0) var ao_tex: texture_2d<f32>;
@group(0) @binding(1) var history_tex: texture_2d<f32>;
@group(0) @binding(2) var motion_tex: texture_2d<f32>;
@group(0) @binding(3) var depth_tex: texture_depth_2d;
@group(0) @binding(4) var<uniform> params: Params;
@group(0) @binding(5) var samp: sampler;

const ALPHA: f32 = 0.9;

fn view_z(coord: vec2<i32>) -> f32 {
  let d = textureLoad(depth_tex, coord, 0);
  let uv = (vec2<f32>(coord) + vec2<f32>(0.5)) * params.inv_resolution;
  let ndc = vec2<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let v = params.inv_proj * vec4<f32>(ndc, d, 1.0);
  return v.z / v.w;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec2<f32> {
  let center = vec2<i32>(floor(in.clip_position.xy));
  let uv = (vec2<f32>(center) + vec2<f32>(0.5)) * params.inv_resolution;
  let cur_ao = textureLoad(ao_tex, center, 0).r;
  let cur_z = view_z(center);

  // The motion target stores the half-NDC delta (prev - curr) * 0.5; the 0.5 and
  // the NDC->UV 2x cancel, leaving a Y flip (same convention as TAA).
  let mv = textureLoad(motion_tex, center, 0).rg;
  let hist_uv = uv + vec2<f32>(mv.x, -mv.y);

  let off_screen = hist_uv.x < 0.0 || hist_uv.x > 1.0 || hist_uv.y < 0.0 || hist_uv.y > 1.0;
  if (params.reset > 0.5 || off_screen) {
    return vec2<f32>(cur_ao, cur_z);
  }

  let hist = textureSampleLevel(history_tex, samp, hist_uv, 0.0).rg;
  // Disocclusion: reject reprojected history whose depth disagrees with the
  // current surface (relative threshold to stay scale-independent).
  let dz = abs(hist.g - cur_z);
  let reject = dz > max(0.1 * abs(cur_z), 0.05);
  let alpha = select(ALPHA, 0.0, reject);
  let ao = mix(cur_ao, hist.r, alpha);
  return vec2<f32>(ao, cur_z);
}
`;
