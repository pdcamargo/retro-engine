/**
 * WGSL source for the engine's analytic 3D lighting, registered with
 * `ShaderRegistry` as `retro_engine::light3d`. Lit material shaders
 * (`#import retro_engine::light3d`) gain the `GpuLights` uniform at
 * `@group(2) @binding(0)` plus per-light sample helpers that return the
 * direction-to-light and the (attenuated, cone-masked) incoming radiance for
 * one light. The material shader runs its own BRDF against each sample.
 *
 * The fixed-capacity arrays mirror the TypeScript `MAX_*` constants; the host
 * writes per-kind counts into `lights.counts` and the shader loops are bounded
 * by those counts (the compile-time maxima bound the loop trip count for
 * uniform control flow).
 */
export const LIGHT3D_WGSL = /* wgsl */ `
const MAX_DIRECTIONAL_LIGHTS: u32 = 4u;
const MAX_POINT_LIGHTS: u32 = 64u;
const MAX_SPOT_LIGHTS: u32 = 64u;
const MAX_SHADOW_CASTERS: u32 = 8u;

struct DirectionalLightGpu {
  // xyz = world-space travel direction (the way the light points);
  // w = shadow caster index (atlas layer + shadow_view_proj index, -1 = none).
  direction: vec4<f32>,
  // rgb = colour, a = intensity.
  color: vec4<f32>,
};

struct PointLightGpu {
  // xyz = world position, w = range.
  position: vec4<f32>,
  color: vec4<f32>,
  // x = source radius, y = 1 / range^2, zw unused.
  params: vec4<f32>,
};

struct SpotLightGpu {
  position: vec4<f32>,
  // xyz = cone forward direction, w = cos(innerAngle).
  direction: vec4<f32>,
  color: vec4<f32>,
  // x = source radius, y = cos(outerAngle), z = 1 / range^2;
  // w = shadow caster index (atlas layer + shadow_view_proj index, -1 = none).
  params: vec4<f32>,
};

struct GpuLights {
  // rgb = ambient colour, a = ambient brightness.
  ambient: vec4<f32>,
  // x = directional count, y = point count, z = spot count.
  counts: vec4<u32>,
  directional: array<DirectionalLightGpu, MAX_DIRECTIONAL_LIGHTS>,
  point: array<PointLightGpu, MAX_POINT_LIGHTS>,
  spot: array<SpotLightGpu, MAX_SPOT_LIGHTS>,
  // Per-shadow-caster light-space view-projection. Indexed by a light's caster
  // index; \`retro_engine::shadow3d\` projects the world fragment by this matrix.
  shadow_view_proj: array<mat4x4<f32>, MAX_SHADOW_CASTERS>,
};

@group(2) @binding(0) var<uniform> lights: GpuLights;

// Direction toward the light plus the radiance arriving along it. The material
// BRDF multiplies its (diffuse + specular) response by \`radiance\` and \`N·L\`.
struct LightSample {
  l: vec3<f32>,
  radiance: vec3<f32>,
};

// Windowed inverse-square falloff: physically-based 1/d^2 smoothly faded to
// zero at the light's range so a light has finite, artist-controlled reach.
fn light3d_attenuation(dist_sq: f32, inv_range_sq: f32) -> f32 {
  let factor = dist_sq * inv_range_sq;
  let window = clamp(1.0 - factor * factor, 0.0, 1.0);
  return (window * window) / max(dist_sq, 0.0001);
}

fn directional_light_sample(i: u32) -> LightSample {
  let light = lights.directional[i];
  var s: LightSample;
  // Direction *toward* the light is the negative of its travel direction.
  s.l = normalize(-light.direction.xyz);
  s.radiance = light.color.rgb * light.color.a;
  return s;
}

fn point_light_sample(i: u32, world_pos: vec3<f32>) -> LightSample {
  let light = lights.point[i];
  let to_light = light.position.xyz - world_pos;
  let radius = light.params.x;
  let dist_sq = max(dot(to_light, to_light), radius * radius);
  var s: LightSample;
  s.l = normalize(to_light);
  let att = light3d_attenuation(dist_sq, light.params.y);
  s.radiance = light.color.rgb * light.color.a * att;
  return s;
}

fn spot_light_sample(i: u32, world_pos: vec3<f32>) -> LightSample {
  let light = lights.spot[i];
  let to_light = light.position.xyz - world_pos;
  let radius = light.params.x;
  let dist_sq = max(dot(to_light, to_light), radius * radius);
  var s: LightSample;
  s.l = normalize(to_light);
  let att = light3d_attenuation(dist_sq, light.params.z);
  // Cone mask: angle between the cone forward and the direction from the light
  // to the fragment (= -l). Ramp from full inside cos(inner) to zero at cos(outer).
  let cos_angle = dot(light.direction.xyz, -s.l);
  let cos_inner = light.direction.w;
  let cos_outer = light.params.y;
  let cone = clamp((cos_angle - cos_outer) / max(cos_inner - cos_outer, 0.0001), 0.0, 1.0);
  s.radiance = light.color.rgb * light.color.a * att * cone;
  return s;
}
` as const;
