import type { Plugin } from '@retro-engine/engine';
import { RenderCtx } from '@retro-engine/engine';
import type { RenderPipeline } from '@retro-engine/renderer-core';

const TRIANGLE_WGSL = /* wgsl */ `
@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>( 0.0,  0.5),
    vec2<f32>(-0.5, -0.5),
    vec2<f32>( 0.5, -0.5),
  );
  return vec4<f32>(positions[vi], 0.0, 1.0);
}

@fragment
fn fs_main() -> @location(0) vec4<f32> {
  return vec4<f32>(1.0, 0.4, 0.7, 1.0);
}
`;

/** Draws one hardcoded triangle each frame. The smoke test that proves the HAL is load-bearing. */
export const trianglePlugin: Plugin = (app) => {
  let pipeline: RenderPipeline | undefined;

  app.addSystem('startup', [], () => {
    const { renderer } = app;
    const module = renderer.createShaderModule({ code: TRIANGLE_WGSL, label: 'triangle' });
    pipeline = renderer.createRenderPipeline({
      label: 'triangle',
      vertex: { module, entryPoint: 'vs_main' },
      fragment: {
        module,
        entryPoint: 'fs_main',
        targets: [{ format: renderer.getPreferredSurfaceFormat() }],
      },
      primitive: { topology: 'triangle-list' },
    });
  });

  app.addSystem('render', [RenderCtx], (ctx) => {
    if (!pipeline) return;
    ctx.pass.setPipeline(pipeline);
    ctx.pass.draw(3);
  });
};
