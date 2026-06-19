import type { ComponentType, Query as QueryHandle } from '@retro-engine/ecs';
import type { Mat4 } from '@retro-engine/math';
import { mat4, vec3 } from '@retro-engine/math';
import { t } from '@retro-engine/reflect';

import { Camera } from '../camera/camera';
import { PerspectiveProjection } from '../camera/projection';
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
import { MAX_CASCADES, CascadeShadowConfig } from './cascade-shadow-config';
import { cascadeLightViewProj, computeCascadeSplits, reserveCasterLayers } from './cascade-shadow';
import { DirectionalLight3d } from './directional-light-3d';
import {
  forwardFromMatrix,
  GpuLights,
  MAX_DIRECTIONAL_LIGHTS,
  MAX_POINT_LIGHTS,
  MAX_SPOT_LIGHTS,
  packAmbient,
  packCascadeSplits,
  packCounts,
  packDirectionalCascadeBase,
  packDirectionalCasterIndex,
  packDirectionalLight,
  packPointLight,
  packShadowFlags,
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
type DirectionalLightQuery = QueryHandle<
  readonly [
    typeof DirectionalLight3d,
    typeof GlobalTransform,
    typeof ViewVisibility,
    typeof CascadeShadowConfig,
  ]
>;
type CameraQuery = QueryHandle<readonly [typeof Camera, typeof PerspectiveProjection]>;

// Render-thread scratch reused across the per-frame pack.
const scratchViewProj = mat4.identity() as Mat4;
const scratchInvView = mat4.identity() as Mat4;
const scratchLightForward = vec3.create();
const scratchSplits = new Float32Array(MAX_CASCADES);

/** Active perspective camera driving the Core3d sub-graph, lowest `order` first. */
const activeCore3dCamera = (
  cameras: CameraQuery,
): { cam: Camera; proj: PerspectiveProjection } | undefined => {
  let best: { cam: Camera; proj: PerspectiveProjection } | undefined;
  for (const row of cameras.entries()) {
    const cam = row[1] as Camera;
    if (!cam.isActive || cam.subGraph !== Core3dLabel) continue;
    if (best === undefined || cam.order < best.cam.order) {
      best = { cam, proj: row[2] as PerspectiveProjection };
    }
  }
  return best;
};

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
 *   the lights uniform and assigns shadow-atlas layers (up to the budget): spot
 *   lights get one layer, directional lights get one camera-fitted cascade per
 *   layer, and their light-space view-projections are computed here.
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

  category(): 'engine' {
    return 'engine';
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

    // Authored world/render settings: resources, not components, so they register
    // through registerResource and ride a saved scene's `resources`.
    app.registerResource(
      AmbientLight,
      { color: t.vec3, brightness: t.number },
      { name: 'AmbientLight' },
    );
    app.registerResource(
      Shadow3dSettings,
      {
        directionalExtent: t.number,
        near: t.number,
        far: t.number,
        depthBias: t.number,
        slopeScaleBias: t.number,
        cullMode: t.enum('back', 'front', 'none'),
        cascadeBackExtension: t.number,
        filteringMethod: t.enum('Hardware2x2', 'Castano13', 'Pcf5x5'),
      },
      { name: 'Shadow3dSettings' },
    );

    // The per-entity light state registers as components.
    app.registerComponent(
      DirectionalLight3d,
      { color: t.vec3, intensity: t.number },
      { name: 'DirectionalLight3d' },
    );
    app.registerComponent(
      PointLight3d,
      { color: t.vec3, intensity: t.number, range: t.number, radius: t.number },
      { name: 'PointLight3d' },
    );
    app.registerComponent(
      SpotLight3d,
      {
        color: t.vec3,
        intensity: t.number,
        range: t.number,
        radius: t.number,
        innerAngle: t.number,
        outerAngle: t.number,
      },
      { name: 'SpotLight3d' },
    );
    app.registerComponent(
      CascadeShadowConfig,
      {
        numCascades: t.number,
        minimumDistance: t.number,
        maximumDistance: t.number,
        firstCascadeFarBound: t.number.optional(),
        overlapProportion: t.number,
        lambda: t.number,
      },
      { name: 'CascadeShadowConfig' },
    );
    app.registerComponent(NotShadowCaster, {}, { name: 'NotShadowCaster' });

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
        Extract(Query([Camera, PerspectiveProjection])),
        Extract(Query([DirectionalLight3d, GlobalTransform, ViewVisibility, CascadeShadowConfig])),
        Extract(Query([PointLight3d, GlobalTransform, ViewVisibility])),
        Extract(Query([SpotLight3d, GlobalTransform, ViewVisibility])),
      ],
      (gpuLights, ambient, shadow, settings, cameras, directionals, points, spots) => {
        prepareLights3d(
          app,
          gpuLights as GpuLights,
          ambient as AmbientLight,
          shadow as Shadow3dState,
          settings as Shadow3dSettings,
          cameras as unknown as CameraQuery,
          directionals as unknown as DirectionalLightQuery,
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
  cameras: CameraQuery,
  directionals: DirectionalLightQuery,
  points: LightQuery<typeof PointLight3d>,
  spots: LightQuery<typeof SpotLight3d>,
): void => {
  gpuLights.ensureInitialised(app.renderer);
  shadow.beginFrame();
  const { f32, u32 } = gpuLights;

  packAmbient(ambient, f32);

  // Cascades fit the active perspective camera's frustum; without one, fall back
  // to a fixed origin-centered box per directional light.
  const camera = activeCore3dCamera(cameras);
  let tanHalfFovY = 0;
  let aspect = 1;
  if (camera !== undefined) {
    mat4.inverse(camera.cam.computed.viewMatrix, scratchInvView);
    tanHalfFovY = Math.tan(camera.proj.fov * 0.5);
    aspect = camera.proj.aspectRatio;
  }
  // Split distances are a function of the camera (shared across directionals);
  // computed once from the first cascaded light's config.
  let cascadeCount = 0;
  let splitsReady = false;

  let directionalCount = 0;
  for (const row of directionals.entries()) {
    if (directionalCount >= MAX_DIRECTIONAL_LIGHTS) break;
    if (!(row[3] as ViewVisibility).visible) continue;
    const light = row[1] as DirectionalLight3d;
    const gt = row[2] as GlobalTransform;
    packDirectionalLight(light, gt.matrix, f32, directionalCount);

    if (camera !== undefined) {
      const config = row[4] as CascadeShadowConfig;
      if (!splitsReady) {
        cascadeCount = computeCascadeSplits(
          config.numCascades,
          config.minimumDistance,
          config.maximumDistance,
          config.lambda,
          scratchSplits,
          config.firstCascadeFarBound,
        );
        splitsReady = true;
      }
      const base = reserveCasterLayers(shadow.shadowLightCount, cascadeCount);
      if (base >= 0) {
        forwardFromMatrix(gt.matrix, scratchLightForward, 0);
        let nearC = config.minimumDistance;
        for (let c = 0; c < cascadeCount; c++) {
          const farC = scratchSplits[c] as number;
          cascadeLightViewProj(
            {
              invView: scratchInvView,
              tanHalfFovY,
              aspect,
              nearC,
              farC,
              lightForward: scratchLightForward,
              backExtension: settings.cascadeBackExtension,
            },
            scratchViewProj,
          );
          packShadowViewProj(f32, base + c, scratchViewProj);
          shadow.stageViewProj(base + c, scratchViewProj as Float32Array);
          nearC = farC;
        }
        packDirectionalCascadeBase(f32, directionalCount, base);
        shadow.shadowLightCount += cascadeCount;
      }
    } else {
      const layer = assignCasterLayer(shadow.shadowLightCount);
      if (layer >= 0) {
        directionalLightViewProj(gt.matrix, settings, scratchViewProj);
        packShadowViewProj(f32, layer, scratchViewProj);
        packDirectionalCasterIndex(f32, directionalCount, layer);
        shadow.stageViewProj(layer, scratchViewProj as Float32Array);
        shadow.shadowLightCount += 1;
      }
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

  packCounts(u32, directionalCount, pointCount, spotCount, cascadeCount);
  packCascadeSplits(f32, scratchSplits);
  packShadowFlags(u32, settings.filteringMethod);
  gpuLights.upload(app.renderer);
};
