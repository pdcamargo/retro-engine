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
 * Fragment shader samples both inputs at the screen UV and emits
 * `base.rgb * light.rgb` — v1 of Phase 9 implements **only** the multiply
 * composite mode. `add` and `screen` modes are reserved on
 * `Light2dSettings.compositeMode` and ship as a follow-on (see ADR-0037
 * §"Not yet done").
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

@fragment
fn fs_main(input: VsOut) -> @location(0) vec4<f32> {
  let base = textureSample(base_color_tex, composite_sampler, input.uv);
  let light = textureSample(light_accum_tex, composite_sampler, input.uv);
  return vec4<f32>(base.rgb * light.rgb, base.a);
}
` as const;
