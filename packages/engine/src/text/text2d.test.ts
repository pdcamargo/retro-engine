import { describe, expect, it } from 'bun:test';

import { World } from '@retro-engine/ecs';
import { asAssetIndex, generateAssetGuid, makeHandle } from '@retro-engine/assets';
import { vec2, vec4 } from '@retro-engine/math';

import { App, AppTypeRegistry } from '../index';
import { deserializeScene } from '../scene/deserialize';
import type { SceneData } from '../scene/scene-data';
import { serializeWorld } from '../scene/serialize';
import { makeCapturingRenderer, makeStubCanvas } from '../test-utils';

import type { Font } from './font-asset';
import { Text2d } from './text2d';
import { TextPlugin } from './text-plugin';

const buildApp = (): App => {
  const { renderer } = makeCapturingRenderer();
  const app = new App({ renderer, canvas: makeStubCanvas() });
  app.addPlugin(new TextPlugin());
  return app;
};

describe('Text2d', () => {
  it('applies documented defaults when constructed empty', () => {
    const t = new Text2d();
    expect(t.text).toBe('');
    expect(t.font).toBeUndefined();
    expect(t.fontSize).toBe(16);
    expect(Array.from(t.color)).toEqual([1, 1, 1, 1]);
    expect(t.align).toBe('left');
    expect(t.lineHeight).toBeUndefined();
    expect(t.maxWidth).toBeUndefined();
    expect(t.letterSpacing).toBe(0);
    expect(Array.from(t.anchor)).toEqual([0.5, 0.5]);
  });

  it('auto-attaches its required transform + visibility components', () => {
    expect(Text2d.requires.length).toBe(5);
  });

  it('registers the Text2d schema via TextPlugin', () => {
    const app = buildApp();
    expect(app.getResource(AppTypeRegistry)!.registry.has('Text2d')).toBe(true);
  });

  it('round-trips through scene serialization', () => {
    const app = buildApp();
    const registry = app.getResource(AppTypeRegistry)!.registry;
    const guid = generateAssetGuid();

    const source = new World();
    source.spawn(
      new Text2d({
        text: 'Hello\nworld',
        font: makeHandle<Font>(asAssetIndex(3), guid),
        fontSize: 24,
        color: vec4.create(0.5, 0.25, 0.75, 1),
        align: 'center',
        lineHeight: 30,
        maxWidth: 200,
        letterSpacing: 2,
        anchor: vec2.create(0, 1),
      }),
    );

    const sceneData: SceneData = JSON.parse(JSON.stringify(serializeWorld(source, registry)));

    const target = new World();
    const restored = makeHandle<Font>(asAssetIndex(50), guid);
    deserializeScene(sceneData, target, registry, {
      resolveHandle: (_t, g) => (g === guid ? restored : makeHandle<Font>(asAssetIndex(0))),
    });

    let found: Text2d | undefined;
    for (const entity of target.entities()) {
      const c = target.getComponent(entity, Text2d);
      if (c !== undefined) found = c;
    }
    expect(found).toBeInstanceOf(Text2d);
    expect(found!.text).toBe('Hello\nworld');
    expect(found!.fontSize).toBe(24);
    expect(Array.from(found!.color)).toEqual([0.5, 0.25, 0.75, 1]);
    expect(found!.align).toBe('center');
    expect(found!.lineHeight).toBe(30);
    expect(found!.maxWidth).toBe(200);
    expect(found!.letterSpacing).toBe(2);
    expect(Array.from(found!.anchor)).toEqual([0, 1]);
    expect(found!.font?.guid).toBe(guid);
  });
});
