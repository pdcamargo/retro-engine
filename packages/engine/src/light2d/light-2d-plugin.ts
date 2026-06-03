import type { ComponentType, Entity, Query as QueryHandle } from '@retro-engine/ecs';
import { t } from '@retro-engine/reflect';

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
import {
  Light2dNormalPrepass2dLabel,
  Light2dNormalPrepass2dNode,
} from '../render-graph/light2d-normal-prepass-2d-node';
import {
  Light2dShadowPass2dLabel,
  Light2dShadowPass2dNode,
} from '../render-graph/light2d-shadow-pass-2d-node';
import { OpaquePass2dLabel } from '../render-graph/opaque-pass-2d-node';
import { RenderGraph } from '../render-graph/render-graph';
import { TransparentPass2dLabel } from '../render-graph/transparent-pass-2d-node';
import { RenderSet } from '../render-set';
import { ShaderRegistry } from '../shader/shader-registry';
import { Images } from '../image/images';
import { Sprite, SpritePipeline } from '../sprite';
import { Extract, Query, Res, ResMut } from '../system-param';
import { GlobalTransform } from '../transform';
import { ViewVisibility } from '../visibility/visibility';

import { AmbientLight2d } from './ambient-light-2d';
import { DirectionalLight2d } from './directional-light-2d';
import { LIGHT2D_ACCUMULATION_WGSL } from './light-2d-accumulation.wgsl';
import {
  type Light2dBatch,
  LIGHT2D_INSTANCE_FLOAT_COUNT,
  Light2dPreparedBatches,
  packAmbientLightInstance,
  packDirectionalLightInstance,
  packLightInstance,
  packSpotLightInstance,
} from './light-2d-batch';
import { LIGHT2D_COMPOSITE_WGSL } from './light-2d-composite.wgsl';
import { Light2dInstanceBuffer } from './light-2d-instance-buffer';
import { Light2dPipeline } from './light-2d-pipeline';
import { Light2dNormalState } from './light-2d-normal';
import { Light2dSettings } from './light-2d-settings';
import { LIGHT2D_SHADOW_WGSL } from './light-2d-shadow.wgsl';
import { Light2dShadowState } from './light-2d-shadow';
import { prepareLight2dTargets, ViewLight2dTargets } from './light-2d-targets';
import { LightOccluder2d } from './light-occluder-2d';
import { PointLight2d } from './point-light-2d';
import { SpotLight2d } from './spot-light-2d';

/**
 * Engine plugin owning the built-in 2D-lighting pipeline.
 *
 * On `build`:
 *
 * - Registers `retro_engine::light2d_accumulation` and
 *   `retro_engine::light2d_composite` WGSL modules with {@link ShaderRegistry}.
 * - Inserts the lighting render-world resources idempotently:
 *   {@link Light2dPipeline}, {@link Light2dInstanceBuffer},
 *   {@link Light2dPreparedBatches}, {@link ViewLight2dTargets},
 *   {@link Light2dShadowState}, {@link Light2dNormalState}, and
 *   {@link Light2dSettings} (default `(0, 0, 0, 1)` ambient, `'multiply'`
 *   composite mode, normal mapping off).
 * - Adds four nodes to the engine's Core2d sub-graph:
 *   {@link Light2dNormalPrepass2dNode} (captures normal-mapped sprites),
 *   {@link Light2dShadowPass2dNode} (builds the shadow atlas),
 *   {@link Light2dAccumulationPass2dNode}, and
 *   {@link Light2dCompositePass2dNode}. Final per-camera order:
 *   `Light2dNormalPrepass2d → Light2dShadowPass2d → Light2dAccumulationPass2d
 *   → OpaquePass2d → TransparentPass2d → Light2dCompositePass2d`.
 * - Registers render-stage systems:
 *   - `light2d-prepare-targets` in {@link RenderSet.Prepare}: ensures every
 *     active Core2d camera has `baseColor` + `lightAccum` + normal textures
 *     plus composite / normal bind groups. Resizes / GCs entries as cameras
 *     come and go.
 *   - `light2d-prepare-shadows` in {@link RenderSet.Prepare}: bootstraps the
 *     shared shadow atlas + build pipeline.
 *   - `light2d-capture-normals` in {@link RenderSet.Queue}: packs visible
 *     normal-mapped sprites for the normal prepass and pushes the
 *     `(enabled, height)` uniform.
 *   - `light2d-queue` in {@link RenderSet.Queue}: iterates every visible 2D
 *     light ({@link PointLight2d}, {@link SpotLight2d},
 *     {@link DirectionalLight2d}, {@link AmbientLight2d}), packs them into the
 *     shared instance buffer, and emits one batch per Core2d camera pointing
 *     at the packed range.
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
    if (!registry.has('retro_engine::light2d_shadow')) {
      registry.register('retro_engine::light2d_shadow', LIGHT2D_SHADOW_WGSL);
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
    if (app.getResource(Light2dShadowState) === undefined) {
      app.insertResource(new Light2dShadowState());
    }
    if (app.getResource(Light2dNormalState) === undefined) {
      app.insertResource(new Light2dNormalState());
    }
    if (app.getResource(Light2dSettings) === undefined) {
      app.insertResource(new Light2dSettings());
    }

    // AmbientLight2d is a per-entity component (regional or global pool), unlike the
    // 3D AmbientLight resource. Light2dSettings is a resource → deferred to resource reflection.
    app.registerComponent(
      PointLight2d,
      { color: t.vec3, intensity: t.number, range: t.number, radius: t.number },
      { name: 'PointLight2d' },
    );
    app.registerComponent(
      SpotLight2d,
      {
        color: t.vec3,
        intensity: t.number,
        range: t.number,
        radius: t.number,
        direction: t.vec2,
        innerAngle: t.number,
        outerAngle: t.number,
      },
      { name: 'SpotLight2d' },
    );
    app.registerComponent(
      DirectionalLight2d,
      { color: t.vec3, intensity: t.number, direction: t.vec2 },
      { name: 'DirectionalLight2d' },
    );
    app.registerComponent(
      AmbientLight2d,
      { color: t.vec3, intensity: t.number, halfExtents: t.vec2.optional() },
      { name: 'AmbientLight2d' },
    );
    app.registerComponent(
      LightOccluder2d,
      { segments: t.array(t.tuple(t.vec2, t.vec2)) },
      { name: 'LightOccluder2d', make: () => new LightOccluder2d() },
    );

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
    sub.addNode(Light2dNormalPrepass2dNode);
    sub.addNode(Light2dShadowPass2dNode);
    sub.addNode(Light2dAccumulationPass2dNode);
    sub.addNode(Light2dCompositePass2dNode);
    sub.addEdge(Light2dNormalPrepass2dLabel, Light2dShadowPass2dLabel);
    sub.addEdge(Light2dShadowPass2dLabel, Light2dAccumulationPass2dLabel);
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

    app.addSystem(
      'render',
      [ResMut(Light2dShadowState), ResMut(Light2dPipeline)],
      (shadow, pipeline) => {
        (pipeline as Light2dPipeline).ensureInitialised(app);
        (shadow as Light2dShadowState).ensure(app, pipeline as Light2dPipeline);
      },
      { set: RenderSet.Prepare, label: 'light2d-prepare-shadows' },
    );

    app.addSystem(
      'render',
      [
        Extract(Query([Sprite, GlobalTransform, ViewVisibility])),
        Res(Images),
        Res(Light2dSettings),
        ResMut(Light2dNormalState),
      ],
      (sprites, images, settings, normalState) => {
        const ns = normalState as Light2dNormalState;
        ns.ensureResources(app);
        const spritePipeline = app.getResource(SpritePipeline);
        if (spritePipeline !== undefined) ns.ensurePipeline(app, spritePipeline);
        const s = settings as Light2dSettings;
        ns.writeUniform(app, s.normalMapping, s.normalLightHeight);
        ns.capture(
          app,
          sprites as unknown as QueryHandle<
            readonly [typeof Sprite, typeof GlobalTransform, typeof ViewVisibility]
          >,
          images as Images,
        );
      },
      { set: RenderSet.Queue, label: 'light2d-capture-normals' },
    );

    app.addSystem(
      'render',
      [
        Extract(Query([PointLight2d, GlobalTransform, ViewVisibility])),
        Extract(Query([SpotLight2d, GlobalTransform, ViewVisibility])),
        Extract(Query([DirectionalLight2d, GlobalTransform, ViewVisibility])),
        Extract(Query([AmbientLight2d, GlobalTransform, ViewVisibility])),
        Extract(Query([LightOccluder2d, GlobalTransform, ViewVisibility])),
        Res(SortedCameras),
        ResMut(Light2dInstanceBuffer),
        ResMut(Light2dPreparedBatches),
        ResMut(Light2dShadowState),
      ],
      (points, spots, directionals, ambients, occluders, cameras, instanceBuffer, prepared, shadow) => {
        queueLight2dInstances(
          app,
          {
            points: points as unknown as LightQuery<typeof PointLight2d>,
            spots: spots as unknown as LightQuery<typeof SpotLight2d>,
            directionals: directionals as unknown as LightQuery<typeof DirectionalLight2d>,
            ambients: ambients as unknown as LightQuery<typeof AmbientLight2d>,
            occluders: occluders as unknown as LightQuery<typeof LightOccluder2d>,
          },
          cameras as SortedCameras,
          instanceBuffer as Light2dInstanceBuffer,
          prepared as Light2dPreparedBatches,
          shadow as Light2dShadowState,
        );
      },
      { set: RenderSet.Queue, label: 'light2d-queue' },
    );
  }
}

type LightQuery<Ctor extends ComponentType> = QueryHandle<
  readonly [Ctor, typeof GlobalTransform, typeof ViewVisibility]
>;

interface LightQueries {
  readonly points: LightQuery<typeof PointLight2d>;
  readonly spots: LightQuery<typeof SpotLight2d>;
  readonly directionals: LightQuery<typeof DirectionalLight2d>;
  readonly ambients: LightQuery<typeof AmbientLight2d>;
  readonly occluders: LightQuery<typeof LightOccluder2d>;
}

const collectVisible = <T>(
  query: QueryHandle<readonly [ComponentType, typeof GlobalTransform, typeof ViewVisibility]>,
): { light: T; gt: GlobalTransform }[] => {
  const visible: { light: T; gt: GlobalTransform }[] = [];
  for (const row of query.entries()) {
    const vis = row[3] as ViewVisibility;
    if (!vis.visible) continue;
    visible.push({ light: row[1] as T, gt: row[2] as GlobalTransform });
  }
  return visible;
};

// Positional lights cast shadows; collected with the atlas row assigned at the
// same time so the row stored in the instance matches the build input order.
const collectCasters = <T extends { range: number }>(
  query: LightQuery<ComponentType>,
  shadow: Light2dShadowState,
): { light: T; gt: GlobalTransform; row: number }[] => {
  const visible: { light: T; gt: GlobalTransform; row: number }[] = [];
  for (const row of query.entries()) {
    const vis = row[3] as ViewVisibility;
    if (!vis.visible) continue;
    const light = row[1] as T;
    const gt = row[2] as GlobalTransform;
    const atlasRow = shadow.pushCaster(gt.matrix[12] as number, gt.matrix[13] as number, light.range);
    visible.push({ light, gt, row: atlasRow });
  }
  return visible;
};

const queueLight2dInstances = (
  app: App,
  queries: LightQueries,
  cameras: SortedCameras,
  instanceBuffer: Light2dInstanceBuffer,
  prepared: Light2dPreparedBatches,
  shadow: Light2dShadowState,
): void => {
  prepared.batches.length = 0;
  instanceBuffer.count = 0;
  shadow.beginFrame();

  // Collect every visible light once. In v1 every Core2d camera sees the same
  // visible set (no per-camera render-layer filtering yet), so we pack once
  // and point every camera's batch at the same range. Kinds share one
  // instance buffer and draw in a single instanced call. Point / spot lights
  // also claim a shadow-atlas row as they are collected.
  const points = collectCasters<PointLight2d>(queries.points, shadow);
  const spots = collectCasters<SpotLight2d>(queries.spots, shadow);
  const directionals = collectVisible<DirectionalLight2d>(queries.directionals);
  const ambients = collectVisible<AmbientLight2d>(queries.ambients);

  // Occluders feed the shadow-atlas build (world-space segments).
  for (const row of queries.occluders.entries()) {
    const vis = row[3] as ViewVisibility;
    if (!vis.visible) continue;
    shadow.pushOccluder(row[1] as LightOccluder2d, row[2] as GlobalTransform);
  }
  shadow.upload(app);

  const total = points.length + spots.length + directionals.length + ambients.length;

  // Even with no visible lights, emit one batch per Core2d camera with
  // `count = 0` so the accumulation node still performs its clear (the
  // composite pass needs the lightAccum texture to be in a known state —
  // the ambient floor — even when no light contributes).
  let count = 0;
  if (total > 0) {
    instanceBuffer.ensureCapacity(app.renderer, total);
    const scratch = instanceBuffer.scratchF32;
    let cursor = 0;
    for (const { light, gt, row } of points) {
      cursor += packLightInstance(light, gt.matrix, row, scratch, cursor);
    }
    for (const { light, gt, row } of spots) {
      cursor += packSpotLightInstance(light, gt.matrix, row, scratch, cursor);
    }
    for (const { light } of directionals) {
      cursor += packDirectionalLightInstance(light, scratch, cursor);
    }
    for (const { light, gt } of ambients) {
      const he = light.halfExtents;
      const halfW = he !== undefined ? (he[0] as number) : 0;
      const halfH = he !== undefined ? (he[1] as number) : 0;
      cursor += packAmbientLightInstance(light, gt.matrix, halfW, halfH, scratch, cursor);
    }
    count = total;
    instanceBuffer.count = count;
    if (instanceBuffer.buffer !== undefined && cursor > 0) {
      const view = scratch.subarray(0, cursor);
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
