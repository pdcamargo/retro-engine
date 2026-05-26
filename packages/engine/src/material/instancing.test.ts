import { describe, expect, it } from 'bun:test';

import { vec4 } from '@retro-engine/math';

import {
  App,
  Camera3d,
  Cuboid,
  Mesh3d,
  Meshes,
  NoFrustumCulling,
  ShaderPlugin,
} from '../index';
import { makeCapturingRenderer, makeStubCanvas } from '../test-utils';
import type { CapturedPass } from '../test-utils';

import { MaterialPlugin } from './material-plugin';
import { UnlitMaterial, UnlitMaterialPlugin } from './unlit-material';

const opaquePass = (passes: readonly CapturedPass[]): CapturedPass => {
  const pass = passes.find((p) => p.label?.endsWith('.opaque3d'));
  expect(pass).toBeDefined();
  return pass!;
};

const drawIndexedCalls = (pass: CapturedPass) =>
  pass.drawCalls.filter((c) => c.kind === 'drawIndexed');

describe('instanced mesh-material rendering', () => {
  it('collapses N entities sharing one mesh + material into a single instanced draw', async () => {
    const { renderer, log } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new UnlitMaterialPlugin());
    const plugin = new MaterialPlugin(UnlitMaterial);
    app.addPlugin(plugin);

    const mesh = app.getResource(Meshes)!.add(new Cuboid().mesh().build());
    const material = app.getResource(plugin.Materials)!.add(new UnlitMaterial({ color: vec4.create(1, 1, 1, 1) }));

    for (let i = 0; i < 5; i++) {
      app.world.spawn(new Mesh3d(mesh), new plugin.MeshMaterial3d(material), new NoFrustumCulling());
    }
    app.world.spawn(...Camera3d());

    await app.run();

    const draws = drawIndexedCalls(opaquePass(log.passes));
    expect(draws).toHaveLength(1);
    expect(draws[0]!.drawIndexed!.instanceCount).toBe(5);
    expect(draws[0]!.drawIndexed!.firstInstance).toBe(0);
  });

  it('binds material at @group(1), no per-entity group, with the instance buffer at vertex slot 1', async () => {
    const { renderer, log } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new UnlitMaterialPlugin());
    const plugin = new MaterialPlugin(UnlitMaterial);
    app.addPlugin(plugin);

    const mesh = app.getResource(Meshes)!.add(new Cuboid().mesh().build());
    const material = app.getResource(plugin.Materials)!.add(new UnlitMaterial({ color: vec4.create(1, 1, 1, 1) }));
    app.world.spawn(new Mesh3d(mesh), new plugin.MeshMaterial3d(material), new NoFrustumCulling());
    app.world.spawn(...Camera3d());

    await app.run();

    const pass = opaquePass(log.passes);
    const boundGroups = pass.drawCalls.filter((c) => c.kind === 'setBindGroup').map((c) => c.bindGroup!.index);
    // @group(0) view (set by the pass node) + @group(1) material. Never @group(2).
    expect(boundGroups).toContain(1);
    expect(boundGroups).not.toContain(2);

    const slots = pass.drawCalls.filter((c) => c.kind === 'setVertexBuffer').map((c) => c.vertexBuffer!.slot);
    expect(slots).toContain(0); // mesh vertex data
    expect(slots).toContain(1); // per-instance transforms
  });

  it('emits a separate instanced batch per material', async () => {
    const { renderer, log } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new UnlitMaterialPlugin());
    const plugin = new MaterialPlugin(UnlitMaterial);
    app.addPlugin(plugin);

    const mesh = app.getResource(Meshes)!.add(new Cuboid().mesh().build());
    const matA = app.getResource(plugin.Materials)!.add(new UnlitMaterial({ color: vec4.create(1, 0, 0, 1) }));
    const matB = app.getResource(plugin.Materials)!.add(new UnlitMaterial({ color: vec4.create(0, 1, 0, 1) }));

    for (let i = 0; i < 3; i++) app.world.spawn(new Mesh3d(mesh), new plugin.MeshMaterial3d(matA), new NoFrustumCulling());
    for (let i = 0; i < 2; i++) app.world.spawn(new Mesh3d(mesh), new plugin.MeshMaterial3d(matB), new NoFrustumCulling());
    app.world.spawn(...Camera3d());

    await app.run();

    const counts = drawIndexedCalls(opaquePass(log.passes))
      .map((c) => c.drawIndexed!.instanceCount)
      .sort();
    expect(counts).toEqual([2, 3]);
  });

  it('emits a separate batch per mesh', async () => {
    const { renderer, log } = makeCapturingRenderer();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new UnlitMaterialPlugin());
    const plugin = new MaterialPlugin(UnlitMaterial);
    app.addPlugin(plugin);

    const meshes = app.getResource(Meshes)!;
    const cubeA = meshes.add(new Cuboid().mesh().build());
    const cubeB = meshes.add(new Cuboid({ halfSize: [2, 2, 2] }).mesh().build());
    const material = app.getResource(plugin.Materials)!.add(new UnlitMaterial({ color: vec4.create(1, 1, 1, 1) }));

    app.world.spawn(new Mesh3d(cubeA), new plugin.MeshMaterial3d(material), new NoFrustumCulling());
    app.world.spawn(new Mesh3d(cubeB), new plugin.MeshMaterial3d(material), new NoFrustumCulling());
    app.world.spawn(...Camera3d());

    await app.run();

    expect(drawIndexedCalls(opaquePass(log.passes))).toHaveLength(2);
  });
});

// Referenced only in TSDoc-adjacent setup ordering; keep the binding alive.
void ShaderPlugin;
