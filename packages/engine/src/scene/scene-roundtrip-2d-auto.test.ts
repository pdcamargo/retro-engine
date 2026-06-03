import { describe, expect, it } from 'bun:test';

import type { AssetGuid } from '@retro-engine/assets';
import { World, type ComponentType, type Entity } from '@retro-engine/ecs';
import { vec2, vec4 } from '@retro-engine/math';

import {
  App,
  ColorMaterial2d,
  ColorMaterial2dPlugin,
  Images,
  Light2dPlugin,
  Material2dPlugin,
  Mesh,
  Mesh2d,
  Meshes,
  Sprite,
  SpritePlugin,
  TextureAtlas,
  TextureAtlasLayouts,
  Transform,
} from '../index';
import { Image } from '../image/image';
import { TextureAtlasLayout } from '../sprite/texture-atlas-layout';
import { serializeScene } from './serialize';
import { spawnScene } from './spawn';
import type { SceneData } from './scene-data';
import { makeCapturingRenderer, makeStubCanvas } from '../test-utils';

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

interface Guids {
  imageGuid: AssetGuid;
  atlasGuid: AssetGuid;
  meshGuid: AssetGuid;
  matGuid: AssetGuid;
}

/** Serialize a scene that references an image, an atlas layout, a 2D mesh, and a 2D material — each by GUID. */
const buildSceneJson = (): { scene: SceneData } & Guids => {
  const { app, mat } = buildApp();
  const image = app.getResource(Images)!.add(Image.solid(vec4.create(1, 1, 1, 1)));
  const atlas = app.getResource(TextureAtlasLayouts)!.add(new TextureAtlasLayout(vec2.create(64, 64), []));
  const mesh = app.getResource(Meshes)!.add(new Mesh({ label: 'm' }));
  const material = app.getResource(mat.Materials2d)!.add(new ColorMaterial2d());

  const spriteEntity = app.world.spawn();
  app.world
    .entity(spriteEntity)
    .insert(new Sprite({ image }), new TextureAtlas(atlas, 0), new Transform());
  const meshEntity = app.world.spawn();
  app.world.entity(meshEntity).insert(new Mesh2d(mesh), new mat.MeshMaterial2d(material), new Transform());

  const scene = JSON.parse(JSON.stringify(serializeScene(app))) as SceneData;
  return {
    scene,
    imageGuid: image.guid!,
    atlasGuid: atlas.guid!,
    meshGuid: mesh.guid!,
    matGuid: material.guid!,
  };
};

describe('scene round-trip — automatic GUID handle resolution (2D)', () => {
  it('restores sprite image, atlas layout, mesh, and material handles with no resolveHandle', () => {
    const { scene, imageGuid, atlasGuid, meshGuid, matGuid } = buildSceneJson();

    const { app, mat } = buildApp();
    app.getResource(Images)!.add(Image.solid(vec4.create(1, 1, 1, 1)), imageGuid);
    app.getResource(TextureAtlasLayouts)!.add(new TextureAtlasLayout(vec2.create(64, 64), []), atlasGuid);
    app.getResource(Meshes)!.add(new Mesh({ label: 'm' }), meshGuid);
    app.getResource(mat.Materials2d)!.add(new ColorMaterial2d(), matGuid);

    // No resolveHandle passed — handles resolve by GUID against the App's stores.
    spawnScene(app, scene);
    const w = app.world;

    const sprite = w.getComponent(find(w, Sprite), Sprite)!;
    expect(sprite.image!.guid).toBe(imageGuid);
    expect(app.getResource(Images)!.has(sprite.image!)).toBe(true);

    const atlas = w.getComponent(find(w, TextureAtlas), TextureAtlas)!;
    expect(atlas.layout.guid).toBe(atlasGuid);
    expect(app.getResource(TextureAtlasLayouts)!.has(atlas.layout)).toBe(true);

    const meshEntity = find(w, Mesh2d);
    expect(w.getComponent(meshEntity, Mesh2d)!.handle.guid).toBe(meshGuid);
    expect(w.getComponent(meshEntity, mat.MeshMaterial2d)!.handle.guid).toBe(matGuid);
    expect(app.getResource(mat.Materials2d)!.has(w.getComponent(meshEntity, mat.MeshMaterial2d)!.handle)).toBe(true);
  });
});
