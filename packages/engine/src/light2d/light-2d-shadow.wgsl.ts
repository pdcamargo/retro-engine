/**
 * WGSL source for the engine's 2D shadow-atlas build pipeline. Registered with
 * `ShaderRegistry` under `retro_engine::light2d_shadow` at plugin build time.
 *
 * Builds a 1D shadow map per shadow-casting light into one row of a shared
 * atlas (`LIGHT2D_SHADOW_ATLAS_WIDTH` × `LIGHT2D_MAX_SHADOW_CASTERS`,
 * single-channel float). Each atlas texel `(u, v)` is one `(angle, lightRow)`
 * sample: the normalized distance `[0, 1]` to the nearest occluder segment
 * along the ray leaving that light at that angle (`1.0` = no occluder within
 * range).
 *
 * The map is built analytically from explicit occluder segments — the fragment
 * loops the world-space segment list and takes the nearest ray-segment
 * intersection — so there is no occluder-map intermediate. A single fullscreen
 * triangle covers the whole atlas; `@group(0)` carries the build uniform
 * (segment list + per-row light center/range + counts).
 *
 * Angle convention: `theta = u * 2π - π`, so `u = 0 → -π` and `u = 1 → π`,
 * matching the accumulation pass's `u = (atan2(rel.y, rel.x) + π) / 2π`.
 */
export const LIGHT2D_SHADOW_WGSL = /* wgsl */ `
const PI: f32 = 3.14159265358979;
const MAX_SEGMENTS: u32 = 256u;
const MAX_CASTERS: u32 = 64u;

struct ShadowBuild {
  // x = occluder count, y = caster count (both as f32, floored to u32 in-shader).
  counts: vec4<f32>,
  // Each segment: (a.xy, b.xy) in world space.
  segments: array<vec4<f32>, 256>,
  // Each caster: (center.xy, range, _).
  lights: array<vec4<f32>, 64>,
};

@group(0) @binding(0) var<uniform> build: ShadowBuild;

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

fn cross2(a: vec2<f32>, b: vec2<f32>) -> f32 {
  return a.x * b.y - a.y * b.x;
}

// Distance from ray origin O along unit direction D to segment [P1, P2], or
// 'fallback' when the ray misses the segment within [0, fallback].
fn ray_segment_distance(o: vec2<f32>, d: vec2<f32>, p1: vec2<f32>, p2: vec2<f32>, fallback: f32) -> f32 {
  let e = p2 - p1;
  let denom = cross2(d, e);
  if (abs(denom) < 1e-6) {
    return fallback;
  }
  let diff = p1 - o;
  let t = cross2(diff, e) / denom;
  let s = cross2(diff, d) / denom;
  if (t >= 0.0 && t <= fallback && s >= 0.0 && s <= 1.0) {
    return t;
  }
  return fallback;
}

@fragment
fn fs_main(input: VsOut) -> @location(0) vec4<f32> {
  let caster_count = u32(build.counts.y + 0.5);
  let row = u32(floor(input.uv.y * f32(MAX_CASTERS)));
  if (row >= caster_count) {
    return vec4<f32>(1.0, 0.0, 0.0, 1.0);
  }
  let light = build.lights[row];
  let center = light.xy;
  let range = max(light.z, 1e-4);

  let theta = input.uv.x * 2.0 * PI - PI;
  let dir = vec2<f32>(cos(theta), sin(theta));

  let occluder_count = min(u32(build.counts.x + 0.5), MAX_SEGMENTS);
  var nearest = range;
  for (var i: u32 = 0u; i < occluder_count; i = i + 1u) {
    let seg = build.segments[i];
    nearest = min(nearest, ray_segment_distance(center, dir, seg.xy, seg.zw, range));
  }
  return vec4<f32>(nearest / range, 0.0, 0.0, 1.0);
}
` as const;
