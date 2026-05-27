/**
 * WGSL source for the engine's 2D light composite pipeline. Registered with
 * `ShaderRegistry` under `retro_engine::light2d_composite` at plugin build
 * time.
 *
 * Bind groups:
 *
 * - `@group(0)`: composite inputs for one camera — `base_color_tex` at
 *   binding 0 (the geometry pass output), `light_accum_tex` at binding 1
 *   (the accumulation pass output), `composite_sampler` at binding 2. The
 *   bind group is allocated per-camera and rebuilt whenever the underlying
 *   targets are reallocated.
 *
 * Vertex shader emits a fullscreen triangle from `vertex_index` (`0`, `1`,
 * `2`) — three vertices whose interpolated UVs cover `[0, 1]²` over the
 * screen-aligned `[-1, 1]²` clip-space rect. No vertex or index buffer is
 * bound; the draw is `pass.draw(3, 1, 0, 0)`.
 *
 * One fragment entry point per composite mode; the pipeline is specialized on
 * `Light2dSettings.compositeMode` and selects the matching entry point:
 *
 * - `fs_multiply` — `base.rgb * light.rgb` (the classic 2D lighting look).
 * - `fs_add` — `base.rgb + light.rgb` (additive overlay).
 * - `fs_screen` — `1 - (1 - base.rgb) * (1 - light.rgb)` (soft-light overlay).
 *
 * All three pass `base.alpha` straight through.
 */
export const LIGHT2D_COMPOSITE_WGSL = /* wgsl */ `
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

@group(0) @binding(0) var base_color_tex: texture_2d<f32>;
@group(0) @binding(1) var light_accum_tex: texture_2d<f32>;
@group(0) @binding(2) var composite_sampler: sampler;

struct CompositeInputs {
  base: vec4<f32>,
  light: vec4<f32>,
};

fn sample_inputs(uv: vec2<f32>) -> CompositeInputs {
  var inputs: CompositeInputs;
  inputs.base = textureSample(base_color_tex, composite_sampler, uv);
  inputs.light = textureSample(light_accum_tex, composite_sampler, uv);
  return inputs;
}

@fragment
fn fs_multiply(input: VsOut) -> @location(0) vec4<f32> {
  let s = sample_inputs(input.uv);
  return vec4<f32>(s.base.rgb * s.light.rgb, s.base.a);
}

@fragment
fn fs_add(input: VsOut) -> @location(0) vec4<f32> {
  let s = sample_inputs(input.uv);
  return vec4<f32>(s.base.rgb + s.light.rgb, s.base.a);
}

@fragment
fn fs_screen(input: VsOut) -> @location(0) vec4<f32> {
  let s = sample_inputs(input.uv);
  let screened = 1.0 - (1.0 - s.base.rgb) * (1.0 - s.light.rgb);
  return vec4<f32>(screened, s.base.a);
}
` as const;
