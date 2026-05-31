// Dev-only visualization node for the screen-space motion-vector prepass
// (ADR-0050 / ADR-0051). Samples the camera's rg16float motion target and
// blits |velocity| to the swapchain as red/green so a human can confirm the
// prepass actually produced motion data on a real device — static geometry
// reads black, moving meshes glow. This lives in the playground (dev tooling),
// never in a shipped package.

import {
  Core3dLabel,
  RenderGraph,
  TransparentPass3dLabel,
  ViewPrepassTargets,
  createLabel,
  type App,
  type RenderNodeRunContext,
  type ViewNode,
} from '@retro-engine/engine';
import type {
  BindGroup,
  BindGroupLayout,
  PipelineLayout,
  RenderPipeline,
  Sampler,
  ShaderModule,
  TextureFormat,
  TextureView,
} from '@retro-engine/renderer-core';
import { ShaderStage } from '@retro-engine/renderer-core';

const MotionVectorDebugLabel = createLabel('playground::motion_vector_debug');

// Scale applied to |velocity| before display. Frame-to-frame screen motion is
// small (a fast object covers a few percent of the screen per frame), so raw
// half-NDC magnitudes would be near-black; this lifts them into a visible range.
const VELOCITY_DISPLAY_SCALE = 25.0;

const MOTION_VECTOR_DEBUG_WGSL = /* wgsl */ `
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

@group(0) @binding(0) var motion_tex: texture_2d<f32>;
@group(0) @binding(1) var motion_sampler: sampler;

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
  let mv = textureSample(motion_tex, motion_sampler, in.uv).rg;
  let scale = ${VELOCITY_DISPLAY_SCALE.toFixed(1)};
  return vec4<f32>(abs(mv.x) * scale, abs(mv.y) * scale, 0.0, 1.0);
}
`;

/**
 * Build the motion-vector debug `ViewNode`. Lazily creates its GPU resources on
 * first run (the device is not available until the App's first frame).
 */
const makeMotionVectorDebugNode = (): ViewNode => {
  let module: ShaderModule | undefined;
  let layout: BindGroupLayout | undefined;
  let pipelineLayout: PipelineLayout | undefined;
  let sampler: Sampler | undefined;
  const pipelineByFormat = new Map<TextureFormat, RenderPipeline>();
  let cachedView: TextureView | undefined;
  let cachedBindGroup: BindGroup | undefined;
  let warnedNoMotion = false;

  return {
    label: MotionVectorDebugLabel,
    __viewNode: true as const,
    input: () => [],
    output: () => [],
    run(ctx: RenderNodeRunContext): void {
      const view = ctx.view;
      const encoder = ctx.encoder;
      if (view === undefined || encoder === undefined) return;

      const targets = ctx.app.getResource(ViewPrepassTargets);
      const entry = targets?.perCamera.get(view.sourceEntity as never);
      const motionView = entry?.motionView;
      if (motionView === undefined) {
        if (!warnedNoMotion) {
          warnedNoMotion = true;
          const keys = targets === undefined ? 'no ViewPrepassTargets resource' : [...targets.perCamera.keys()].join(',');
          ctx.app.logger
            .child('motion-vector-debug')
            .warn(
              `no motion target; view.sourceEntity=${view.sourceEntity}, perCamera keys=[${keys}], entry=${entry === undefined ? 'undefined' : `{depth:${entry.flags.depth},normal:${entry.flags.normal},motion:${entry.flags.motionVector},motionView:${entry.motionView !== undefined}}`}`,
            );
        }
        return;
      }

      const renderer = ctx.app.renderer;
      if (module === undefined) {
        module = renderer.createShaderModule({
          label: 'motion-vector-debug',
          code: MOTION_VECTOR_DEBUG_WGSL,
        });
        sampler = renderer.createSampler({
          label: 'motion-vector-debug-sampler',
          magFilter: 'linear',
          minFilter: 'linear',
          addressModeU: 'clamp-to-edge',
          addressModeV: 'clamp-to-edge',
        });
        layout = renderer.createBindGroupLayout({
          label: 'motion-vector-debug-layout',
          entries: [
            {
              binding: 0,
              visibility: ShaderStage.FRAGMENT,
              texture: { sampleType: 'float', viewDimension: '2d', multisampled: false },
            },
            { binding: 1, visibility: ShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
          ],
        });
        pipelineLayout = renderer.createPipelineLayout({
          label: 'motion-vector-debug-pipeline-layout',
          bindGroupLayouts: [layout],
        });
      }

      const format = view.target.format;
      let pipeline = pipelineByFormat.get(format);
      if (pipeline === undefined) {
        pipeline = renderer.createRenderPipeline({
          label: `motion-vector-debug|f=${format}`,
          layout: pipelineLayout!,
          vertex: { module, entryPoint: 'vs_main', buffers: [] },
          fragment: { module, entryPoint: 'fs_main', targets: [{ format }] },
          primitive: { topology: 'triangle-list', cullMode: 'none', frontFace: 'ccw' },
        });
        pipelineByFormat.set(format, pipeline);
      }

      if (cachedView !== motionView) {
        cachedBindGroup?.destroy();
        cachedBindGroup = renderer.createBindGroup({
          label: `motion-vector-debug-input#${view.sourceEntity}`,
          layout: layout!,
          entries: [
            { binding: 0, resource: motionView },
            { binding: 1, resource: sampler! },
          ],
        });
        cachedView = motionView;
      }

      const pass = encoder.beginRenderPass({
        label: `camera#${view.sourceEntity}.motion-vector-debug`,
        colorAttachments: [
          {
            view: view.target.view,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
          },
        ],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, cachedBindGroup!);
      pass.draw(3, 1, 0, 0);
      pass.end();
    },
  };
};

/**
 * Insert the motion-vector debug blit into the Core3d sub-graph, ordered after
 * the transparent pass so it is the last node to touch the swapchain (the scene
 * camera here is non-HDR, so the tonemapping node is skipped and does not
 * compete for it). Overwrites the swapchain with the visualization, so it is
 * for inspection only (`?debug=motion`). Call after the prepass node is wired
 * (i.e. after `PrepassPlugin` is added).
 */
export const installMotionVectorDebug = (app: App): void => {
  const graph = app.getResource(RenderGraph);
  if (graph === undefined) return;
  const sub3d = graph.getSubGraph(Core3dLabel);
  if (sub3d === undefined) return;
  sub3d.addNode(makeMotionVectorDebugNode());
  sub3d.addEdge(TransparentPass3dLabel, MotionVectorDebugLabel);
};
