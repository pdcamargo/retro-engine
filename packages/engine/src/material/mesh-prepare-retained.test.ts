import { describe, expect, it } from 'bun:test';

import { vec3, vec4 } from '@retro-engine/math';
import type { Buffer, BufferDescriptor, Renderer } from '@retro-engine/renderer-core';

import { App, Camera3d, Cuboid, Mesh3d, Meshes, NoFrustumCulling, Transform } from '../index';
import { makeRenderingRenderer, makeStubCanvas } from '../test-utils';
import type { CapturedDrawLog } from '../test-utils';
import { makeCapturingRenderer } from '../test-utils';

import { MaterialPlugin } from './material-plugin';
import { MESH_INSTANCE_BYTE_SIZE } from './instance-layout';
import { UnlitMaterial, UnlitMaterialPlugin } from './unlit-material';

import type { Entity } from '@retro-engine/ecs';

type Spawn = (app: App, plugin: MaterialPlugin<UnlitMaterial>) => Entity[];

const buildApp = async (
  retained: boolean,
  spawn: Spawn,
): Promise<{ app: App; log: CapturedDrawLog; entities: Entity[]; plugin: MaterialPlugin<UnlitMaterial> }> => {
  const { renderer, log } = makeCapturingRenderer();
  const app = new App({ renderer, canvas: makeStubCanvas() });
  app.addPlugin(new UnlitMaterialPlugin());
  const plugin = new MaterialPlugin(UnlitMaterial, retained ? { retained: true } : undefined);
  app.addPlugin(plugin);
  const entities = spawn(app, plugin);
  app.world.spawn(...Camera3d());
  await app.run();
  app.stop();
  return { app, log, entities, plugin };
};

/** Batch layout of a pass: `(firstInstance, count)` pairs sorted by offset — order-independent of phase sorting. */
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
  for (const suffix of ['.opaque3d', '.transparent3d', '.alphamask3d']) {
    expect(batchLayout(retained.log, suffix)).toEqual(batchLayout(legacy.log, suffix));
  }
};

describe('prepareMeshRetained — 3D parity with the legacy queue', () => {
  it('collapses one mesh + material into a single instanced draw', async () => {
    await expectParity((app, plugin) => {
      const mesh = app.getResource(Meshes)!.add(new Cuboid().mesh().build());
      const material = app.getResource(plugin.Materials)!.add(new UnlitMaterial({ color: vec4.create(1, 1, 1, 1) }));
      const ids: Entity[] = [];
      for (let i = 0; i < 5; i++) {
        ids.push(app.world.spawn(new Mesh3d(mesh), new plugin.MeshMaterial3d(material), new NoFrustumCulling()));
      }
      return ids;
    });
  });

  it('emits a batch per material and per mesh', async () => {
    await expectParity((app, plugin) => {
      const meshes = app.getResource(Meshes)!;
      const cubeA = meshes.add(new Cuboid().mesh().build());
      const cubeB = meshes.add(new Cuboid({ halfSize: [2, 2, 2] }).mesh().build());
      const matA = app.getResource(plugin.Materials)!.add(new UnlitMaterial({ color: vec4.create(1, 0, 0, 1) }));
      const matB = app.getResource(plugin.Materials)!.add(new UnlitMaterial({ color: vec4.create(0, 1, 0, 1) }));
      const ids: Entity[] = [];
      for (let i = 0; i < 3; i++) ids.push(app.world.spawn(new Mesh3d(cubeA), new plugin.MeshMaterial3d(matA), new NoFrustumCulling()));
      for (let i = 0; i < 2; i++) ids.push(app.world.spawn(new Mesh3d(cubeB), new plugin.MeshMaterial3d(matB), new NoFrustumCulling()));
      return ids;
    });
  });

  it('matches the depth-ordered transparent bucket', async () => {
    await expectParity((app, plugin) => {
      const mesh = app.getResource(Meshes)!.add(new Cuboid().mesh().build());
      const mats = app.getResource(plugin.Materials)!;
      // Distinct materials so each stays its own batch — exercises blend depth sort.
      const ids: Entity[] = [];
      for (let i = 0; i < 4; i++) {
        const m = mats.add(new UnlitMaterial({ color: vec4.create(1, 1, 1, 0.5), alphaMode: 'blend' }));
        ids.push(
          app.world.spawn(
            new Mesh3d(mesh),
            new plugin.MeshMaterial3d(m),
            new NoFrustumCulling(),
            new Transform(vec3.create(0, 0, -i)),
          ),
        );
      }
      return ids;
    });
  });
});

describe('prepareMeshRetained — change-gated convergence', () => {
  const spawnGrid: Spawn = (app, plugin) => {
    const mesh = app.getResource(Meshes)!.add(new Cuboid().mesh().build());
    const material = app.getResource(plugin.Materials)!.add(new UnlitMaterial({ color: vec4.create(1, 1, 1, 1) }));
    const ids: Entity[] = [];
    for (let i = 0; i < 6; i++) {
      ids.push(
        app.world.spawn(
          new Mesh3d(mesh),
          new plugin.MeshMaterial3d(material),
          new NoFrustumCulling(),
          new Transform(vec3.create(i, 0, 0)),
        ),
      );
    }
    return ids;
  };

  const twoFrame = async (
    retained: boolean,
    mutate: (app: App, entities: Entity[]) => void,
  ): Promise<CapturedDrawLog> => {
    const built = await buildApp(retained, spawnGrid);
    built.log.passes.length = 0;
    mutate(built.app, built.entities);
    built.app.advanceFrame(32);
    return built.log;
  };

  it('converges after a move and a despawn+spawn', async () => {
    const mutate = (app: App, e: Entity[]): void => {
      const t = app.world.getComponent(e[0]!, Transform)!;
      t.translation[0] = 50;
      app.world.markChanged(e[0]!, Transform);
      app.world.despawn(e[2]!);
    };
    const legacy = batchLayout(await twoFrame(false, mutate), '.opaque3d');
    const retained = batchLayout(await twoFrame(true, mutate), '.opaque3d');
    expect(retained).toEqual(legacy);
  });
});

describe('prepareMeshRetained — incremental instance upload', () => {
  it('uploads the full buffer once, then nothing when the scene is static', async () => {
    const writes: Array<{ buffer: Buffer; bytes: number }> = [];
    const base = makeRenderingRenderer();
    let instanceBuffer: Buffer | undefined;
    const renderer: Renderer = {
      ...base,
      createBuffer: (d: BufferDescriptor): Buffer => {
        const buf = base.createBuffer(d);
        if (d.label === 'mesh-instance') instanceBuffer = buf;
        return buf;
      },
      writeBuffer: (buffer: Buffer, _o: number, data: BufferSource) => {
        writes.push({ buffer, bytes: (data as ArrayBufferView).byteLength });
      },
    };
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new UnlitMaterialPlugin());
    const plugin = new MaterialPlugin(UnlitMaterial, { retained: true });
    app.addPlugin(plugin);
    const mesh = app.getResource(Meshes)!.add(new Cuboid().mesh().build());
    const material = app.getResource(plugin.Materials)!.add(new UnlitMaterial({ color: vec4.create(1, 1, 1, 1) }));
    for (let i = 0; i < 8; i++) {
      app.world.spawn(new Mesh3d(mesh), new plugin.MeshMaterial3d(material), new NoFrustumCulling());
    }
    app.world.spawn(...Camera3d());

    await app.run(); // frame 1: full seed of the ordered buffer
    app.stop();
    expect(instanceBuffer).toBeDefined();
    const toInstance = (): number =>
      writes.filter((w) => w.buffer === instanceBuffer).reduce((s, w) => s + w.bytes, 0);
    expect(toInstance()).toBe(8 * MESH_INSTANCE_BYTE_SIZE); // all 8 packed once

    writes.length = 0;
    app.advanceFrame(32); // static frame: nothing re-uploaded
    expect(toInstance()).toBe(0);
  });
});
