import type { Entity } from '@retro-engine/ecs';
import type { ColorAttachment, RenderPassDescriptor } from '@retro-engine/renderer-core';

import { Light2dPipeline } from '../light2d/light-2d-pipeline';
import { Light2dPreparedBatches } from '../light2d/light-2d-batch';
import { Light2dInstanceBuffer } from '../light2d/light-2d-instance-buffer';
import { Light2dSettings } from '../light2d/light-2d-settings';
import { ViewLight2dTargets } from '../light2d/light-2d-targets';

import { Core2dLabel } from './core-2d';
import type { NodeRunContext, ViewNode } from './node';
import { createLabel } from './render-label';

/**
 * Label for the Phase 9 light accumulation pass node. Inserted by
 * `Light2dPlugin` into the Core2d sub-graph, ordered before
 * `OpaquePass2dLabel` so the chain reads
 * `Light2dAccumulationPass2d → OpaquePass2d → TransparentPass2d →
 * Light2dCompositePass2d`.
 */
export const Light2dAccumulationPass2dLabel = createLabel('light2d_accumulation_pass_2d');

/**
 * Core2d phase node owning the per-camera light accumulation pass.
 *
 * Pass shape:
 *
 * - Color attachment: the camera's `lightAccumView` (`rgba16float`). `loadOp:
 *   'clear'`, `clearValue` from `Light2dSettings.ambient` — the ambient
 *   floor every pixel sees before any light contributes.
 * - No depth attachment.
 *
 * After clearing, the node iterates the queue system's `Light2dPreparedBatches`
 * entry for this camera (one batch per camera in v1, holding every visible
 * light packed into the shared `Light2dInstanceBuffer`) and issues one
 * additive instanced draw against the accumulation pipeline.
 *
 * Skips silently — without even opening the pass — for cameras that are not
 * Core2d cameras, or when `ViewLight2dTargets` has no entry for the camera
 * (`Light2dPlugin` not installed, or first-frame race before the pipeline is
 * ready). When the cache entry exists but no lights are queued, the pass
 * still opens to perform the clear; the composite pass then reads pure
 * ambient.
 */
export const Light2dAccumulationPass2dNode: ViewNode = {
  label: Light2dAccumulationPass2dLabel,
  __viewNode: true as const,
  input: (): readonly never[] => [],
  output: (): readonly never[] => [],
  run(ctx: NodeRunContext): void {
    const view = ctx.view;
    const encoder = ctx.encoder;
    if (view === undefined) {
      throw new Error(
        'Light2dAccumulationPass2dNode: ctx.view is undefined; this node must run inside a camera-driven sub-graph.',
      );
    }
    if (encoder === undefined) {
      throw new Error(
        'Light2dAccumulationPass2dNode: ctx.encoder is undefined; the parent CameraDriverNode must open the frame encoder.',
      );
    }
    if (view.subGraph !== Core2dLabel) return;
    const targets = ctx.app.getResource(ViewLight2dTargets);
    const entry = targets?.perCamera.get(view.sourceEntity as Entity);
    if (entry === undefined) return;

    const settings = ctx.app.getResource(Light2dSettings);
    const ambient = settings?.ambient;
    const clearValue =
      ambient !== undefined
        ? {
            r: ambient[0] as number,
            g: ambient[1] as number,
            b: ambient[2] as number,
            a: ambient[3] as number,
          }
        : { r: 0, g: 0, b: 0, a: 1 };
    const colorAttachment: ColorAttachment = {
      view: entry.lightAccumView,
      loadOp: 'clear',
      storeOp: 'store',
      clearValue,
    };
    const passDesc: RenderPassDescriptor = {
      label: `camera#${view.sourceEntity}.light2d_accumulation`,
      colorAttachments: [colorAttachment],
    };
    const pass = encoder.beginRenderPass(passDesc);
    pass.setBindGroup(0, view.viewBindGroup);

    const pipeline = ctx.app.getResource(Light2dPipeline);
    const prepared = ctx.app.getResource(Light2dPreparedBatches);
    const instanceBuffer = ctx.app.getResource(Light2dInstanceBuffer);
    if (
      pipeline === undefined ||
      prepared === undefined ||
      instanceBuffer === undefined ||
      pipeline.accumulationPipeline === undefined ||
      pipeline.quadVertexBuffer === undefined ||
      pipeline.quadIndexBuffer === undefined ||
      instanceBuffer.buffer === undefined
    ) {
      pass.end();
      return;
    }
    const batch = prepared.forCamera(view.sourceEntity as Entity);
    if (batch === undefined || batch.count === 0) {
      pass.end();
      return;
    }
    pass.setPipeline(pipeline.accumulationPipeline);
    pass.setVertexBuffer(0, pipeline.quadVertexBuffer);
    pass.setVertexBuffer(1, instanceBuffer.buffer);
    pass.setIndexBuffer(pipeline.quadIndexBuffer, 'uint16');
    pass.drawIndexed(6, batch.count, 0, 0, batch.firstInstance);
    pass.end();
  },
};
