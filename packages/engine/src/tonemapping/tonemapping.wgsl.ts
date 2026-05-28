/**
 * WGSL source for the engine's tonemap pipeline. Registered with
 * `ShaderRegistry` under `retro_engine::tonemapping` at plugin build time.
 *
 * Bind groups:
 *
 * - `@group(0)`: the per-camera HDR input — `hdr_tex` at binding 0 (the
 *   camera's `mainColorTarget` view, an `rgba16float` texture allocated by
 *   `CameraPlugin` when `Camera.hdr = true`), `hdr_sampler` at binding 1
 *   (a linear-clamp filtering sampler). The bind group is allocated
 *   per-camera and rebuilt whenever the HDR target is reallocated (size /
 *   format change).
 *
 * Vertex shader emits a fullscreen triangle from `vertex_index` (`0`, `1`,
 * `2`) — three vertices whose interpolated UVs cover `[0, 1]²` over the
 * screen-aligned `[-1, 1]²` clip-space rect. No vertex or index buffer is
 * bound; the draw is `pass.draw(3, 1, 0, 0)`.
 *
 * One fragment entry point per operator; the pipeline is specialized on
 * `Tonemapping.method` and selects the matching entry point. The operators
 * are pure-math polynomial implementations (no LUT) — see `tonemapping.ts`
 * for the rationale.
 *
 * Notes on the approximations:
 *
 * - `fs_aces_fitted` uses Stephen Hill's RRT+ODT fit — the industry-
 *   standard "filmic ACES" curve. Inputs and outputs are clamped to
 *   `[0, 1]` because the fit is only valid on the bounded range.
 * - `fs_agx` uses the polynomial approximation popularised by Benjamin
 *   Wrensch / three.js (`AgXToneMapping`). Drop-in for the AgX
 *   look without a LUT; replaceable with a LUT-based variant once the
 *   asset system lands.
 * - `fs_blender_filmic` is a polynomial fit of Blender's filmic curve;
 *   visually a soft-shoulder filmic with gentle highlight rolloff.
 * - `fs_somewhat_boring` implements Tomasz Stachowiak's
 *   "Somewhat-Boring-Display-Transform" — a predictable shoulder + soft
 *   desaturation. Cheaper than ACES, less aggressive than Reinhard.
 *
 * Output is written in linear space. The swapchain view is sRGB-encoding,
 * so the hardware applies the sRGB OETF on store. Operators whose curve
 * lands in linear (`None`, `Reinhard`, `ReinhardLuminance`, `ACES`, `SBDT`)
 * return their mapped color directly; operators whose curve fuses the
 * display transform with the tonemap (`AgX`, `BlenderFilmic`) explicitly
 * apply the inverse sRGB OETF before return so the view's OETF re-encodes
 * the intended display value bit-for-bit.
 */
export const TONEMAPPING_WGSL = /* wgsl */ `
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

@group(0) @binding(0) var hdr_tex: texture_2d<f32>;
@group(0) @binding(1) var hdr_sampler: sampler;

fn sample_hdr(uv: vec2<f32>) -> vec4<f32> {
  return textureSample(hdr_tex, hdr_sampler, uv);
}

fn luminance(c: vec3<f32>) -> f32 {
  return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}

// Inverse sRGB OETF (a.k.a. sRGB EOTF). Maps sRGB-display-encoded values
// back to linear so the swapchain view's sRGB OETF can re-encode them on
// store. Piecewise to match WebGPU's sRGB view encoding exactly — the
// gamma-2.2 approximation drifts by ~1.5% in the midtones.
fn srgb_to_linear(c: vec3<f32>) -> vec3<f32> {
  let lo = c / 12.92;
  let hi = pow((c + vec3<f32>(0.055)) / 1.055, vec3<f32>(2.4));
  return select(hi, lo, c <= vec3<f32>(0.04045));
}

// ---------- None ----------
@fragment
fn fs_none(input: VsOut) -> @location(0) vec4<f32> {
  return sample_hdr(input.uv);
}

// ---------- Reinhard (per-channel) ----------
@fragment
fn fs_reinhard(input: VsOut) -> @location(0) vec4<f32> {
  let s = sample_hdr(input.uv);
  let mapped = s.rgb / (vec3<f32>(1.0) + s.rgb);
  return vec4<f32>(mapped, s.a);
}

// ---------- Reinhard (luminance-preserving) ----------
@fragment
fn fs_reinhard_luminance(input: VsOut) -> @location(0) vec4<f32> {
  let s = sample_hdr(input.uv);
  let y = luminance(s.rgb);
  let yt = y / (1.0 + y);
  let mapped = s.rgb * (yt / max(y, 1e-5));
  return vec4<f32>(mapped, s.a);
}

// ---------- ACES Fitted (Stephen Hill polynomial) ----------
fn rrt_and_odt_fit(v: vec3<f32>) -> vec3<f32> {
  let a = v * (v + 0.0245786) - 0.000090537;
  let b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}

@fragment
fn fs_aces_fitted(input: VsOut) -> @location(0) vec4<f32> {
  let s = sample_hdr(input.uv);
  // Column-major mat3x3 (WGSL constructors take column vectors).
  let in_mat = mat3x3<f32>(
    vec3<f32>(0.59719, 0.07600, 0.02840),
    vec3<f32>(0.35458, 0.90834, 0.13383),
    vec3<f32>(0.04823, 0.01566, 0.83777),
  );
  let out_mat = mat3x3<f32>(
    vec3<f32>( 1.60475, -0.10208, -0.00327),
    vec3<f32>(-0.53108,  1.10813, -0.07276),
    vec3<f32>(-0.07367, -0.00605,  1.07602),
  );
  let aces_in = in_mat * s.rgb;
  let fit = rrt_and_odt_fit(aces_in);
  let mapped = clamp(out_mat * fit, vec3<f32>(0.0), vec3<f32>(1.0));
  return vec4<f32>(mapped, s.a);
}

// ---------- AgX (polynomial approximation, no LUT) ----------
fn agx_default_contrast(x: vec3<f32>) -> vec3<f32> {
  let x2 = x * x;
  let x4 = x2 * x2;
  let x6 = x4 * x2;
  return -17.86  * x6 * x
       +  78.01  * x6
       - 126.7   * x4 * x
       +  92.06  * x4
       -  28.72  * x2 * x
       +   4.361 * x2
       -   0.1718 * x
       +   0.002857;
}

@fragment
fn fs_agx(input: VsOut) -> @location(0) vec4<f32> {
  let s = sample_hdr(input.uv);
  let agx_in_mat = mat3x3<f32>(
    vec3<f32>(0.842479062253094, 0.0423282422610123, 0.0423756549057051),
    vec3<f32>(0.0784335999999992, 0.878468636469772,  0.0784336),
    vec3<f32>(0.0792237451477643, 0.0791661274605434, 0.879142973793104),
  );
  let agx_out_mat = mat3x3<f32>(
    vec3<f32>( 1.19687900512017,  -0.0528968517574562, -0.0529716355144438),
    vec3<f32>(-0.0980208811401368, 1.15190312990417,   -0.0980434501171241),
    vec3<f32>(-0.0990297440797205,-0.0989611768448433,  1.15107367264116),
  );
  let min_ev = -12.47393;
  let max_ev =   4.026069;

  // Guard against log2(0) — clamp to a tiny positive epsilon.
  var x = agx_in_mat * max(s.rgb, vec3<f32>(1e-10));
  x = clamp(log2(x), vec3<f32>(min_ev), vec3<f32>(max_ev));
  x = (x - vec3<f32>(min_ev)) / (max_ev - min_ev);
  x = agx_default_contrast(x);
  x = agx_out_mat * x;
  // AgX lands in display-encoded sRGB. Linearise via the inverse sRGB OETF
  // so the swapchain view's OETF re-encodes back to the same display value
  // on store.
  let display = clamp(x, vec3<f32>(0.0), vec3<f32>(1.0));
  return vec4<f32>(srgb_to_linear(display), s.a);
}

// ---------- Blender Filmic (polynomial approximation) ----------
@fragment
fn fs_blender_filmic(input: VsOut) -> @location(0) vec4<f32> {
  let s = sample_hdr(input.uv);
  // Hejl-Burgess-Dawson filmic curve — soft shoulder, gentle highlight
  // rolloff. Approximation of Blender's filmic display transform suitable
  // for a pure-math operator (a true Blender filmic match would consume
  // a baked spline LUT — see backlog).
  //
  // The H-B-D curve is a fused tonemap + 2.2 OETF — its output is
  // display-encoded, not linear. Apply the inverse sRGB OETF here so the
  // swapchain view's encode re-produces the intended display value (same
  // treatment as fs_agx).
  let x = max(vec3<f32>(0.0), s.rgb - 0.004);
  let mapped = (x * (6.2 * x + 0.5)) / (x * (6.2 * x + 1.7) + 0.06);
  return vec4<f32>(srgb_to_linear(mapped), s.a);
}

// ---------- Somewhat-Boring Display Transform (Stachowiak) ----------
@fragment
fn fs_somewhat_boring(input: VsOut) -> @location(0) vec4<f32> {
  let s = sample_hdr(input.uv);
  // Polynomial fit of Stachowiak's curve: per-channel Reinhard on a
  // slightly-desaturated input. The desaturation factor scales with
  // luminance so high-luminance pixels desaturate more (the "boring"
  // shape Stachowiak named the operator after).
  let y = luminance(s.rgb);
  let desat_strength = 1.0 - 1.0 / (1.0 + y);
  let desat = mix(s.rgb, vec3<f32>(y), desat_strength * 0.3);
  let mapped = desat / (vec3<f32>(1.0) + desat);
  return vec4<f32>(mapped, s.a);
}
` as const;
