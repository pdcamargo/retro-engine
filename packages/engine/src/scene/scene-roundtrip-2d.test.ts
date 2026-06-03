import { describe, expect, it } from 'bun:test';

import { World, type ComponentType, type Entity } from '@retro-engine/ecs';
import { asAssetIndex, generateAssetGuid, makeHandle } from '@retro-engine/assets';
import { vec2, vec3, vec4 } from '@retro-engine/math';

import {
  AmbientLight2d,
  App,
  AtlasAnimation,
  BorderRect,
  Camera,
  Camera2d,
  Children,
  ClearColorConfig,
  ColorMaterial2d,
  ColorMaterial2dPlugin,
  Commands,
  Core2dLabel,
  GlobalTransform,
  Light2dPlugin,
  Material2dPlugin,
  Mesh,
  Mesh2d,
  Name,
  OrthographicProjection,
  Parent,
  PointLight2d,
  RenderLayers,
  ScalingMode,
  Sprite,
  SpritePlugin,
  TextureAtlas,
  type TextureAtlasLayout,
  TextureSlicer,
  Transform,
} from '../index';
import type { Image } from '../image/image';
import { serializeScene } from './serialize';
import { spawnScene } from './spawn';
import type { SceneData } from './scene-data';
import { makeCapturingRenderer, makeStubCanvas } from '../test-utils';

/** App wired with the sprite, 2D-lighting, and ColorMaterial2d plugins a 2D scene needs. */
const buildApp = (): { app: App; mat: Material2dPlugin<ColorMaterial2d> } => {
  const { renderer } = makeCapturingRenderer();
  const app = new App({ renderer, canvas: makeStubCanvas() });
  app.addPlugin(new SpritePlugin());
  app.addPlugin(new Light2dPlugin());
  app.addPlugin(new ColorMaterial2dPlugin());
  const mat = new Material2dPlugin(ColorMaterial2d);
  app.addPlugin(mat);
  return { app, mat };
};

const find = <T extends object>(world: World, type: ComponentType<T>): Entity => {
  for (const entity of world.entities()) {
    if (world.getComponent(entity, type) !== undefined) return entity;
  }
  throw new Error('no entity with the requested component');
};

describe('scene round-trip — 2D camera, sprite, lights, mesh', () => {
  it('restores ortho scaling mode, a 9-sliced atlassed sprite, 2D lights, and a 2D mesh', () => {
    const texGuid = generateAssetGuid();
    const atlasGuid = generateAssetGuid();
    const meshGuid = generateAssetGuid();
    const matGuid = generateAssetGuid();
    const texHandle = makeHandle<Image>(asAssetIndex(3), texGuid);
    const atlasHandle = makeHandle<TextureAtlasLayout>(asAssetIndex(4), atlasGuid);
    const meshHandle = makeHandle<Mesh>(asAssetIndex(5), meshGuid);
    const matHandle = makeHandle<ColorMaterial2d>(asAssetIndex(6), matGuid);

    const { app, mat } = buildApp();
    app.addSystem('startup', [Commands], (cmd) => {
      // Camera: ortho with a non-default Fixed scaling mode (variant) + scale,
      // custom clear color, render layers.
      cmd.spawn(
        ...Camera2d({
          order: 1,
          clearColor: ClearColorConfig.custom({ r: 0.05, g: 0.05, b: 0.1, a: 1 }),
          projection: { scalingMode: ScalingMode.fixed(320, 180), scale: 2 },
        }),
        new RenderLayers(0b11),
      );
      cmd.spawn(
        new PointLight2d({ color: vec3.create(1, 0.5, 0.25), intensity: 2, range: 200, radius: 24 }),
        new Transform(),
      );
      cmd.spawn(
        new AmbientLight2d({
          color: vec3.create(0.5, 0.5, 1),
          intensity: 1,
          halfExtents: vec2.create(200, 150),
        }),
        new Transform(),
      );
      cmd.spawn(new Mesh2d(meshHandle), new mat.MeshMaterial2d(matHandle), new Transform());
      // Sprite child: texture handle, 9-slice imageMode (variant + nested types),
      // custom anchor (string-or-struct variant), atlas + animation, under a Parent.
      const parent = cmd.spawn(new Name('hud'), new Transform(vec3.create(100, 0, 0)));
      parent.withChildren((p) => {
        p.spawn(
          new Sprite({
            image: texHandle,
            color: vec4.create(1, 0.5, 0.25, 1),
            customSize: vec2.create(64, 32),
            anchor: { x: 0.25, y: 0.75 },
            flipX: true,
            imageMode: { kind: 'sliced', slicer: new TextureSlicer({ border: BorderRect.all(8) }) },
          }),
          new TextureAtlas(atlasHandle, 3),
          // Paused so the animator leaves `index` at the authored 3 — the authored
          // animation fields still round-trip.
          new AtlasAnimation({ firstIndex: 0, lastIndex: 7, fps: 12, mode: 'pingPong', paused: true }),
          new Transform(vec3.create(0, 20, 0)),
        );
      });
    });
    app.advanceFrame(0);

    const scene: SceneData = JSON.parse(JSON.stringify(serializeScene(app)));

    const { app: app2, mat: mat2 } = buildApp();
    spawnScene(app2, scene, undefined, {
      resolveHandle: (_assetType, g) =>
        g === texGuid
          ? makeHandle<Image>(asAssetIndex(60), texGuid)
          : g === atlasGuid
            ? makeHandle<TextureAtlasLayout>(asAssetIndex(61), atlasGuid)
            : g === meshGuid
              ? makeHandle<Mesh>(asAssetIndex(62), meshGuid)
              : g === matGuid
                ? makeHandle<ColorMaterial2d>(asAssetIndex(63), matGuid)
                : makeHandle(asAssetIndex(0)),
    });
    app2.advanceFrame(0);
    const w = app2.world;

    // Camera + ortho projection: the Fixed scaling-mode variant + scale survive.
    const camEntity = find(w, Camera);
    const cam = w.getComponent(camEntity, Camera)!;
    expect(cam.order).toBe(1);
    expect(cam.subGraph).toBe(Core2dLabel);
    expect(cam.clearColor).toEqual({ kind: 'custom', color: { r: 0.05, g: 0.05, b: 0.1, a: 1 } });
    const ortho = w.getComponent(camEntity, OrthographicProjection)!;
    expect(ortho.scalingMode).toEqual({ kind: 'fixed', width: 320, height: 180 });
    expect(ortho.scale).toBe(2);
    expect(ortho.near).toBe(-1000);
    expect(ortho.far).toBe(1000);
    expect(w.getComponent(camEntity, RenderLayers)!.mask).toBe(0b11);

    // Sprite: handle, tint, footprint, custom anchor, flip, and the 9-slice
    // imageMode with its nested TextureSlicer + BorderRect.
    const spriteEntity = find(w, Sprite);
    const sprite = w.getComponent(spriteEntity, Sprite)!;
    expect(sprite.image!.guid).toBe(texGuid);
    expect(Array.from(sprite.color)).toEqual([1, 0.5, 0.25, 1]);
    expect(Array.from(sprite.customSize!)).toEqual([64, 32]);
    expect(sprite.anchor).toEqual({ x: 0.25, y: 0.75 });
    expect(sprite.flipX).toBe(true);
    expect(sprite.flipY).toBe(false);
    expect(sprite.imageMode!.kind).toBe('sliced');
    const slicer = (sprite.imageMode as { kind: 'sliced'; slicer: TextureSlicer }).slicer;
    expect(slicer).toBeInstanceOf(TextureSlicer);
    expect(slicer.border).toBeInstanceOf(BorderRect);
    expect(slicer.border.left).toBe(8);
    expect(slicer.border.bottom).toBe(8);
    expect(slicer.centerScaleMode).toBe('stretch');

    // TextureAtlas + AtlasAnimation: handle, index, enum mode, and the skipped
    // elapsedSec restored to its constructor default.
    const atlas = w.getComponent(spriteEntity, TextureAtlas)!;
    expect(atlas.layout.guid).toBe(atlasGuid);
    expect(atlas.index).toBe(3);
    const anim = w.getComponent(spriteEntity, AtlasAnimation)!;
    expect(anim.firstIndex).toBe(0);
    expect(anim.lastIndex).toBe(7);
    expect(anim.fps).toBe(12);
    expect(anim.mode).toBe('pingPong');
    expect(anim.paused).toBe(true);
    expect(anim.elapsedSec).toBe(0);

    // 2D lights.
    const point = w.getComponent(find(w, PointLight2d), PointLight2d)!;
    expect(Array.from(point.color)).toEqual([1, 0.5, 0.25]);
    expect(point.range).toBe(200);
    expect(point.radius).toBe(24);
    const ambient = w.getComponent(find(w, AmbientLight2d), AmbientLight2d)!;
    expect(Array.from(ambient.halfExtents!)).toEqual([200, 150]);

    // 2D mesh + per-type material handle.
    const meshEntity = find(w, Mesh2d);
    expect(w.getComponent(meshEntity, Mesh2d)!.handle.guid).toBe(meshGuid);
    expect(w.getComponent(meshEntity, mat2.MeshMaterial2d)!.handle.guid).toBe(matGuid);

    // Hierarchy + derived recompute: child world = parent (100,0,0) ∘ local (0,20,0).
    const parent = find(w, Name);
    expect(w.getComponent(spriteEntity, Parent)!.entity).toBe(parent);
    expect(w.getComponent(parent, Children)!.entities).toContain(spriteEntity);
    const gt = w.getComponent(spriteEntity, GlobalTransform)!;
    expect(gt.matrix[12]).toBeCloseTo(100, 4);
    expect(gt.matrix[13]).toBeCloseTo(20, 4);
  });
});
