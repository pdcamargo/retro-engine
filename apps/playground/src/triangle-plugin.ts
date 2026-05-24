import type { Entity } from '@retro-engine/ecs';
import type { Plugin } from '@retro-engine/engine';
import {
  Camera2d,
  Commands,
  GlobalTransform,
  Parent,
  PipelineCache,
  Query,
  RenderCtx,
  Res,
  ResMut,
  Shader,
  SpecializedRenderPipelines,
  Time,
  Transform,
} from '@retro-engine/engine';
import { vec3 } from '@retro-engine/math';
import type { BindGroup, Buffer, TextureFormat } from '@retro-engine/renderer-core';
import { BufferUsage, ShaderStage } from '@retro-engine/renderer-core';

const TRIANGLE_WGSL = /* wgsl */ `
struct ColorUniforms {
  color: vec4<f32>,
};

@group(0) @binding(0) var<uniform> u: ColorUniforms;

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
  return u.color;
}
`;

// vec4<f32> aligned to 16 bytes — the smallest legal uniform binding size in WGSL.
const COLOR_BUFFER_SIZE = 16;

// Period (ms) for the debug log so the console doesn't drown in frame spam.
const TRANSFORM_LOG_PERIOD_MS = 1000;

// HSL → RGB in [0, 1]. Standard hue-rotation math; saturated colors with mid lightness.
const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (t0: number): number => {
    let t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [hue2rgb(h + 1 / 3), hue2rgb(h), hue2rgb(h - 1 / 3)];
};

interface TrianglePipelineKey {
  format: TextureFormat;
}

/**
 * Draws one triangle per frame whose color cycles through the hue wheel.
 *
 * Witnesses the HAL surface added in milestone A (uniform buffer with
 * `BufferUsage.UNIFORM | COPY_DST`, an explicit `BindGroupLayout` +
 * `PipelineLayout`, a `BindGroup` referencing the buffer, and a per-frame
 * `writeBuffer` + `setBindGroup` before the draw) plus the Phase 4 shader
 * surface — the shader is wrapped in a `Shader`, compiled through the
 * App-wide `PipelineCache`, and dispatched per frame through a
 * `SpecializedRenderPipelines` keyed by color-target format.
 *
 * The triangle still spawns as a transform-hierarchy witness — a parent with
 * a child offset, propagated each frame by `'postUpdate'`, and logged once
 * per second so an operator can confirm propagation is alive.
 */
export const trianglePlugin: Plugin = (app) => {
  const log = app.logger.child('triangle');
  let specializer: SpecializedRenderPipelines<TrianglePipelineKey> | undefined;
  let colorBuffer: Buffer | undefined;
  let colorBindGroup: BindGroup | undefined;
  let lastLogMs = -Infinity;
  const colorScratch = new Float32Array(4);

  app.addSystem('startup', [Commands, ResMut(PipelineCache)], (cmd, pipelineCache) => {
    const { renderer } = app;
    const triangleShader = new Shader(TRIANGLE_WGSL, { label: 'triangle' });
    const module = pipelineCache.compileShader(triangleShader);

    colorBuffer = renderer.createBuffer({
      size: COLOR_BUFFER_SIZE,
      usage: BufferUsage.UNIFORM | BufferUsage.COPY_DST,
      label: 'triangle-color',
    });

    const bindGroupLayout = renderer.createBindGroupLayout({
      label: 'triangle-color',
      entries: [{ binding: 0, visibility: ShaderStage.FRAGMENT, buffer: { type: 'uniform' } }],
    });
    const pipelineLayout = renderer.createPipelineLayout({
      label: 'triangle',
      bindGroupLayouts: [bindGroupLayout],
    });
    colorBindGroup = renderer.createBindGroup({
      label: 'triangle-color',
      layout: bindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: colorBuffer } }],
    });

    specializer = new SpecializedRenderPipelines<TrianglePipelineKey>(pipelineCache, (key) => ({
      label: 'triangle',
      layout: pipelineLayout,
      vertex: { module, entryPoint: 'vs_main' },
      fragment: {
        module,
        entryPoint: 'fs_main',
        targets: [{ format: key.format }],
      },
      primitive: { topology: 'triangle-list' },
    }));

    // Spawn the world camera. After ADR-0020, render systems fire once per
    // active camera; without a Camera2d / Camera3d the engine falls back to
    // a clear-only pass and the triangle would never draw.
    cmd.spawn(Camera2d());

    cmd.spawn(new Transform()).withChildren((parent) => {
      parent.spawn(new Transform(vec3.create(0.3, 0.0, 0.0)));
    });
  });

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

  app.addSystem('render', [RenderCtx, Res(Time)], (ctx, time) => {
    if (!specializer || !colorBuffer || !colorBindGroup) return;
    const hue = (time.virtual.elapsed * 0.25) % 1;
    const [r, g, b] = hslToRgb(hue, 1, 0.6);
    colorScratch[0] = r;
    colorScratch[1] = g;
    colorScratch[2] = b;
    colorScratch[3] = 1;
    app.renderer.writeBuffer(colorBuffer, 0, colorScratch);
    const pipeline = specializer.get({ format: app.renderer.getPreferredSurfaceFormat() });
    ctx.pass.setPipeline(pipeline);
    ctx.pass.setBindGroup(0, colorBindGroup);
    ctx.pass.draw(3);
  });
};
