import { Camera } from '../camera/camera';
import type { App } from '../index';
import type { PluginObject } from '../plugin';
import { Core2dLabel } from '../render-graph/core-2d';
import { Core3dLabel } from '../render-graph/core-3d';
import {
  Light2dCompositePass2dLabel,
} from '../render-graph/light2d-composite-pass-2d-node';
import { RenderGraph } from '../render-graph/render-graph';
import { TransparentPass2dLabel } from '../render-graph/transparent-pass-2d-node';
import { TransparentPass3dLabel } from '../render-graph/transparent-pass-3d-node';
import { RenderSet } from '../render-set';
import { ShaderRegistry } from '../shader/shader-registry';
import { Extract, Query, ResMut } from '../system-param';

import { t } from '@retro-engine/reflect';

import { Tonemapping, TONEMAPPING_METHODS } from './tonemapping';
import {
  makeTonemappingNode,
  TonemappingPass2dLabel,
  TonemappingPass3dLabel,
} from './tonemapping-node';
import { TonemappingPipeline } from './tonemapping-pipeline';
import { TONEMAPPING_WGSL } from './tonemapping.wgsl';
import { ViewTonemapping } from './view-tonemapping';

/**
 * Engine-internal plugin that wires the per-camera tonemap pass.
 *
 * Auto-installed by `CorePlugin` so an HDR camera (`Camera.hdr = true`)
 * paired with a `Tonemapping` component renders correctly out of the box.
 * Registering it manually is harmless — `isUnique()` is true, so a second
 * `addPlugin(new TonemappingPlugin())` throws.
 *
 * What it does on `build`:
 *
 * 1. Registers the `retro_engine::tonemapping` WGSL module with the
 *    `ShaderRegistry` (idempotent).
 * 2. Inserts the `TonemappingPipeline` render-world resource (held until
 *    `App.stop`) and the `ViewTonemapping` extract-target resource
 *    (rebuilt each frame).
 * 3. Registers the `extractTonemapping` system in `RenderSet.Extract`.
 *
 * What it does on `finish` (after every other plugin's `build` completed,
 * so optional upstream nodes like `Light2dCompositePass2dLabel` are
 * already present if their plugin was installed):
 *
 * - Inserts the `TonemappingPass2dLabel` node into `Core2d` ordered after
 *   `TransparentPass2dLabel` and, if present, after
 *   `Light2dCompositePass2dLabel` — both edges so the topological sort
 *   places tonemap last regardless of which paths the scene uses.
 * - Inserts the `TonemappingPass3dLabel` node into `Core3d` ordered after
 *   `TransparentPass3dLabel`.
 *
 * The tonemap node itself skips silently when the active camera has
 * `hdr === false` or no `Tonemapping` component, so non-HDR scenes pay
 * the cost of one graph edge and nothing else.
 */
export class TonemappingPlugin implements PluginObject {
  name(): string {
    return 'TonemappingPlugin';
  }

  build(app: App): void {
    const registry = app.getResource(ShaderRegistry);
    if (registry === undefined) {
      throw new Error(
        'TonemappingPlugin: ShaderRegistry resource missing; ShaderPlugin must run before TonemappingPlugin.',
      );
    }
    (registry as ShaderRegistry).register('retro_engine::tonemapping', TONEMAPPING_WGSL);

    app.registerComponent(
      Tonemapping,
      { method: t.enum(...TONEMAPPING_METHODS) },
      { name: 'Tonemapping' },
    );

    if (app.getResource(TonemappingPipeline) === undefined) {
      app.insertResource(new TonemappingPipeline());
    }
    if (app.getResource(ViewTonemapping) === undefined) {
      app.insertResource(new ViewTonemapping());
    }

    app.addSystem(
      'render',
      [Extract(Query([Camera, Tonemapping])), ResMut(ViewTonemapping)],
      (q, viewTm) => {
        viewTm.byCamera.clear();
        for (const [entity, camera, tm] of q.entries()) {
          if (!camera.isActive) continue;
          viewTm.byCamera.set(entity, tm.method);
        }
      },
      { set: RenderSet.Extract, label: 'tonemapping-extract' },
    );
  }

  finish(app: App): void {
    const graph = app.getResource(RenderGraph);
    if (graph === undefined) {
      throw new Error(
        'TonemappingPlugin: RenderGraph resource missing at finish(); RenderGraphPlugin must have built before TonemappingPlugin.',
      );
    }

    const sub2d = graph.getSubGraph(Core2dLabel);
    if (sub2d === undefined) {
      throw new Error(
        'TonemappingPlugin: Core2d sub-graph missing at finish(); RenderGraphPlugin must have registered it.',
      );
    }
    sub2d.addNode(makeTonemappingNode(TonemappingPass2dLabel));
    sub2d.addEdge(TransparentPass2dLabel, TonemappingPass2dLabel);
    if (sub2d.hasNode(Light2dCompositePass2dLabel)) {
      sub2d.addEdge(Light2dCompositePass2dLabel, TonemappingPass2dLabel);
    }

    const sub3d = graph.getSubGraph(Core3dLabel);
    if (sub3d === undefined) {
      throw new Error(
        'TonemappingPlugin: Core3d sub-graph missing at finish(); RenderGraphPlugin must have registered it.',
      );
    }
    sub3d.addNode(makeTonemappingNode(TonemappingPass3dLabel));
    sub3d.addEdge(TransparentPass3dLabel, TonemappingPass3dLabel);
  }
}
