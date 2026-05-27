import type { ComponentType, Query as QueryHandle } from '@retro-engine/ecs';

import type { App } from '../index';
import type { PluginObject } from '../plugin';
import { RenderSet } from '../render-set';
import { ShaderRegistry } from '../shader/shader-registry';
import { Extract, Query, Res, ResMut } from '../system-param';
import { GlobalTransform } from '../transform';
import { ViewVisibility } from '../visibility/visibility';

import { AmbientLight } from './ambient-light';
import { DirectionalLight3d } from './directional-light-3d';
import {
  GpuLights,
  MAX_DIRECTIONAL_LIGHTS,
  MAX_POINT_LIGHTS,
  MAX_SPOT_LIGHTS,
  packAmbient,
  packCounts,
  packDirectionalLight,
  packPointLight,
  packSpotLight,
} from './gpu-lights';
import { LIGHT3D_WGSL } from './light-3d.wgsl';
import { PointLight3d } from './point-light-3d';
import { SpotLight3d } from './spot-light-3d';

type LightQuery<Ctor extends ComponentType> = QueryHandle<
  readonly [Ctor, typeof GlobalTransform, typeof ViewVisibility]
>;

/**
 * Engine plugin providing analytic 3D lighting for lit materials
 * (`StandardMaterial`). Registers the `retro_engine::light3d` WGSL module,
 * inserts the {@link GpuLights} uniform resource and a default
 * {@link AmbientLight}, and adds the `light3d-prepare` system that each frame
 * packs every visible `PointLight3d` / `SpotLight3d` / `DirectionalLight3d`
 * plus the ambient floor into the lights uniform.
 *
 * **Required by lit materials.** `StandardMaterial` shaders `#import
 * retro_engine::light3d` and bind the lights group at `@group(2)`; add this
 * plugin alongside `StandardMaterialPlugin`:
 *
 * ```ts
 * app.addPlugin(new StandardMaterialPlugin());
 * app.addPlugin(new MaterialPlugin(StandardMaterial));
 * app.addPlugin(new Light3dPlugin());
 * ```
 *
 * Unlit materials do not need it. The Core3d phase nodes bind the lights group
 * only when this plugin's `GpuLights` resource is present, so adding it has no
 * effect on a purely-unlit scene beyond the per-frame light pack.
 *
 * Idempotent on its resources and WGSL registration.
 */
export class Light3dPlugin implements PluginObject {
  name(): string {
    return 'Light3dPlugin';
  }

  build(app: App): void {
    const registry = app.getResource(ShaderRegistry);
    if (registry === undefined) {
      throw new Error(
        'Light3dPlugin: ShaderRegistry resource missing; ShaderPlugin must run before Light3dPlugin.',
      );
    }
    if (!registry.has('retro_engine::light3d')) {
      registry.register('retro_engine::light3d', LIGHT3D_WGSL);
    }
    if (app.getResource(GpuLights) === undefined) {
      app.insertResource(new GpuLights());
    }
    if (app.getResource(AmbientLight) === undefined) {
      app.insertResource(new AmbientLight());
    }

    app.addSystem(
      'render',
      [
        ResMut(GpuLights),
        Res(AmbientLight),
        Extract(Query([DirectionalLight3d, GlobalTransform, ViewVisibility])),
        Extract(Query([PointLight3d, GlobalTransform, ViewVisibility])),
        Extract(Query([SpotLight3d, GlobalTransform, ViewVisibility])),
      ],
      (gpuLights, ambient, directionals, points, spots) => {
        prepareLights3d(
          app,
          gpuLights as GpuLights,
          ambient as AmbientLight,
          directionals as unknown as LightQuery<typeof DirectionalLight3d>,
          points as unknown as LightQuery<typeof PointLight3d>,
          spots as unknown as LightQuery<typeof SpotLight3d>,
        );
      },
      { set: RenderSet.Prepare, label: 'light3d-prepare' },
    );
  }
}

const prepareLights3d = (
  app: App,
  gpuLights: GpuLights,
  ambient: AmbientLight,
  directionals: LightQuery<typeof DirectionalLight3d>,
  points: LightQuery<typeof PointLight3d>,
  spots: LightQuery<typeof SpotLight3d>,
): void => {
  gpuLights.ensureInitialised(app.renderer);
  const { f32, u32 } = gpuLights;

  packAmbient(ambient, f32);

  let directionalCount = 0;
  for (const row of directionals.entries()) {
    if (directionalCount >= MAX_DIRECTIONAL_LIGHTS) break;
    if (!(row[3] as ViewVisibility).visible) continue;
    packDirectionalLight(
      row[1] as DirectionalLight3d,
      (row[2] as GlobalTransform).matrix,
      f32,
      directionalCount,
    );
    directionalCount++;
  }

  let pointCount = 0;
  for (const row of points.entries()) {
    if (pointCount >= MAX_POINT_LIGHTS) break;
    if (!(row[3] as ViewVisibility).visible) continue;
    packPointLight(row[1] as PointLight3d, (row[2] as GlobalTransform).matrix, f32, pointCount);
    pointCount++;
  }

  let spotCount = 0;
  for (const row of spots.entries()) {
    if (spotCount >= MAX_SPOT_LIGHTS) break;
    if (!(row[3] as ViewVisibility).visible) continue;
    packSpotLight(row[1] as SpotLight3d, (row[2] as GlobalTransform).matrix, f32, spotCount);
    spotCount++;
  }

  packCounts(u32, directionalCount, pointCount, spotCount);
  gpuLights.upload(app.renderer);
};
