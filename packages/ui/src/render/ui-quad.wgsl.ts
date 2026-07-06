/**
 * WGSL for the in-game UI overlay pipeline: a solid-color, screen-space quad.
 *
 * The per-instance rect is already in **clip space** (mapped from logical pixels
 * on the CPU), so there is no view/projection uniform and no bind group — the
 * vertex shader just interpolates the unit quad across the instance's clip rect.
 *
 * Vertex layout (two buffers, the second steps per-instance):
 *
 * | Buffer | Slot | Format    | `@location` | Step     | Field                              |
 * |--------|------|-----------|-------------|----------|------------------------------------|
 * | 0      | 0    | float32x2 | 0           | vertex   | unit-quad corner (`[0,1]²`, TL→BR) |
 * | 1      | 0    | float32x4 | 1           | instance | clip rect `(left, top, right, bottom)` |
 * | 1      | 1    | unorm8x4  | 2           | instance | RGBA fill                          |
 */
export const UI_QUAD_WGSL = /* wgsl */ `
struct VsIn {
  @location(0) corner: vec2<f32>,
  @location(1) rect: vec4<f32>,
  @location(2) color: vec4<f32>,
};

struct VsOut {
  @builtin(position) clip_position: vec4<f32>,
  @location(0) color: vec4<f32>,
};

@vertex
fn vs_main(input: VsIn) -> VsOut {
  var out: VsOut;
  // rect = (clipLeft, clipTop, clipRight, clipBottom); corner in [0,1], (0,0)=top-left.
  let x = mix(input.rect.x, input.rect.z, input.corner.x);
  let y = mix(input.rect.y, input.rect.w, input.corner.y);
  out.clip_position = vec4<f32>(x, y, 0.0, 1.0);
  out.color = input.color;
  return out;
}

@fragment
fn fs_main(input: VsOut) -> @location(0) vec4<f32> {
  return input.color;
}
` as const;
