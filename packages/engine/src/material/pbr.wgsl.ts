/**
 * WGSL source for {@link StandardMaterial} — metallic-roughness PBR.
 *
 * Registered with `ShaderRegistry` under `retro_engine::pbr` at plugin build
 * time. Both `vs_main` and `fs_main` live here.
 *
 * Lighting reads the analytic-light uniform from `retro_engine::light3d`
 * (`@group(2)`): the fragment loops over every directional / point / spot light
 * the host packed this frame, running the Cook-Torrance BRDF below per light,
 * and adds the scene ambient term. A `Light3dPlugin` must be present for the
 * lights group to be bound. The math (Lambert + GGX + Schlick with energy
 * conservation) is real PBR.
 *
 * IBL (image-based lighting) is the Phase 10.7 additive load. When it lands,
 * the shader gains an `#ifdef ENABLE_IBL` branch and an environment-map
 * uniform, and the constant ambient term becomes the prefiltered irradiance.
 *
 * Bind groups:
 *
 * - `@group(0)`: view uniform (auto-bound by the Core3d phase node). Imported
 *   via `#import retro_engine::view`.
 * - `@group(1)`: material data:
 *   - `@binding(0)` uniform `StandardMaterialUniform`.
 *   - `@binding(1)` `base_color_texture: texture_2d<f32>`.
 *   - `@binding(2)` `material_sampler: sampler`.
 *   - `@binding(3)` `metallic_roughness_texture: texture_2d<f32>` (glTF
 *     convention: blue = metallic, green = roughness).
 *   - `@binding(4)` `normal_map_texture: texture_2d<f32>` (currently unused —
 *     gets read but the math passes through; normal-map tangent-space math
 *     lands when `TANGENT` attributes flow through `Mesh.computeFlatNormals`).
 *   - `@binding(5)` `emissive_texture: texture_2d<f32>`.
 *   - `@binding(6)` `occlusion_texture: texture_2d<f32>`.
 * - `@group(2)`: the analytic-light uniform (`GpuLights`) at `@binding(0)`,
 *   imported via `#import retro_engine::light3d`, plus the shadow depth atlas
 *   (`texture_depth_2d_array`) at `@binding(1)` and a comparison sampler at
 *   `@binding(2)` from `#import retro_engine::shadow3d`. Bound by the Core3d
 *   phase node when a `Light3dPlugin` is present; directional contributions are
 *   multiplied by `directional_shadow_factor(...)` (cascaded) and spot
 *   contributions by `shadow_factor(...)`.
 *
 * The per-entity model matrix and its inverse-transpose arrive as per-instance
 * vertex attributes at `@location(8..11)` and `@location(12..15)` (vertex
 * buffer slot 1, `stepMode: 'instance'`). Vertex slot 0 consumes
 * `POSITION + NORMAL + UV_0`. Tangents are deferred.
 */
export const PBR_WGSL = /* wgsl */ `
#import retro_engine::view
#import retro_engine::light3d
#import retro_engine::shadow3d

struct StandardMaterialUniform {
  base_color: vec4<f32>,
  emissive: vec4<f32>,
  metallic: f32,
  roughness: f32,
  occlusion_strength: f32,
  alpha_cutoff: f32,
};

@group(1) @binding(0) var<uniform> material: StandardMaterialUniform;
@group(1) @binding(1) var base_color_texture: texture_2d<f32>;
@group(1) @binding(2) var material_sampler: sampler;
@group(1) @binding(3) var metallic_roughness_texture: texture_2d<f32>;
@group(1) @binding(4) var normal_map_texture: texture_2d<f32>;
@group(1) @binding(5) var emissive_texture: texture_2d<f32>;
@group(1) @binding(6) var occlusion_texture: texture_2d<f32>;

struct VsIn {
  @location(0) position: vec3<f32>,
  @location(1) normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
  @location(8) model_c0: vec4<f32>,
  @location(9) model_c1: vec4<f32>,
  @location(10) model_c2: vec4<f32>,
  @location(11) model_c3: vec4<f32>,
  @location(12) inv_t_c0: vec4<f32>,
  @location(13) inv_t_c1: vec4<f32>,
  @location(14) inv_t_c2: vec4<f32>,
  @location(15) inv_t_c3: vec4<f32>,
};

struct VsOut {
  @builtin(position) clip_position: vec4<f32>,
  @location(0) world_position: vec3<f32>,
  @location(1) world_normal: vec3<f32>,
  @location(2) uv: vec2<f32>,
};

@vertex
fn vs_main(in: VsIn) -> VsOut {
  var out: VsOut;
  let model = mat4x4<f32>(in.model_c0, in.model_c1, in.model_c2, in.model_c3);
  let inverse_transpose_model = mat4x4<f32>(in.inv_t_c0, in.inv_t_c1, in.inv_t_c2, in.inv_t_c3);
  let world_pos = model * vec4<f32>(in.position, 1.0);
  out.world_position = world_pos.xyz;
  out.world_normal = normalize(
    (inverse_transpose_model * vec4<f32>(in.normal, 0.0)).xyz
  );
  out.uv = in.uv;
  out.clip_position = view.view_proj * world_pos;
  return out;
}

const PI: f32 = 3.14159265358979;

fn distribution_ggx(n_dot_h: f32, roughness: f32) -> f32 {
  let a = roughness * roughness;
  let a2 = a * a;
  let denom_inner = n_dot_h * n_dot_h * (a2 - 1.0) + 1.0;
  let denom = PI * denom_inner * denom_inner;
  return a2 / max(denom, 0.0001);
}

fn geometry_schlick_ggx(n_dot_x: f32, roughness: f32) -> f32 {
  let r = roughness + 1.0;
  let k = (r * r) / 8.0;
  return n_dot_x / (n_dot_x * (1.0 - k) + k);
}

fn geometry_smith(n_dot_v: f32, n_dot_l: f32, roughness: f32) -> f32 {
  return geometry_schlick_ggx(n_dot_v, roughness) * geometry_schlick_ggx(n_dot_l, roughness);
}

fn fresnel_schlick(cos_theta: f32, f0: vec3<f32>) -> vec3<f32> {
  return f0 + (vec3<f32>(1.0) - f0) * pow(clamp(1.0 - cos_theta, 0.0, 1.0), 5.0);
}

// Cook-Torrance response of one surface to one light sample. \`s.radiance\`
// already folds in the light's colour, intensity, distance attenuation, and
// (for spots) the cone mask; this applies the BRDF and the N·L cosine term.
fn lit(
  s: LightSample,
  n: vec3<f32>,
  v: vec3<f32>,
  n_dot_v: f32,
  albedo: vec3<f32>,
  metallic: f32,
  roughness: f32,
  f0: vec3<f32>,
) -> vec3<f32> {
  let l = s.l;
  let h = normalize(v + l);
  let n_dot_l = max(dot(n, l), 0.0);
  let n_dot_h = max(dot(n, h), 0.0);
  let v_dot_h = max(dot(v, h), 0.0);

  let d = distribution_ggx(n_dot_h, roughness);
  let g = geometry_smith(n_dot_v, n_dot_l, roughness);
  let f = fresnel_schlick(v_dot_h, f0);
  let specular = (d * g * f) / max(4.0 * n_dot_v * n_dot_l, 0.0001);

  let k_s = f;
  let k_d = (vec3<f32>(1.0) - k_s) * (1.0 - metallic);
  let diffuse = k_d * albedo / PI;
  return (diffuse + specular) * s.radiance * n_dot_l;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  let base_color_sample = textureSample(base_color_texture, material_sampler, in.uv);
  let mr_sample = textureSample(metallic_roughness_texture, material_sampler, in.uv);
  let emissive_sample = textureSample(emissive_texture, material_sampler, in.uv);
  let occlusion_sample = textureSample(occlusion_texture, material_sampler, in.uv);
  // Sampled to keep WebGPU's pipeline validation happy; the normal-map
  // contribution lands with TANGENT attribute support.
  let _normal_sample = textureSample(normal_map_texture, material_sampler, in.uv);

  let base_color = material.base_color * base_color_sample;
  // glTF convention: blue channel = metallic, green channel = roughness.
  let metallic = clamp(material.metallic * mr_sample.b, 0.0, 1.0);
  let roughness = clamp(material.roughness * mr_sample.g, 0.04, 1.0);
  let occlusion = mix(1.0, occlusion_sample.r, material.occlusion_strength);

  if (base_color.a < material.alpha_cutoff) {
    discard;
  }

  let n = normalize(in.world_normal);
  let v = normalize(view.world_position.xyz - in.world_position);
  let n_dot_v = max(dot(n, v), 0.0001);

  let dielectric_f0 = vec3<f32>(0.04);
  let f0 = mix(dielectric_f0, base_color.rgb, metallic);

  // Accumulate every analytic light packed into the GpuLights uniform. Loops
  // are bounded by the per-kind counts (≤ the compile-time maxima) for uniform
  // control flow.
  var direct = vec3<f32>(0.0);
  // Camera view-space depth (into the scene) selects the directional cascade.
  let view_z = -(view.view * vec4<f32>(in.world_position, 1.0)).z;
  for (var i = 0u; i < lights.counts.x; i = i + 1u) {
    let shadow = directional_shadow_factor(lights.directional[i].direction.w, in.world_position, view_z);
    direct += lit(directional_light_sample(i), n, v, n_dot_v, base_color.rgb, metallic, roughness, f0) * shadow;
  }
  for (var i = 0u; i < lights.counts.y; i = i + 1u) {
    direct += lit(point_light_sample(i, in.world_position), n, v, n_dot_v, base_color.rgb, metallic, roughness, f0);
  }
  for (var i = 0u; i < lights.counts.z; i = i + 1u) {
    let shadow = shadow_factor(lights.spot[i].params.w, in.world_position);
    direct += lit(spot_light_sample(i, in.world_position), n, v, n_dot_v, base_color.rgb, metallic, roughness, f0) * shadow;
  }

  // Flat scene ambient — replaced by image-based lighting in Phase 10.7.
  let ambient = lights.ambient.rgb * lights.ambient.a * base_color.rgb * occlusion;

  let final_rgb = ambient + direct + material.emissive.rgb * emissive_sample.rgb;
  return vec4<f32>(final_rgb, base_color.a);
}

#import retro_engine::prepass

struct VsPrepassOut {
  @builtin(position) clip_position: vec4<f32>,
  @location(0) world_normal: vec3<f32>,
  @location(1) uv: vec2<f32>,
};

struct FsPrepassNormalOut {
  @location(0) normal_roughness: vec4<f32>,
};

@vertex
fn vs_prepass(in: VsIn) -> VsPrepassOut {
  var out: VsPrepassOut;
  let model = mat4x4<f32>(in.model_c0, in.model_c1, in.model_c2, in.model_c3);
  let inverse_transpose_model = mat4x4<f32>(in.inv_t_c0, in.inv_t_c1, in.inv_t_c2, in.inv_t_c3);
  let world_pos = model * vec4<f32>(in.position, 1.0);
  out.clip_position = view.view_proj * world_pos;
  out.world_normal = normalize((inverse_transpose_model * vec4<f32>(in.normal, 0.0)).xyz);
  out.uv = in.uv;
  return out;
}

@fragment
fn fs_prepass_normal(in: VsPrepassOut) -> FsPrepassNormalOut {
  var out: FsPrepassNormalOut;
  let mr_sample = textureSample(metallic_roughness_texture, material_sampler, in.uv);
  let roughness = clamp(material.roughness * mr_sample.g, 0.04, 1.0);
  out.normal_roughness = encode_normal_roughness(in.world_normal, roughness);
  return out;
}
` as const;
