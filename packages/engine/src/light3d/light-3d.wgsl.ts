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
const MAX_SHADOW_CASTERS: u32 = 12u;

struct DirectionalLightGpu {
  // xyz = world-space travel direction (the way the light points);
  // w = base shadow-atlas layer of this light's cascades (cascade c uses layer
  //     w + c and shadow_view_proj[w + c]); -1 = casts no shadow.
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
  // x = directional count, y = point count, z = spot count,
  // w = cascade count (cascades per shadowed directional light, 0 = none).
  counts: vec4<u32>,
  directional: array<DirectionalLightGpu, MAX_DIRECTIONAL_LIGHTS>,
  point: array<PointLightGpu, MAX_POINT_LIGHTS>,
  spot: array<SpotLightGpu, MAX_SPOT_LIGHTS>,
  // Directional cascade split distances: each component is a cascade's far edge
  // in camera view-space distance. Only the first \`counts.w\` are meaningful.
  cascade_splits: vec4<f32>,
  // Per-shadow-caster light-space view-projection. Indexed by a caster layer
  // (spot: its caster index; directional: cascade base + cascade index);
  // \`retro_engine::shadow3d\` projects the world fragment by this matrix.
  shadow_view_proj: array<mat4x4<f32>, MAX_SHADOW_CASTERS>,
  // Shadow-sampling flags shared by every shadowed light this frame.
  // x = filtering kernel (0 = Hardware2x2, 1 = Castano13, 2 = Pcf5x5);
  // yzw are reserved (zero) for future shadow knobs.
  shadow_flags: vec4<u32>,
};

@group(2) @binding(0) var<uniform> lights: GpuLights;

// Image-based lighting set (bindings 3-6) + its params (7). Always bound — when
// no environment is active the textures are 1×1 fallbacks and
// \`environment.params.x\` (has-environment) is 0, so shading takes the flat
// ambient path instead.
@group(2) @binding(3) var irradiance_map: texture_cube<f32>;
@group(2) @binding(4) var specular_map: texture_cube<f32>;
@group(2) @binding(5) var brdf_lut: texture_2d<f32>;
@group(2) @binding(6) var environment_sampler: sampler;

struct EnvironmentParams {
  // x = has-environment (0/1), y = diffuse intensity, z = specular intensity,
  // w = max specular mip (shade-time LOD = roughness * w).
  params: vec4<f32>,
  // World-space rotation applied to the irradiance / reflection lookup.
  rotation: mat4x4<f32>,
};

@group(2) @binding(7) var<uniform> environment: EnvironmentParams;

// True when an environment map is bound this frame.
fn has_environment() -> bool {
  return environment.params.x > 0.5;
}

// Fresnel-Schlick with a roughness-aware ceiling, for the ambient/indirect term.
fn fresnel_schlick_roughness(cos_theta: f32, f0: vec3<f32>, roughness: f32) -> vec3<f32> {
  let ceiling = max(vec3<f32>(1.0 - roughness), f0);
  return f0 + (ceiling - f0) * pow(clamp(1.0 - cos_theta, 0.0, 1.0), 5.0);
}

// Split-sum image-based lighting: diffuse irradiance + roughness-mipped specular
// reconstructed from the prefiltered maps and the BRDF LUT. Returns the indirect
// radiance (before occlusion). Explicit-LOD samples keep this valid under the
// fragment's non-uniform (post-discard) control flow.
fn evaluate_ibl(
  n: vec3<f32>,
  v: vec3<f32>,
  n_dot_v: f32,
  albedo: vec3<f32>,
  metallic: f32,
  roughness: f32,
  f0: vec3<f32>,
) -> vec3<f32> {
  let n_env = normalize((environment.rotation * vec4<f32>(n, 0.0)).xyz);
  let r = reflect(-v, n);
  let r_env = normalize((environment.rotation * vec4<f32>(r, 0.0)).xyz);

  let f = fresnel_schlick_roughness(n_dot_v, f0, roughness);
  let k_d = (vec3<f32>(1.0) - f) * (1.0 - metallic);

  let irradiance = textureSampleLevel(irradiance_map, environment_sampler, n_env, 0.0).rgb;
  let diffuse = irradiance * albedo;

  let prefiltered = textureSampleLevel(
    specular_map, environment_sampler, r_env, roughness * environment.params.w,
  ).rgb;
  let env_brdf = textureSampleLevel(
    brdf_lut, environment_sampler, vec2<f32>(n_dot_v, roughness), 0.0,
  ).rg;
  let specular = prefiltered * (f * env_brdf.x + env_brdf.y);

  return k_d * diffuse * environment.params.y + specular * environment.params.z;
}

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
