import type { Entity } from '@retro-engine/ecs';
import type { Mat4 } from '@retro-engine/math';
import { t } from '@retro-engine/reflect';

import type { App } from '../index';
import type { PluginObject } from '../plugin';
import { RenderSet } from '../render-set';
import { Query } from '../system-param';
import { GlobalTransform } from '../transform';
import { computeSkinningPalette, SkinnedPalettes } from './palette';
import { Skeleton, SkinnedMeshPalette } from './skeleton';
import { SkinnedPaletteGpu } from './skinned-palette-gpu';

/**
 * Engine plugin for GPU skinning. Registers the {@link Skeleton} component,
 * recomputes each skinned entity's joint palette from the current pose every
 * frame (after transform propagation), and uploads the concatenated palette to
 * the shared storage buffer the skinned render path reads.
 *
 * The render path itself — the skinned pipeline variant and per-instance
 * `joint_offset` — lives in the material plugin, which reads the
 * {@link SkinnedPaletteGpu} this plugin owns. The GPU upload is gated on
 * `RendererCapabilities.storageBuffers`; on a backend without it (WebGL2)
 * skinning awaits the bone-texture delivery path and the buffer stays empty.
 */
export class SkinningPlugin implements PluginObject {
  name(): string {
    return 'SkinningPlugin';
  }

  build(app: App): void {
    if (app.getResource(SkinnedPalettes) === undefined) {
      app.insertResource(new SkinnedPalettes());
    }
    if (app.getResource(SkinnedPaletteGpu) === undefined) {
      app.insertResource(new SkinnedPaletteGpu());
    }

    app.registerComponent(
      Skeleton,
      { joints: t.array(t.entity()), inverseBindMatrices: t.array(t.mat4) },
      { name: 'Skeleton', make: () => new Skeleton() },
    );

    // Joint globals are read by entity each frame; a reused scratch keeps the
    // per-frame palette recompute allocation-free.
    const jointScratch: (Mat4 | undefined)[] = [];

    app.addSystem(
      'postUpdate',
      [Query([Skeleton, GlobalTransform])],
      (skinned) => {
        const palettes = app.getResource(SkinnedPalettes)!;
        const live = new Set<Entity>();
        for (const [entity, skeleton, globalTransform] of skinned.entries()) {
          live.add(entity);
          const jointCount = skeleton.joints.length;
          let palette = palettes.byEntity.get(entity);
          if (palette === undefined || palette.jointCount !== jointCount) {
            palette = new SkinnedMeshPalette(jointCount);
            palettes.byEntity.set(entity, palette);
          }
          jointScratch.length = jointCount;
          for (let i = 0; i < jointCount; i++) {
            jointScratch[i] = app.world.getComponent(skeleton.joints[i]!, GlobalTransform)?.matrix;
          }
          computeSkinningPalette(
            globalTransform.matrix,
            jointScratch,
            skeleton.inverseBindMatrices,
            palette,
          );
        }
        for (const entity of palettes.byEntity.keys()) {
          if (!live.has(entity)) palettes.byEntity.delete(entity);
        }
      },
      { name: 'skinning-compute-palettes', after: ['transform-propagation'] },
    );

    app.addSystem(
      'render',
      [],
      () => {
        if (!app.renderer.capabilities.storageBuffers) return;
        const palettes = app.getResource(SkinnedPalettes)!;
        const gpu = app.getResource(SkinnedPaletteGpu)!;
        gpu.writePalettes(app.renderer, palettes);
      },
      { set: RenderSet.Prepare, name: 'skinning-upload-palette' },
    );
  }
}
