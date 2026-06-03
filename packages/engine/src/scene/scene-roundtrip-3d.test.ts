import { describe, expect, it } from 'bun:test';

import { World, type ComponentType, type Entity } from '@retro-engine/ecs';
import { asAssetIndex, generateAssetGuid, makeHandle } from '@retro-engine/assets';
import { vec3 } from '@retro-engine/math';

import {
  App,
  Camera,
  Camera3d,
  CascadeShadowConfig,
  Children,
  ClearColorConfig,
  Commands,
  Core3dLabel,
  DepthPrepass,
  DirectionalLight3d,
  GlobalTransform,
  Light3dPlugin,
  MaterialPlugin,
  Mesh,
  Mesh3d,
  Name,
  NormalPrepass,
  Parent,
  PerspectiveProjection,
  PointLight3d,
  PrepassPlugin,
  RenderLayers,
  SpotLight3d,
  StandardMaterial,
  StandardMaterialPlugin,
  Tonemapping,
  Transform,
  Visibility,
} from '../index';
import { serializeScene } from './serialize';
import { spawnScene } from './spawn';
import type { SceneData } from './scene-data';
import { makeCapturingRenderer, makeStubCanvas } from '../test-utils';

/** App wired with the StandardMaterial + lighting + prepass plugins a 3D scene needs. */
const buildApp = (): { app: App; pbr: MaterialPlugin<StandardMaterial> } => {
  const { renderer } = makeCapturingRenderer();
  const app = new App({ renderer, canvas: makeStubCanvas() });
  app.addPlugin(new StandardMaterialPlugin());
  const pbr = new MaterialPlugin(StandardMaterial);
  app.addPlugin(pbr);
  app.addPlugin(new Light3dPlugin());
  app.addPlugin(new PrepassPlugin());
  return { app, pbr };
};

const find = <T extends object>(world: World, type: ComponentType<T>): Entity => {
  for (const entity of world.entities()) {
    if (world.getComponent(entity, type) !== undefined) return entity;
  }
  throw new Error('no entity with the requested component');
};

describe('scene round-trip — 3D camera, lights, lit mesh', () => {
  it('restores camera + projection + prepass markers, every light, and a lit mesh under a Parent', () => {
    const meshGuid = generateAssetGuid();
    const matGuid = generateAssetGuid();
    const meshHandle = makeHandle<Mesh>(asAssetIndex(7), meshGuid);
    const matHandle = makeHandle<StandardMaterial>(asAssetIndex(9), matGuid);

    const { app, pbr } = buildApp();
    app.addSystem('startup', [Commands], (cmd) => {
      // Camera: non-default perspective, HDR (→ auto Tonemapping), custom clear
      // color, render layers, and depth + normal prepass markers.
      cmd.spawn(
        ...Camera3d({
          order: 2,
          hdr: true,
          clearColor: ClearColorConfig.custom({ r: 0.1, g: 0.2, b: 0.3, a: 1 }),
          projection: { fov: 1.25, near: 0.5, far: 250 },
          transform: new Transform(vec3.create(0, 3, 12)),
        }),
        new RenderLayers(0b101),
        new DepthPrepass(),
        new NormalPrepass(),
      );
      // One of each light kind. DirectionalLight3d auto-requires CascadeShadowConfig.
      cmd.spawn(
        new DirectionalLight3d({ color: vec3.create(1, 0.5, 0.25), intensity: 3 }),
        new Transform(),
      );
      cmd.spawn(
        new PointLight3d({ color: vec3.create(0.25, 0.5, 1), intensity: 8, range: 30, radius: 2 }),
        new Transform(vec3.create(4, 2, 0)),
      );
      cmd.spawn(
        new SpotLight3d({ intensity: 12, range: 40, innerAngle: 0.5, outerAngle: 0.75 }),
        new Transform(vec3.create(-4, 6, 0)),
      );
      // A lit mesh child under a parent, parented through withChildren so the
      // Parent edge + derived companions exist on the source.
      const parent = cmd.spawn(new Transform(vec3.create(10, 0, 0)), new Name('rig'));
      parent.withChildren((p) => {
        p.spawn(
          new Transform(vec3.create(0, 5, 0)),
          new Mesh3d(meshHandle),
          new pbr.MeshMaterial3d(matHandle),
          new Visibility('Visible'),
        );
      });
    });
    app.advanceFrame(0);

    const scene: SceneData = JSON.parse(JSON.stringify(serializeScene(app)));

    const { app: app2, pbr: pbr2 } = buildApp();
    const restoredMesh = makeHandle<Mesh>(asAssetIndex(50), meshGuid);
    const restoredMat = makeHandle<StandardMaterial>(asAssetIndex(51), matGuid);
    spawnScene(app2, scene, undefined, {
      resolveHandle: (_assetType, g) =>
        g === meshGuid ? restoredMesh : g === matGuid ? restoredMat : makeHandle(asAssetIndex(0)),
    });
    app2.advanceFrame(0);
    const w = app2.world;

    // Camera + projection: variant (clearColor/target/depthTarget), branded-string
    // subGraph, scalars, and the auto Tonemapping all survive.
    const camEntity = find(w, Camera);
    const cam = w.getComponent(camEntity, Camera)!;
    expect(cam.order).toBe(2);
    expect(cam.hdr).toBe(true);
    expect(cam.subGraph).toBe(Core3dLabel);
    expect(cam.clearColor).toEqual({ kind: 'custom', color: { r: 0.1, g: 0.2, b: 0.3, a: 1 } });
    expect(cam.target).toEqual({ kind: 'primary' });
    expect(cam.depthTarget).toEqual({ kind: 'auto' });
    const proj = w.getComponent(camEntity, PerspectiveProjection)!;
    expect(proj.fov).toBe(1.25);
    expect(proj.near).toBe(0.5);
    expect(proj.far).toBe(250);
    expect(w.getComponent(camEntity, RenderLayers)!.mask).toBe(0b101);
    expect(w.getComponent(camEntity, DepthPrepass)).toBeDefined();
    expect(w.getComponent(camEntity, NormalPrepass)).toBeDefined();
    expect(w.getComponent(camEntity, Tonemapping)!.method).toBe('agx');

    // Lights.
    const dir = w.getComponent(find(w, DirectionalLight3d), DirectionalLight3d)!;
    expect(Array.from(dir.color)).toEqual([1, 0.5, 0.25]);
    expect(dir.intensity).toBe(3);
    // CascadeShadowConfig was auto-required and round-trips its defaults.
    const cascade = w.getComponent(find(w, DirectionalLight3d), CascadeShadowConfig)!;
    expect(cascade.numCascades).toBe(4);
    expect(cascade.lambda).toBe(0.8);
    expect(cascade.firstCascadeFarBound).toBeUndefined();

    const point = w.getComponent(find(w, PointLight3d), PointLight3d)!;
    expect(Array.from(point.color)).toEqual([0.25, 0.5, 1]);
    expect(point.intensity).toBe(8);
    expect(point.range).toBe(30);
    expect(point.radius).toBe(2);

    const spot = w.getComponent(find(w, SpotLight3d), SpotLight3d)!;
    expect(spot.intensity).toBe(12);
    expect(spot.range).toBe(40);
    expect(spot.innerAngle).toBe(0.5);
    expect(spot.outerAngle).toBe(0.75);

    // Hierarchy + derived recompute.
    const parent = find(w, Name);
    const child = find(w, Mesh3d);
    expect(w.getComponent(child, Parent)!.entity).toBe(parent);
    expect(w.getComponent(parent, Children)!.entities).toContain(child);
    const childGlobal = w.getComponent(child, GlobalTransform)!;
    expect(childGlobal.matrix[12]).toBeCloseTo(10, 5);
    expect(childGlobal.matrix[13]).toBeCloseTo(5, 5);
    expect(childGlobal.matrix[14]).toBeCloseTo(0, 5);
    expect(w.getComponent(child, Visibility)!.mode).toBe('Visible');

    // Handles persisted by GUID, resolved onto the App's per-type subclass.
    expect(w.getComponent(child, Mesh3d)!.handle.guid).toBe(meshGuid);
    expect(w.getComponent(child, pbr2.MeshMaterial3d)!.handle.guid).toBe(matGuid);
  });
});
