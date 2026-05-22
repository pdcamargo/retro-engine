import type { Entity } from '@retro-engine/ecs';
import type { Plugin } from '@retro-engine/engine';
import {
  Commands,
  GlobalTransform,
  Parent,
  Query,
  RenderCtx,
  Transform,
} from '@retro-engine/engine';
import { vec3 } from '@retro-engine/math';
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

// Period (ms) for the debug log so the console doesn't drown in frame spam.
const TRANSFORM_LOG_PERIOD_MS = 1000;

/**
 * Draws one hardcoded triangle per frame and exercises M2 phase 7's transform
 * stack alongside it. The rendered triangle's vertex positions stay encoded in
 * WGSL because the renderer HAL does not expose uniform buffers yet — Mat4
 * uniforms land with sprite rendering. The witness here is component-level:
 * one triangle entity carries a `Transform`, a child entity demonstrates
 * propagation, and a debug system logs the computed `GlobalTransform.matrix`
 * once per second so the operator can verify propagation is alive.
 */
export const trianglePlugin: Plugin = (app) => {
  const log = app.logger.child('triangle');
  let pipeline: RenderPipeline | undefined;
  let lastLogMs = -Infinity;

  app.addSystem('startup', [Commands], (cmd) => {
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
    // Spawn the triangle as an ECS entity with a Transform, plus a child to
    // visibly exercise hierarchy propagation. Required Components auto-attach
    // GlobalTransform; the engine's PostUpdate propagation populates it.
    cmd.spawn(new Transform()).withChildren((parent) => {
      parent.spawn(new Transform(vec3.create(0.3, 0.0, 0.0)));
    });
  });

  // Each frame, the propagation system in PostUpdate writes the latest
  // GlobalTransform matrices. This 'last'-stage debug system reads them and
  // prints once per second so the console stays legible.
  app.addSystem(
    'last',
    [Query([GlobalTransform], { has: [Parent] })],
    (q) => {
      const nowMs = performance.now();
      if (nowMs - lastLogMs < TRANSFORM_LOG_PERIOD_MS) return;
      lastLogMs = nowMs;
      const roots: Array<{ e: Entity; matrix: Float32Array }> = [];
      const children: Array<{ e: Entity; matrix: Float32Array }> = [];
      for (const [entity, global, isChild] of q.entries()) {
        const slot = isChild ? children : roots;
        slot.push({ e: entity, matrix: global.matrix as Float32Array });
      }
      const summary = (label: string, items: typeof roots): string =>
        items
          .map(
            ({ e, matrix }) =>
              `${label} e=${e} t=(${matrix[12]!.toFixed(3)}, ${matrix[13]!.toFixed(3)}, ${matrix[14]!.toFixed(3)})`,
          )
          .join('; ');
      const summaryLine = [summary('root', roots), summary('child', children)]
        .filter((s) => s.length > 0)
        .join(' | ');
      if (summaryLine.length > 0) log.info(`propagated ${summaryLine}`);
    },
  );

  app.addSystem('render', [RenderCtx], (ctx) => {
    if (!pipeline) return;
    ctx.pass.setPipeline(pipeline);
    ctx.pass.draw(3);
  });
};
