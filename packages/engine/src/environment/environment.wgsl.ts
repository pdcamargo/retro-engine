/**
 * WGSL for the one-time environment-map prefilter bake (registered under
 * `retro_engine::environment_prefilter`). Three fragment entry points, all
 * driven by a fullscreen triangle and a `@group(0)` of { params uniform, source
 * cube, sampler }:
 *
 * - `fs_irradiance` — cosine-weighted hemisphere convolution of the source cube
 *   into a small diffuse irradiance cube (one render per face).
 * - `fs_prefilter` — GGX importance-sampled specular prefilter into a roughness
 *   mip chain (one render per face per mip; `params.roughness` set per mip).
 * - `fs_brdf` — split-sum BRDF integration into a 2D LUT (rendered once; content
 *   independent of the environment).
 *
 * `params.face` selects which cube face the current pass targets;
 * {@link faceDirectionWgsl} reconstructs the world direction for an in-face NDC
 * position. The split-sum math follows the standard real-time IBL formulation
 * (Karis 2013 / "split sum approximation").
 */
export const ENVIRONMENT_PREFILTER_WGSL = /* wgsl */ `
const PI: f32 = 3.14159265359;
const TWO_PI: f32 = 6.28318530718;
const HALF_PI: f32 = 1.57079632679;

struct PrefilterParams {
  // x = face index (0..5), y = roughness (specular pass), zw reserved.
  data: vec4<f32>,
};

@group(0) @binding(0) var<uniform> params: PrefilterParams;
@group(0) @binding(1) var src: texture_cube<f32>;
@group(0) @binding(2) var src_sampler: sampler;

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

// World-space direction for the cube face being rendered, at in-face position
// \`ndc\` (∈ [-1,1]²). Matches the standard cube-map convention so the baked
// faces line up with \`textureSample(cube, dir)\` at shade time. \`t\` flips NDC's
// up-axis to the texture's down-axis.
fn face_direction(face: u32, ndc: vec2<f32>) -> vec3<f32> {
  let s = ndc.x;
  let t = -ndc.y;
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

// Orthonormal basis around a normal for hemisphere / importance sampling.
fn tangent_basis(n: vec3<f32>) -> mat3x3<f32> {
  var up = vec3<f32>(0.0, 1.0, 0.0);
  if (abs(n.y) > 0.999) { up = vec3<f32>(0.0, 0.0, 1.0); }
  let tangent = normalize(cross(up, n));
  let bitangent = cross(n, tangent);
  return mat3x3<f32>(tangent, bitangent, n);
}

@fragment
fn fs_irradiance(in: VsOut) -> @location(0) vec4<f32> {
  let n = face_direction(u32(params.data.x), in.ndc);
  let basis = tangent_basis(n);
  var irradiance = vec3<f32>(0.0);
  var samples = 0.0;
  let phi_steps = 48u;
  let theta_steps = 16u;
  for (var p = 0u; p < phi_steps; p = p + 1u) {
    let phi = (f32(p) / f32(phi_steps)) * TWO_PI;
    for (var th = 0u; th < theta_steps; th = th + 1u) {
      let theta = (f32(th) / f32(theta_steps)) * HALF_PI;
      let sin_t = sin(theta);
      let cos_t = cos(theta);
      let local = vec3<f32>(sin_t * cos(phi), sin_t * sin(phi), cos_t);
      let world = basis * local;
      // cos·sin weight folds the projected-solid-angle term into the average.
      irradiance += textureSampleLevel(src, src_sampler, world, 0.0).rgb * cos_t * sin_t;
      samples += 1.0;
    }
  }
  irradiance = PI * irradiance / samples;
  return vec4<f32>(irradiance, 1.0);
}

// Van der Corput radical inverse → low-discrepancy Hammersley sequence.
fn radical_inverse_vdc(input: u32) -> f32 {
  var bits = input;
  bits = (bits << 16u) | (bits >> 16u);
  bits = ((bits & 0x55555555u) << 1u) | ((bits & 0xAAAAAAAAu) >> 1u);
  bits = ((bits & 0x33333333u) << 2u) | ((bits & 0xCCCCCCCCu) >> 2u);
  bits = ((bits & 0x0F0F0F0Fu) << 4u) | ((bits & 0xF0F0F0F0u) >> 4u);
  bits = ((bits & 0x00FF00FFu) << 8u) | ((bits & 0xFF00FF00u) >> 8u);
  return f32(bits) * 2.3283064365386963e-10;
}

fn hammersley(i: u32, n: u32) -> vec2<f32> {
  return vec2<f32>(f32(i) / f32(n), radical_inverse_vdc(i));
}

// Sample a half-vector from the GGX distribution for the given roughness.
fn importance_sample_ggx(xi: vec2<f32>, n: vec3<f32>, roughness: f32) -> vec3<f32> {
  let a = roughness * roughness;
  let phi = TWO_PI * xi.x;
  let cos_theta = sqrt((1.0 - xi.y) / (1.0 + (a * a - 1.0) * xi.y));
  let sin_theta = sqrt(1.0 - cos_theta * cos_theta);
  let h_local = vec3<f32>(cos(phi) * sin_theta, sin(phi) * sin_theta, cos_theta);
  return tangent_basis(n) * h_local;
}

@fragment
fn fs_prefilter(in: VsOut) -> @location(0) vec4<f32> {
  let n = face_direction(u32(params.data.x), in.ndc);
  let roughness = params.data.y;
  // Isotropic prefilter assumption: view == reflection == normal.
  let v = n;
  let sample_count = 128u;
  var prefiltered = vec3<f32>(0.0);
  var total_weight = 0.0;
  for (var i = 0u; i < sample_count; i = i + 1u) {
    let xi = hammersley(i, sample_count);
    let h = importance_sample_ggx(xi, n, roughness);
    let l = normalize(2.0 * dot(v, h) * h - v);
    let n_dot_l = max(dot(n, l), 0.0);
    if (n_dot_l > 0.0) {
      prefiltered += textureSampleLevel(src, src_sampler, l, 0.0).rgb * n_dot_l;
      total_weight += n_dot_l;
    }
  }
  return vec4<f32>(prefiltered / max(total_weight, 0.001), 1.0);
}

fn geometry_schlick_ggx_ibl(n_dot_v: f32, roughness: f32) -> f32 {
  // IBL geometry term uses k = a²/2 (vs (a+1)²/8 for direct lighting).
  let a = roughness;
  let k = (a * a) / 2.0;
  return n_dot_v / (n_dot_v * (1.0 - k) + k);
}

fn geometry_smith_ibl(n_dot_v: f32, n_dot_l: f32, roughness: f32) -> f32 {
  return geometry_schlick_ggx_ibl(n_dot_v, roughness) * geometry_schlick_ggx_ibl(n_dot_l, roughness);
}

@fragment
fn fs_brdf(in: VsOut) -> @location(0) vec4<f32> {
  let uv = in.ndc * 0.5 + 0.5;
  let n_dot_v = max(uv.x, 1e-3);
  let roughness = uv.y;
  let v = vec3<f32>(sqrt(1.0 - n_dot_v * n_dot_v), 0.0, n_dot_v);
  let n = vec3<f32>(0.0, 0.0, 1.0);
  let sample_count = 512u;
  var a = 0.0;
  var b = 0.0;
  for (var i = 0u; i < sample_count; i = i + 1u) {
    let xi = hammersley(i, sample_count);
    let h = importance_sample_ggx(xi, n, roughness);
    let l = normalize(2.0 * dot(v, h) * h - v);
    let n_dot_l = max(l.z, 0.0);
    let n_dot_h = max(h.z, 0.0);
    let v_dot_h = max(dot(v, h), 0.0);
    if (n_dot_l > 0.0) {
      let g = geometry_smith_ibl(n_dot_v, n_dot_l, roughness);
      let g_vis = (g * v_dot_h) / (n_dot_h * n_dot_v);
      let fc = pow(1.0 - v_dot_h, 5.0);
      a += (1.0 - fc) * g_vis;
      b += fc * g_vis;
    }
  }
  return vec4<f32>(a / f32(sample_count), b / f32(sample_count), 0.0, 1.0);
}
` as const;
