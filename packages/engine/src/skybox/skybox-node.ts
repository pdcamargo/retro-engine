import type { Entity } from '@retro-engine/ecs';
import type {
  ColorAttachment,
  DepthStencilAttachment,
  RenderPassDescriptor,
} from '@retro-engine/renderer-core';

import { resolveEnvironmentCubeView } from '../environment/environment-cube';
import { RenderImages } from '../image/image-plugin';
import type { NodeRunContext, ViewNode } from '../render-graph/node';
import { createLabel } from '../render-graph/render-label';

import { SkyboxPipeline } from './skybox-pipeline';
import { ViewSkybox } from './view-skybox';

/**
 * Label for the Core3d skybox pass node. Inserted by `SkyboxPlugin` between
 * `OpaquePass3dLabel` and `TransparentPass3dLabel`, so the sky is drawn behind
 * transparent geometry but in front of nothing opaque.
 */
export const SkyboxPass3dLabel = createLabel('skybox_pass_3d');

/**
 * Build the skybox `ViewNode`.
 *
 * Skips silently when the camera has no extracted `Skybox`, the pipeline has
 * not initialised yet (first-frame race), or the environment cube image has
 * not finished uploading. Otherwise it draws one fullscreen triangle into the
 * camera's main color target, depth-tested against the scene so opaque geometry
 * occludes the sky.
 */
export const makeSkyboxNode = (): ViewNode => ({
  label: SkyboxPass3dLabel,
  __viewNode: true as const,
  input: (): readonly never[] => [],
  output: (): readonly never[] => [],
  run(ctx: NodeRunContext): void {
    const view = ctx.view;
    const encoder = ctx.encoder;
    if (view === undefined || encoder === undefined) return;

    const entity = view.sourceEntity as Entity;
    const params = ctx.app.getResource(ViewSkybox)?.byCamera.get(entity);
    if (params === undefined) return;

    const pipeline = ctx.app.getResource(SkyboxPipeline);
    if (pipeline === undefined) return;
    if (!pipeline.ensureInitialised(ctx.app)) return;

    const renderImage = ctx.app.getResource(RenderImages)?.get(params.image);
    if (renderImage === undefined) return; // Source image not uploaded yet.

    // Cube sources pass through; an equirectangular (e.g. `.hdr`) source is
    // converted to a cube on demand and cached.
    const cube = resolveEnvironmentCubeView(ctx.app, params.image, renderImage);
    if (cube === undefined) return;

    const bindGroup = pipeline.bindGroupFor(ctx.app, entity, cube.view, cube.sampler);

    const colorTargetView = view.mainColorTarget.view;
    const colorAttachment: ColorAttachment = {
      view: colorTargetView,
      // Load the opaque silhouette; the sky composites into the gaps it left.
      loadOp: 'load',
      storeOp: 'store',
    };
    const passDesc: RenderPassDescriptor = {
      label: `camera#${view.sourceEntity}.skybox`,
      colorAttachments: [colorAttachment],
    };
    const depthFormat = view.depth ? view.depth.format : null;
    if (view.depth) {
      // Load and keep the scene depth so geometry occludes the sky. The pass
      // never writes depth (`depthWriteEnabled: false`); `depthReadOnly` is
      // intentionally not set — WebGPU forbids pairing it with explicit
      // load/store ops.
      const depthAttachment: DepthStencilAttachment = {
        view: view.depth.view,
        depthLoadOp: 'load',
        depthStoreOp: 'store',
      };
      passDesc.depthStencilAttachment = depthAttachment;
    }

    const pass = encoder.beginRenderPass(passDesc);
    pass.setPipeline(pipeline.pipeline({ colorFormat: view.mainColorTarget.format, depthFormat }));
    pass.setBindGroup(0, view.viewBindGroup);
    pass.setBindGroup(1, bindGroup);
    pass.draw(3, 1, 0, 0);
    pass.end();
  },
});
