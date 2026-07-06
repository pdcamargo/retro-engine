import type { App, PluginObject } from '@retro-engine/engine';
import { CameraDriverLabel, Extract, Query, RenderGraph, RenderSet, Res, ResMut } from '@retro-engine/engine';

import { ComputedLayout, UiNode } from '../ui-node';
import { UiViewport } from '../ui-plugin';

import { makeUiPassNode, UiPassLabel } from './ui-pass-node';
import { UiPipeline } from './ui-pipeline';
import { prepareUiQuads, type UiQuadQuery } from './ui-prepare';

const devicePixelRatio = (): number =>
  typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;

/**
 * Draws the in-game UI (currently: `backgroundColor` quads) as a screen-space
 * overlay on top of the rendered scene. Add it alongside {@link UiPlugin}, which
 * produces the `ComputedLayout` this consumes.
 *
 * On `build` it inserts the {@link UiPipeline}, keeps {@link UiViewport} synced to
 * the canvas's logical size, and registers the prepare system. On `finish` it
 * adds a once-per-frame overlay node to the render graph, ordered after all
 * camera work. Headless-safe: with no surface, the prepare/pass steps no-op.
 */
export class UiRenderPlugin implements PluginObject {
  name(): string {
    return 'UiRenderPlugin';
  }

  build(app: App): void {
    if (app.getResource(UiPipeline) === undefined) app.insertResource(new UiPipeline());

    // Keep the UI viewport at the canvas's logical size so layout targets the
    // real screen and the overlay's clip mapping fills it. Headless (no surface
    // / no window) leaves the viewport default untouched.
    app.addSystem(
      'preUpdate',
      [ResMut(UiViewport)],
      (viewport) => {
        const surface = app.getSurface();
        if (surface === undefined) return;
        const dpr = devicePixelRatio();
        const vp = viewport as UiViewport;
        vp.width = Math.max(1, Math.round(surface.width / dpr));
        vp.height = Math.max(1, Math.round(surface.height / dpr));
      },
      { label: 'ui-viewport-sync' },
    );

    app.addSystem(
      'render',
      [Extract(Query([UiNode, ComputedLayout])), Res(UiViewport), ResMut(UiPipeline)],
      (nodes, viewport, pipeline) => {
        prepareUiQuads(app, nodes as unknown as UiQuadQuery, viewport as UiViewport, pipeline as UiPipeline);
      },
      { set: RenderSet.Prepare, label: 'ui-prepare' },
    );
  }

  finish(app: App): void {
    const graph = app.getResource(RenderGraph);
    if (graph === undefined) {
      throw new Error(
        'UiRenderPlugin: RenderGraph resource missing at finish(); the engine CorePlugin must build before UiRenderPlugin.',
      );
    }
    graph.addNode(makeUiPassNode());
    graph.addEdge(CameraDriverLabel, UiPassLabel);
  }
}
