import { describe, expect, it } from 'bun:test';

import type { Entity } from '@retro-engine/ecs';
import { vec3, vec4 } from '@retro-engine/math';

import { App, Camera2d, Mesh2d, Meshes, Rectangle, Transform } from '../index';
import { makeCapturingRenderer, makeStubCanvas } from '../test-utils';
import type { CapturedDrawLog } from '../test-utils';

import { ColorMaterial2d, ColorMaterial2dPlugin } from './color-material-2d';
import { Material2dPlugin } from './material-2d-plugin';

type Spawn = (app: App, plugin: Material2dPlugin<ColorMaterial2d>) => Entity[];

const buildApp = async (
  retained: boolean,
  spawn: Spawn,
): Promise<{ app: App; log: CapturedDrawLog; entities: Entity[] }> => {
  const { renderer, log } = makeCapturingRenderer();
  const app = new App({ renderer, canvas: makeStubCanvas() });
  app.addPlugin(new ColorMaterial2dPlugin());
  const plugin = new Material2dPlugin(ColorMaterial2d, retained ? { retained: true } : undefined);
  app.addPlugin(plugin);
  const entities = spawn(app, plugin);
  app.world.spawn(...Camera2d());
  await app.run();
  app.stop();
  return { app, log, entities };
};

const batchLayout = (log: CapturedDrawLog, suffix: string): Array<[number, number]> => {
  const pass = log.passes.find((p) => p.label?.endsWith(suffix));
  if (pass === undefined) return [];
  return pass.drawCalls
    .filter((c) => c.kind === 'drawIndexed')
    .map((c): [number, number] => [c.drawIndexed!.firstInstance, c.drawIndexed!.instanceCount])
    .sort((a, b) => a[0] - b[0]);
};

const expectParity = async (spawn: Spawn): Promise<void> => {
  const legacy = await buildApp(false, spawn);
  const retained = await buildApp(true, spawn);
  for (const suffix of ['.opaque2d', '.transparent2d', '.alphamask2d']) {
    expect(batchLayout(retained.log, suffix)).toEqual(batchLayout(legacy.log, suffix));
  }
};

describe('Material2dPlugin retained — parity with the legacy queue', () => {
  it('collapses one mesh + material into a single instanced draw', async () => {
    await expectParity((app, plugin) => {
      const mesh = app.getResource(Meshes)!.add(new Rectangle({ halfSize: [16, 16] }).mesh().build());
      const material = app.getResource(plugin.Materials2d)!.add(new ColorMaterial2d({ color: vec4.create(1, 1, 1, 1) }));
      const ids: Entity[] = [];
      for (let i = 0; i < 5; i++) ids.push(app.world.spawn(new Mesh2d(mesh), new plugin.MeshMaterial2d(material)));
      return ids;
    });
  });

  it('depth-orders distinct opaque materials back-to-front (2D has no depth buffer)', async () => {
    await expectParity((app, plugin) => {
      const mesh = app.getResource(Meshes)!.add(new Rectangle({ halfSize: [16, 16] }).mesh().build());
      const mats = app.getResource(plugin.Materials2d)!;
      const ids: Entity[] = [];
      for (let i = 0; i < 4; i++) {
        const m = mats.add(new ColorMaterial2d({ color: vec4.create(i / 4, 0, 0, 1) }));
        ids.push(app.world.spawn(new Mesh2d(mesh), new plugin.MeshMaterial2d(m), new Transform(vec3.create(0, 0, i))));
      }
      return ids;
    });
  });

  it('matches a mixed opaque + blend scene', async () => {
    await expectParity((app, plugin) => {
      const mesh = app.getResource(Meshes)!.add(new Rectangle({ halfSize: [16, 16] }).mesh().build());
      const mats = app.getResource(plugin.Materials2d)!;
      const opaque = mats.add(new ColorMaterial2d({ color: vec4.create(1, 1, 1, 1) }));
      const blend = mats.add(new ColorMaterial2d({ color: vec4.create(1, 1, 1, 0.5), alphaMode: 'blend' }));
      const ids: Entity[] = [];
      ids.push(app.world.spawn(new Mesh2d(mesh), new plugin.MeshMaterial2d(opaque), new Transform(vec3.create(0, 0, 1))));
      ids.push(app.world.spawn(new Mesh2d(mesh), new plugin.MeshMaterial2d(blend), new Transform(vec3.create(0, 0, 2))));
      return ids;
    });
  });

  it('converges after a Z move (re-sort)', async () => {
    const spawn: Spawn = (app, plugin) => {
      const mesh = app.getResource(Meshes)!.add(new Rectangle({ halfSize: [16, 16] }).mesh().build());
      const mats = app.getResource(plugin.Materials2d)!;
      const ids: Entity[] = [];
      for (let i = 0; i < 4; i++) {
        const m = mats.add(new ColorMaterial2d({ color: vec4.create(i / 4, 0, 0, 1) }));
        ids.push(app.world.spawn(new Mesh2d(mesh), new plugin.MeshMaterial2d(m), new Transform(vec3.create(0, 0, i))));
      }
      return ids;
    };
    const run = async (retained: boolean): Promise<Array<[number, number]>> => {
      const built = await buildApp(retained, spawn);
      built.log.passes.length = 0;
      const t = built.app.world.getComponent(built.entities[0]!, Transform)!;
      t.translation[2] = 99; // jump to front-most
      built.app.world.markChanged(built.entities[0]!, Transform);
      built.app.advanceFrame(32);
      return batchLayout(built.log, '.opaque2d');
    };
    expect(await run(true)).toEqual(await run(false));
  });
});
