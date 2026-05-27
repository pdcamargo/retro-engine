/**
 * WGSL source for the engine's 2D light accumulation pipeline. Registered with
 * `ShaderRegistry` under `retro_engine::light2d_accumulation` at plugin build
 * time.
 *
 * Bind groups:
 *
 * - `@group(0)`: view uniform — imported via `#import retro_engine::view`.
 *   Auto-bound by the accumulation pass node before any draw.
 *
 * Vertex layout (two buffers; the second steps per-instance):
 *
 * | Buffer | Slot | Format    | `@location` | Step      | Field                               |
 * |--------|------|-----------|-------------|-----------|-------------------------------------|
 * | 0      | 0    | float32x2 | 0           | vertex    | unit-quad UV `[0, 1]²`              |
 * | 1      | 0    | float32x4 | 2           | instance  | `center.xy` + footprint `(p0, p1)`  |
 * | 1      | 1    | float32x4 | 3           | instance  | `color.rgb + intensity`             |
 * | 1      | 2    | float32x4 | 4           | instance  | cone `dir.xy + cosInner + cosOuter` |
 * | 1      | 3    | float32   | 5           | instance  | `kind` discriminator                |
 * | 1      | 4    | float32   | 6           | instance  | `shadowRow` (atlas row, -1 = none)  |
 *
 * `@group(1)` carries the shared shadow atlas (`binding 0` texture, `binding 1`
 * sampler). Point / spot lights with a non-negative `shadowRow` sample their
 * row to mask occluded fragments; the sample is taken in uniform control flow.
 *
 * Every visible light of any kind is drawn in one instanced call; the kind
 * discriminator selects geometry and falloff per instance:
 *
 * - **Point / Spot** place a world-space footprint quad of side `2 * range`
 *   centred on the light. The fragment computes the radial falloff
 *   `1 - smoothstep(radius, range, distance)`; spot lights additionally mask by
 *   the angular term `smoothstep(cosOuter, cosInner, dot(dir, toFragment))`.
 * - **Directional** and **global Ambient** emit a full-screen quad and a flat
 *   `color * intensity` contribution.
 * - **Regional Ambient** emits a world-space rectangle sized by its
 *   half-extents and fills it flat.
 *
 * The pipeline's additive blend (`One/One`) sums contributions from overlapping
 * lights into the per-camera `lightAccum` target.
 */
export const LIGHT2D_ACCUMULATION_WGSL = /* wgsl */ `
#import retro_engine::view

const PI: f32 = 3.14159265358979;
const KIND_POINT: f32 = 0.0;
const KIND_SPOT: f32 = 1.0;
const KIND_DIRECTIONAL: f32 = 2.0;
const KIND_AMBIENT_ZONE: f32 = 3.0;
// Must match LIGHT2D_MAX_SHADOW_CASTERS (shadow atlas height).
const SHADOW_CASTERS: f32 = 64.0;

@group(1) @binding(0) var shadow_atlas: texture_2d<f32>;
@group(1) @binding(1) var shadow_sampler: sampler;

struct VsIn {
  @location(0) quad_uv: vec2<f32>,
  @location(2) instance_a: vec4<f32>,
  @location(3) instance_b: vec4<f32>,
  @location(4) instance_c: vec4<f32>,
  @location(5) instance_kind: f32,
  @location(6) instance_shadow_row: f32,
};

struct VsOut {
  @builtin(position) clip_position: vec4<f32>,
  @location(0) world_pos: vec2<f32>,
  @location(1) light_center: vec2<f32>,
  @location(2) light_params: vec2<f32>,
  @location(3) light_color: vec3<f32>,
  @location(4) light_intensity: f32,
  @location(5) cone: vec4<f32>,
  @location(6) kind: f32,
  @location(7) shadow_row: f32,
};

@vertex
fn vs_main(input: VsIn) -> VsOut {
  var out: VsOut;
  let kind = input.instance_kind;
  let center = input.instance_a.xy;
  let offset = input.quad_uv * 2.0 - vec2<f32>(1.0, 1.0);

  out.light_center = center;
  out.light_params = input.instance_a.zw;
  out.light_color = input.instance_b.rgb;
  out.light_intensity = input.instance_b.a;
  out.cone = input.instance_c;
  out.kind = kind;
  out.shadow_row = input.instance_shadow_row;

  // Full-screen flat contributions: directional, and global (zero-extent)
  // ambient zones. Emitted directly in clip space, bypassing the view matrix.
  let global_ambient = kind == KIND_AMBIENT_ZONE && input.instance_a.z <= 0.0;
  if (kind == KIND_DIRECTIONAL || global_ambient) {
    out.clip_position = vec4<f32>(offset.x, -offset.y, 0.0, 1.0);
    out.world_pos = center;
    return out;
  }

  // World-space footprint. Point / spot use a square of side 2*range; a
  // regional ambient zone uses its (halfWidth, halfHeight) extents.
  var half_extent = vec2<f32>(input.instance_a.z, input.instance_a.z);
  if (kind == KIND_AMBIENT_ZONE) {
    half_extent = input.instance_a.zw;
  }
  let world_xy = center + offset * half_extent;
  out.clip_position = view.view_proj * vec4<f32>(world_xy.x, world_xy.y, 0.0, 1.0);
  out.world_pos = world_xy;
  return out;
}

@fragment
fn fs_main(input: VsOut) -> @location(0) vec4<f32> {
  let rel = input.world_pos - input.light_center;
  let d = length(rel);

  // Sample the shadow atlas in uniform control flow (always), then apply it
  // only to point / spot lights that carry a valid row.
  let theta = atan2(rel.y, rel.x);
  let u = (theta + PI) / (2.0 * PI);
  let v = (max(input.shadow_row, 0.0) + 0.5) / SHADOW_CASTERS;
  let stored = textureSample(shadow_atlas, shadow_sampler, vec2<f32>(u, v)).r;

  var falloff = 1.0;
  if (input.kind == KIND_POINT || input.kind == KIND_SPOT) {
    let range = input.light_params.x;
    let radius = input.light_params.y;
    falloff = 1.0 - smoothstep(radius, range, d);
    if (input.kind == KIND_SPOT && d > 1e-4) {
      let to_frag = rel / d;
      falloff = falloff * smoothstep(input.cone.w, input.cone.z, dot(input.cone.xy, to_frag));
    }
    if (input.shadow_row >= 0.0) {
      let r_norm = d / max(range, 1e-4);
      let bias = 0.01;
      // Only a ray that actually hits an occluder (stored < 1) casts shadow;
      // a soft band around the occluder distance feathers the edge.
      let shadow = select(0.0, smoothstep(stored - bias, stored + bias, r_norm), stored < 0.999);
      falloff = falloff * (1.0 - shadow);
    }
  }
  let lit = input.light_color * input.light_intensity * falloff;
  return vec4<f32>(lit, 1.0);
}
` as const;
