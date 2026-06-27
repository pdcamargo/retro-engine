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
 *   - `@binding(4)` `normal_map_texture: texture_2d<f32>` — perturbs the
 *     shading normal in `fs_main` through a screen-space-derivative cotangent
 *     frame (no per-vertex tangent required), with the tangent-space X/Y scaled
 *     by `normal_scale`. With no normal map bound the flat-normal fallback is a
 *     no-op and shading uses the geometric normal.
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
 * `POSITION + NORMAL + UV_0`. The fragment shader reconstructs the
 * tangent basis from screen-space derivatives, so no per-vertex tangent
 * attribute is consumed.
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
  normal_scale: f32,
};

@group(1) @binding(0) var<uniform> material: StandardMaterialUniform;
@group(1) @binding(1) var base_color_texture: texture_2d<f32>;
@group(1) @binding(2) var material_sampler: sampler;
@group(1) @binding(3) var metallic_roughness_texture: texture_2d<f32>;
@group(1) @binding(4) var normal_map_texture: texture_2d<f32>;
@group(1) @binding(5) var emissive_texture: texture_2d<f32>;
@group(1) @binding(6) var occlusion_texture: texture_2d<f32>;

#ifdef ENABLE_SSAO
// Screen-space ambient occlusion, produced by the pre-opaque AO pass and read
// here to darken only the ambient/indirect term. Present only in the AO-enabled
// pipeline variant (MaterialPlugin appends this @group(3) binding then).
@group(3) @binding(0) var ao_sampler: sampler;
@group(3) @binding(1) var ao_texture: texture_2d<f32>;
#endif

#ifdef MORPHED
// Runtime morph targets (blend shapes). Deltas are per-mesh and target-major
// (delta[t * vertex_count + vertex]); weights are per-entity; params carries the
// mesh's slab base vertex (subtracted from the builtin vertex_index), the live
// target count, and the mesh vertex count. Owns @group(3) on the morphed
// variant (mutually exclusive with SSAO / the skinning palette there).
struct MorphDelta {
  position: vec3<f32>,
  normal: vec3<f32>,
};
struct MorphParams {
  vertex_base: u32,
  target_count: u32,
  vertex_count: u32,
  pad: u32,
};
@group(3) @binding(0) var<storage, read> morph_deltas: array<MorphDelta>;
@group(3) @binding(1) var<storage, read> morph_weights: array<f32>;
@group(3) @binding(2) var<uniform> morph_params: MorphParams;

// Accumulate every target's weighted position + normal delta into the base
// vertex. vid is the builtin vertex_index, offset by the mesh's slab base.
fn apply_morph(vid: u32, position: ptr<function, vec3<f32>>, normal: ptr<function, vec3<f32>>) {
  let local = vid - morph_params.vertex_base;
  for (var t = 0u; t < morph_params.target_count; t = t + 1u) {
    let w = morph_weights[t];
    let d = morph_deltas[t * morph_params.vertex_count + local];
    *position = *position + w * d.position;
    *normal = *normal + w * d.normal;
  }
}
#endif

#ifdef SKINNED
// The frame-global joint palette: every skinned entity's world-space joint
// matrices concatenated. Each instance's joint_offset selects its slice. Shares
// @group(3) with SSAO, so the two are mutually exclusive on the skinned variant.
@group(3) @binding(0) var<storage, read> joint_matrices: array<mat4x4<f32>>;

// Blend the four influencing joint matrices by their weights into one skinning
// matrix. joint_offset is the entity's base index into the shared palette.
fn skin_matrix(joints: vec4<u32>, weights: vec4<f32>, joint_offset: u32) -> mat4x4<f32> {
  return weights.x * joint_matrices[joint_offset + joints.x]
       + weights.y * joint_matrices[joint_offset + joints.y]
       + weights.z * joint_matrices[joint_offset + joints.z]
       + weights.w * joint_matrices[joint_offset + joints.w];
}
#endif

struct VsIn {
  @builtin(vertex_index) vertex_index: u32,
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
#ifdef SKINNED
  @location(3) joints: vec4<u32>,
  @location(4) weights: vec4<f32>,
  @location(7) joint_offset: u32,
#endif
#ifdef PREPASS_MOTION_VECTOR
  @location(4) prev_model_c0: vec4<f32>,
  @location(5) prev_model_c1: vec4<f32>,
  @location(6) prev_model_c2: vec4<f32>,
  @location(7) prev_model_c3: vec4<f32>,
#endif
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
  var base_position = in.position;
  var base_normal = in.normal;
#ifdef MORPHED
  // Morph before skinning (glTF order): blend shapes deform the rest pose, the
  // skin then poses the morphed surface.
  apply_morph(in.vertex_index, &base_position, &base_normal);
#endif
#ifdef SKINNED
  // Deform in mesh space first; the palette already folds in inverse(meshGlobal),
  // so the per-instance model matrix below lands the result in world space.
  let skin = skin_matrix(in.joints, in.weights, in.joint_offset);
  let local_pos = skin * vec4<f32>(base_position, 1.0);
  let local_normal = (skin * vec4<f32>(base_normal, 0.0)).xyz;
#else
  let local_pos = vec4<f32>(base_position, 1.0);
  let local_normal = base_normal;
#endif
  let world_pos = model * local_pos;
  out.world_position = world_pos.xyz;
  out.world_normal = normalize(
    (inverse_transpose_model * vec4<f32>(local_normal, 0.0)).xyz
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

// Reconstruct a tangent frame from screen-space derivatives of world position
// and UV (no per-vertex tangent needed) and apply a tangent-space normal-map
// sample. 'scale' weights the decoded X/Y (glTF normalTexture.scale). Must be
// called from uniform control flow: dpdx/dpdy are undefined past a discard.
fn perturb_normal(
  geom_n: vec3<f32>,
  world_pos: vec3<f32>,
  uv: vec2<f32>,
  sampled: vec3<f32>,
  scale: f32,
) -> vec3<f32> {
  var ts = sampled * 2.0 - 1.0;
  ts = vec3<f32>(ts.xy * scale, ts.z);
  let dp1 = dpdx(world_pos);
  let dp2 = dpdy(world_pos);
  let duv1 = dpdx(uv);
  let duv2 = dpdy(uv);
  let dp2perp = cross(dp2, geom_n);
  let dp1perp = cross(geom_n, dp1);
  let t = dp2perp * duv1.x + dp1perp * duv2.x;
  let b = dp2perp * duv1.y + dp1perp * duv2.y;
  let inv_max = inverseSqrt(max(dot(t, t), dot(b, b)));
  return normalize(mat3x3<f32>(t * inv_max, b * inv_max, geom_n) * ts);
}

@fragment
fn fs_main(in: VsOut, @builtin(front_facing) front_facing: bool) -> @location(0) vec4<f32> {
  let base_color_sample = textureSample(base_color_texture, material_sampler, in.uv);
  let mr_sample = textureSample(metallic_roughness_texture, material_sampler, in.uv);
  let emissive_sample = textureSample(emissive_texture, material_sampler, in.uv);
  let occlusion_sample = textureSample(occlusion_texture, material_sampler, in.uv);
  let normal_sample = textureSample(normal_map_texture, material_sampler, in.uv);

  let base_color = material.base_color * base_color_sample;
  // glTF convention: blue channel = metallic, green channel = roughness.
  let metallic = clamp(material.metallic * mr_sample.b, 0.0, 1.0);
  let roughness = clamp(material.roughness * mr_sample.g, 0.04, 1.0);
  let occlusion = mix(1.0, occlusion_sample.r, material.occlusion_strength);

  // Perturb the shading normal before any discard — perturb_normal's
  // derivatives require uniform control flow.
  var n = perturb_normal(
    normalize(in.world_normal),
    in.world_position,
    in.uv,
    normal_sample.xyz,
    material.normal_scale,
  );
  // Double-sided materials disable back-face culling; flip the normal toward
  // the camera so back faces light correctly. Single-sided meshes cull back
  // faces before this runs, so front_facing is always true for them.
  if (!front_facing) {
    n = -n;
  }

  if (base_color.a < material.alpha_cutoff) {
    discard;
  }

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

  // Screen-space ambient occlusion folds into the same ambient term as the
  // material occlusion texture. Sampled with explicit LOD: the alpha-cutoff
  // discard above puts this on non-uniform control flow, where implicit-LOD
  // sampling is a uniformity violation. UV is the fragment's screen position
  // over the AO texture's own dimensions (robust to sub-viewports).
  var ssao = 1.0;
#ifdef ENABLE_SSAO
  let ao_dim = vec2<f32>(textureDimensions(ao_texture));
  let ao_uv = in.clip_position.xy / ao_dim;
  ssao = textureSampleLevel(ao_texture, ao_sampler, ao_uv, 0.0).r;
#endif

  // Indirect light: image-based lighting when an environment map is bound,
  // otherwise the flat scene ambient. Both are darkened by the material
  // occlusion texture and the screen-space AO factor.
  var ambient: vec3<f32>;
  if (has_environment()) {
    ambient = evaluate_ibl(n, v, n_dot_v, base_color.rgb, metallic, roughness, f0) * occlusion * ssao;
  } else {
    ambient = lights.ambient.rgb * lights.ambient.a * base_color.rgb * occlusion * ssao;
  }

  let final_rgb = ambient + direct + material.emissive.rgb * emissive_sample.rgb;
  return vec4<f32>(final_rgb, base_color.a);
}

#import retro_engine::prepass

struct VsPrepassOut {
  @builtin(position) clip_position: vec4<f32>,
  @location(0) world_normal: vec3<f32>,
  @location(1) uv: vec2<f32>,
#ifdef PREPASS_MOTION_VECTOR
  @location(2) curr_clip: vec4<f32>,
  @location(3) prev_clip: vec4<f32>,
#endif
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
  let clip = view.view_proj * world_pos;
  out.clip_position = clip;
  out.world_normal = normalize((inverse_transpose_model * vec4<f32>(in.normal, 0.0)).xyz);
  out.uv = in.uv;
#ifdef PREPASS_MOTION_VECTOR
  let prev_model = mat4x4<f32>(in.prev_model_c0, in.prev_model_c1, in.prev_model_c2, in.prev_model_c3);
  // Reconstruct the current clip position from the jitter-free matrix so any
  // sub-pixel camera jitter (temporal AA) never leaks into the velocity.
  out.curr_clip = view.unjittered_view_proj * world_pos;
  out.prev_clip = view.prev_view_proj * prev_model * vec4<f32>(in.position, 1.0);
#endif
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

#ifdef PREPASS_MOTION_VECTOR
struct FsPrepassNormalMotionOut {
  @location(0) normal_roughness: vec4<f32>,
  @location(1) motion_vector: vec2<f32>,
};

@fragment
fn fs_prepass_motion(in: VsPrepassOut) -> @location(0) vec2<f32> {
  return compute_motion_vector(in.prev_clip, in.curr_clip);
}

@fragment
fn fs_prepass_normal_motion(in: VsPrepassOut) -> FsPrepassNormalMotionOut {
  var out: FsPrepassNormalMotionOut;
  let mr_sample = textureSample(metallic_roughness_texture, material_sampler, in.uv);
  let roughness = clamp(material.roughness * mr_sample.g, 0.04, 1.0);
  out.normal_roughness = encode_normal_roughness(in.world_normal, roughness);
  out.motion_vector = compute_motion_vector(in.prev_clip, in.curr_clip);
  return out;
}
#endif
` as const;
