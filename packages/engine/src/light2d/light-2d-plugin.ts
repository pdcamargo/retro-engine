import type { Entity, Query as QueryHandle } from '@retro-engine/ecs';

import { SortedCameras } from '../camera/sorted-cameras';
import type { App } from '../index';
import type { PluginObject } from '../plugin';
import { Core2dLabel } from '../render-graph/core-2d';
import {
  Light2dAccumulationPass2dLabel,
  Light2dAccumulationPass2dNode,
} from '../render-graph/light2d-accumulation-pass-2d-node';
import {
  Light2dCompositePass2dLabel,
  Light2dCompositePass2dNode,
} from '../render-graph/light2d-composite-pass-2d-node';
import { OpaquePass2dLabel } from '../render-graph/opaque-pass-2d-node';
import { RenderGraph } from '../render-graph/render-graph';
import { TransparentPass2dLabel } from '../render-graph/transparent-pass-2d-node';
import { RenderSet } from '../render-set';
import { ShaderRegistry } from '../shader/shader-registry';
import { Extract, Query, Res, ResMut } from '../system-param';
import { GlobalTransform } from '../transform';
import { ViewVisibility } from '../visibility/visibility';

import { LIGHT2D_ACCUMULATION_WGSL } from './light-2d-accumulation.wgsl';
import {
  type Light2dBatch,
  LIGHT2D_INSTANCE_FLOAT_COUNT,
  Light2dPreparedBatches,
  packLightInstance,
} from './light-2d-batch';
import { LIGHT2D_COMPOSITE_WGSL } from './light-2d-composite.wgsl';
import { Light2dInstanceBuffer } from './light-2d-instance-buffer';
import { Light2dPipeline } from './light-2d-pipeline';
import { Light2dSettings } from './light-2d-settings';
import { prepareLight2dTargets, ViewLight2dTargets } from './light-2d-targets';
import { PointLight2d } from './point-light-2d';

/**
 * Engine plugin owning the built-in 2D-lighting pipeline (Phase 9.1).
 *
 * On `build`:
 *
 * - Registers `retro_engine::light2d_accumulation` and
 *   `retro_engine::light2d_composite` WGSL modules with {@link ShaderRegistry}.
 * - Inserts the lighting render-world resources idempotently:
 *   {@link Light2dPipeline}, {@link Light2dInstanceBuffer},
 *   {@link Light2dPreparedBatches}, {@link ViewLight2dTargets},
 *   and {@link Light2dSettings} (default `(0, 0, 0, 1)` ambient,
 *   `'multiply'` composite mode).
 * - Adds two nodes to the engine's Core2d sub-graph:
 *   {@link Light2dAccumulationPass2dNode} (before the opaque pass) and
 *   {@link Light2dCompositePass2dNode} (after the transparent pass).
 *   Final per-camera order:
 *   `Light2dAccumulationPass2d → OpaquePass2d → TransparentPass2d →
 *   Light2dCompositePass2d`.
 * - Registers two render-stage systems:
 *   - `light2d-prepare-targets` in {@link RenderSet.Prepare}: ensures every
 *     active Core2d camera has a `baseColor` + `lightAccum` texture pair
 *     plus a composite bind group. Resizes / GCs entries as cameras come
 *     and go.
 *   - `light2d-queue` in {@link RenderSet.Queue}: iterates visible
 *     `(PointLight2d, GlobalTransform, ViewVisibility)` entities, packs them
 *     into the shared instance buffer, and emits one batch per Core2d
 *     camera pointing at the packed range.
 *
 * Unique. Layering on top of `SpritePlugin` or `Material2dPlugin` is the
 * intended usage; the plugin does not depend on them — installing
 * `Light2dPlugin` alone produces a dim-by-ambient screen.
 */
export class Light2dPlugin implements PluginObject {
  name(): string {
    return 'Light2dPlugin';
  }

  build(app: App): void {
    const registry = app.getResource(ShaderRegistry);
    if (registry === undefined) {
      throw new Error(
        'Light2dPlugin: ShaderRegistry resource missing; ShaderPlugin must run before Light2dPlugin.',
      );
    }
    if (!registry.has('retro_engine::light2d_accumulation')) {
      registry.register('retro_engine::light2d_accumulation', LIGHT2D_ACCUMULATION_WGSL);
    }
    if (!registry.has('retro_engine::light2d_composite')) {
      registry.register('retro_engine::light2d_composite', LIGHT2D_COMPOSITE_WGSL);
    }
    if (app.getResource(Light2dPipeline) === undefined) {
      app.insertResource(new Light2dPipeline());
    }
    if (app.getResource(Light2dInstanceBuffer) === undefined) {
      app.insertResource(new Light2dInstanceBuffer());
    }
    if (app.getResource(Light2dPreparedBatches) === undefined) {
      app.insertResource(new Light2dPreparedBatches());
    }
    if (app.getResource(ViewLight2dTargets) === undefined) {
      app.insertResource(new ViewLight2dTargets());
    }
    if (app.getResource(Light2dSettings) === undefined) {
      app.insertResource(new Light2dSettings());
    }

    const graph = app.getResource(RenderGraph);
    if (graph === undefined) {
      throw new Error(
        'Light2dPlugin: RenderGraph resource missing; RenderGraphPlugin must run before Light2dPlugin.',
      );
    }
    const sub = graph.getSubGraph(Core2dLabel);
    if (sub === undefined) {
      throw new Error(
        'Light2dPlugin: Core2d sub-graph missing; RenderGraphPlugin must build the sub-graph before Light2dPlugin.',
      );
    }
    sub.addNode(Light2dAccumulationPass2dNode);
    sub.addNode(Light2dCompositePass2dNode);
    sub.addEdge(Light2dAccumulationPass2dLabel, OpaquePass2dLabel);
    sub.addEdge(TransparentPass2dLabel, Light2dCompositePass2dLabel);

    app.addSystem(
      'render',
      [Res(SortedCameras), ResMut(ViewLight2dTargets), ResMut(Light2dPipeline)],
      (cameras, targets, pipeline) => {
        prepareLight2dTargets(
          app,
          cameras as SortedCameras,
          targets as ViewLight2dTargets,
          pipeline as Light2dPipeline,
        );
      },
      { set: RenderSet.Prepare, label: 'light2d-prepare-targets' },
    );

    type LightQuery = QueryHandle<
      readonly [typeof PointLight2d, typeof GlobalTransform, typeof ViewVisibility]
    >;

    app.addSystem(
      'render',
      [
        Extract(Query([PointLight2d, GlobalTransform, ViewVisibility])),
        Res(SortedCameras),
        ResMut(Light2dInstanceBuffer),
        ResMut(Light2dPreparedBatches),
      ],
      (lights, cameras, instanceBuffer, prepared) => {
        queueLight2dInstances(
          app,
          lights as unknown as LightQuery,
          cameras as SortedCameras,
          instanceBuffer as Light2dInstanceBuffer,
          prepared as Light2dPreparedBatches,
        );
      },
      { set: RenderSet.Queue, label: 'light2d-queue' },
    );
  }
}

const queueLight2dInstances = (
  app: App,
  lights: QueryHandle<
    readonly [typeof PointLight2d, typeof GlobalTransform, typeof ViewVisibility]
  >,
  cameras: SortedCameras,
  instanceBuffer: Light2dInstanceBuffer,
  prepared: Light2dPreparedBatches,
): void => {
  prepared.batches.length = 0;
  instanceBuffer.count = 0;

  // Collect visible lights once. In v1 every Core2d camera sees the same
  // visible set (no per-camera render-layer filtering yet), so we pack
  // once and point every camera's batch at the same range.
  const visible: { light: PointLight2d; gt: GlobalTransform }[] = [];
  for (const row of lights.entries()) {
    const light = row[1] as PointLight2d;
    const gt = row[2] as GlobalTransform;
    const vis = row[3] as ViewVisibility;
    if (!vis.visible) continue;
    visible.push({ light, gt });
  }

  // Even with no visible lights, emit one batch per Core2d camera with
  // `count = 0` so the accumulation node still performs its clear (the
  // composite pass needs the lightAccum texture to be in a known state —
  // the ambient floor — even when no light contributes).
  let count = 0;
  if (visible.length > 0) {
    instanceBuffer.ensureCapacity(app.renderer, visible.length);
    let cursor = 0;
    for (const { light, gt } of visible) {
      cursor += packLightInstance(light, gt.matrix, instanceBuffer.scratchF32, cursor);
    }
    count = visible.length;
    instanceBuffer.count = count;
    if (instanceBuffer.buffer !== undefined && cursor > 0) {
      const view = instanceBuffer.scratchF32.subarray(0, cursor);
      app.renderer.writeBuffer(instanceBuffer.buffer, 0, view as unknown as BufferSource);
    }
  }
  // Touch LIGHT2D_INSTANCE_FLOAT_COUNT to keep the symbol exported under
  // CLAUDE.md §5.5 — the floats-per-instance constant is the bench's
  // canonical reference for the per-instance layout.
  void LIGHT2D_INSTANCE_FLOAT_COUNT;

  for (const view of cameras.views) {
    if (view.subGraph !== Core2dLabel) continue;
    const batch: Light2dBatch = {
      sourceEntity: view.sourceEntity as Entity,
      firstInstance: 0,
      count,
    };
    prepared.batches.push(batch);
  }
};
