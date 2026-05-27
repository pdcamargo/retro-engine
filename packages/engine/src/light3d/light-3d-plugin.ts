import type { ComponentType, Query as QueryHandle } from '@retro-engine/ecs';
import type { Mat4 } from '@retro-engine/math';
import { mat4 } from '@retro-engine/math';

import type { App } from '../index';
import { MeshAllocator, Mesh3d, RenderMeshes } from '../mesh';
import type { PluginObject } from '../plugin';
import { Core3dLabel } from '../render-graph/core-3d';
import { OpaquePass3dLabel } from '../render-graph/opaque-pass-3d-node';
import { RenderGraph } from '../render-graph/render-graph';
import { Shadow3dPass3dLabel, Shadow3dPass3dNode } from '../render-graph/shadow-pass-3d-node';
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
  packDirectionalCasterIndex,
  packDirectionalLight,
  packPointLight,
  packShadowViewProj,
  packSpotCasterIndex,
  packSpotLight,
} from './gpu-lights';
import { LIGHT3D_WGSL } from './light-3d.wgsl';
import { NotShadowCaster } from './not-shadow-caster';
import { PointLight3d } from './point-light-3d';
import { Shadow3dState } from './shadow-3d';
import {
  assignCasterLayer,
  directionalLightViewProj,
  spotLightViewProj,
} from './shadow-3d-matrices';
import { Shadow3dSettings } from './shadow-3d-settings';
import { queueShadow3dCasters, type ShadowCasterQuery } from './shadow-3d-queue';
import { SHADOW3D_WGSL } from './shadow-3d.wgsl';
import { SpotLight3d } from './spot-light-3d';

type LightQuery<Ctor extends ComponentType> = QueryHandle<
  readonly [Ctor, typeof GlobalTransform, typeof ViewVisibility]
>;

// Render-thread scratch for one light-space view-proj at a time.
const scratchViewProj = mat4.identity() as Mat4;

/**
 * Engine plugin providing analytic 3D lighting **and shadow maps** for lit
 * materials (`StandardMaterial`). Registers the `retro_engine::light3d` and
 * `retro_engine::shadow3d` WGSL modules, inserts the {@link GpuLights} uniform
 * resource, a default {@link AmbientLight}, the {@link Shadow3dState} atlas, and
 * {@link Shadow3dSettings}, and wires the systems + render-graph node that pack
 * lights, build the shadow atlas, and shade with shadows.
 *
 * Each frame:
 *
 * - `light3d-prepare` ({@link RenderSet.Prepare}) packs every visible light into
 *   the lights uniform, assigns shadow-atlas layers to directional / spot
 *   lights (up to the budget), and computes their light-space view-projections.
 * - `shadow3d-prepare` ({@link RenderSet.Prepare}, after `light3d-prepare`)
 *   bootstraps the shadow atlas GPU resources and uploads the per-light
 *   matrices.
 * - `shadow3d-queue` ({@link RenderSet.Queue}) collects shadow-caster meshes
 *   (every visible `Mesh3d` without {@link NotShadowCaster}).
 * - {@link Shadow3dPass3dNode} (prepended before the opaque pass) renders caster
 *   depth into each light's atlas layer; `pbr.wgsl` samples it.
 *
 * **Required by lit materials.** `StandardMaterial` shaders `#import
 * retro_engine::light3d` + `retro_engine::shadow3d` and bind the lights group at
 * `@group(2)`; add this plugin alongside `StandardMaterialPlugin`:
 *
 * ```ts
 * app.addPlugin(new StandardMaterialPlugin());
 * app.addPlugin(new MaterialPlugin(StandardMaterial));
 * app.addPlugin(new Light3dPlugin());
 * ```
 *
 * Requires `RenderGraphPlugin` (for the Core3d sub-graph the shadow node joins).
 * Unlit materials do not need it.
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
    if (!registry.has('retro_engine::shadow3d')) {
      registry.register('retro_engine::shadow3d', SHADOW3D_WGSL);
    }
    if (app.getResource(GpuLights) === undefined) {
      app.insertResource(new GpuLights());
    }
    if (app.getResource(AmbientLight) === undefined) {
      app.insertResource(new AmbientLight());
    }
    if (app.getResource(Shadow3dState) === undefined) {
      app.insertResource(new Shadow3dState());
    }
    if (app.getResource(Shadow3dSettings) === undefined) {
      app.insertResource(new Shadow3dSettings());
    }

    const graph = app.getResource(RenderGraph);
    if (graph === undefined) {
      throw new Error(
        'Light3dPlugin: RenderGraph resource missing; RenderGraphPlugin must run before Light3dPlugin.',
      );
    }
    const sub = graph.getSubGraph(Core3dLabel);
    if (sub === undefined) {
      throw new Error(
        'Light3dPlugin: Core3d sub-graph missing; RenderGraphPlugin must build the sub-graph before Light3dPlugin.',
      );
    }
    sub.addNode(Shadow3dPass3dNode);
    sub.addEdge(Shadow3dPass3dLabel, OpaquePass3dLabel);

    app.addSystem(
      'render',
      [
        ResMut(GpuLights),
        Res(AmbientLight),
        ResMut(Shadow3dState),
        Res(Shadow3dSettings),
        Extract(Query([DirectionalLight3d, GlobalTransform, ViewVisibility])),
        Extract(Query([PointLight3d, GlobalTransform, ViewVisibility])),
        Extract(Query([SpotLight3d, GlobalTransform, ViewVisibility])),
      ],
      (gpuLights, ambient, shadow, settings, directionals, points, spots) => {
        prepareLights3d(
          app,
          gpuLights as GpuLights,
          ambient as AmbientLight,
          shadow as Shadow3dState,
          settings as Shadow3dSettings,
          directionals as unknown as LightQuery<typeof DirectionalLight3d>,
          points as unknown as LightQuery<typeof PointLight3d>,
          spots as unknown as LightQuery<typeof SpotLight3d>,
        );
      },
      { set: RenderSet.Prepare, label: 'light3d-prepare' },
    );

    app.addSystem(
      'render',
      [ResMut(Shadow3dState), ResMut(GpuLights)],
      (shadow, gpuLights) => {
        const s = shadow as Shadow3dState;
        if (s.ensure(app, gpuLights as GpuLights)) {
          s.flushViewProj(app);
        }
      },
      { set: RenderSet.Prepare, label: 'shadow3d-prepare', after: ['light3d-prepare'] },
    );

    app.addSystem(
      'render',
      [
        Extract(Query([Mesh3d, GlobalTransform, ViewVisibility], { without: [NotShadowCaster] })),
        Res(RenderMeshes),
        Res(MeshAllocator),
        ResMut(Shadow3dState),
        Res(Shadow3dSettings),
      ],
      (casters, renderMeshes, allocator, shadow, settings) => {
        queueShadow3dCasters(
          app,
          casters as unknown as ShadowCasterQuery,
          renderMeshes as RenderMeshes,
          allocator as MeshAllocator,
          shadow as Shadow3dState,
          settings as Shadow3dSettings,
        );
      },
      { set: RenderSet.Queue, label: 'shadow3d-queue' },
    );
  }
}

const prepareLights3d = (
  app: App,
  gpuLights: GpuLights,
  ambient: AmbientLight,
  shadow: Shadow3dState,
  settings: Shadow3dSettings,
  directionals: LightQuery<typeof DirectionalLight3d>,
  points: LightQuery<typeof PointLight3d>,
  spots: LightQuery<typeof SpotLight3d>,
): void => {
  gpuLights.ensureInitialised(app.renderer);
  shadow.beginFrame();
  const { f32, u32 } = gpuLights;

  packAmbient(ambient, f32);

  let directionalCount = 0;
  for (const row of directionals.entries()) {
    if (directionalCount >= MAX_DIRECTIONAL_LIGHTS) break;
    if (!(row[3] as ViewVisibility).visible) continue;
    const light = row[1] as DirectionalLight3d;
    const gt = row[2] as GlobalTransform;
    packDirectionalLight(light, gt.matrix, f32, directionalCount);
    const layer = assignCasterLayer(shadow.shadowLightCount);
    if (layer >= 0) {
      directionalLightViewProj(gt.matrix, settings, scratchViewProj);
      packShadowViewProj(f32, layer, scratchViewProj);
      packDirectionalCasterIndex(f32, directionalCount, layer);
      shadow.stageViewProj(layer, scratchViewProj as Float32Array);
      shadow.shadowLightCount += 1;
    }
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
    const light = row[1] as SpotLight3d;
    const gt = row[2] as GlobalTransform;
    packSpotLight(light, gt.matrix, f32, spotCount);
    const layer = assignCasterLayer(shadow.shadowLightCount);
    if (layer >= 0) {
      spotLightViewProj(gt.matrix, light.outerAngle, light.range, settings, scratchViewProj);
      packShadowViewProj(f32, layer, scratchViewProj);
      packSpotCasterIndex(f32, spotCount, layer);
      shadow.stageViewProj(layer, scratchViewProj as Float32Array);
      shadow.shadowLightCount += 1;
    }
    spotCount++;
  }

  packCounts(u32, directionalCount, pointCount, spotCount);
  gpuLights.upload(app.renderer);
};
