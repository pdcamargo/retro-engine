import { vec4 } from '@retro-engine/math';
import { describe, expect, it } from 'bun:test';
import type {
  Buffer,
  BufferDescriptor,
  Renderer,
} from '@retro-engine/renderer-core';

import { App, Camera3d, Cuboid, Mesh3d, Meshes, ViewPhases3d } from '../index';
import { Light3dPlugin } from '../light3d/light-3d-plugin';
import { MaterialPlugin } from '../material/material-plugin';
import {
  PREVIOUS_INSTANCE_FLOAT_COUNT,
  StandardMaterial,
  StandardMaterialPlugin,
} from '../material';
import { PipelineCache } from '../shader/pipeline-cache';
import { makeRenderingRenderer, makeStubCanvas } from '../test-utils';

import { DepthPrepass, MotionVectorPrepass, NormalPrepass } from './components';
import { PrepassPlugin } from './prepass-plugin';

/**
 * Wraps `makeRenderingRenderer` with a hook that records every `writeBuffer`
 * call keyed by the originating GPU buffer's label. Lets the test inspect the
 * float contents the material plugin pushed to the previous-instance buffer
 * each frame.
 */
const makeWriteCapturingRenderer = (): {
  renderer: Renderer;
  lastWriteByLabel: Map<string, Float32Array>;
} => {
  const base = makeRenderingRenderer();
  const bufferLabels = new Map<Buffer, string>();
  const lastWriteByLabel = new Map<string, Float32Array>();
  const createBuffer = base.createBuffer.bind(base);
  const writeBuffer = base.writeBuffer.bind(base);
  base.createBuffer = (descriptor: BufferDescriptor): Buffer => {
    const buf = createBuffer(descriptor);
    if (descriptor.label !== undefined) bufferLabels.set(buf, descriptor.label);
    return buf;
  };
  base.writeBuffer = (buf: Buffer, offset: number, data: BufferSource): void => {
    writeBuffer(buf, offset, data);
    const label = bufferLabels.get(buf);
    if (label === undefined) return;
    const arrayBuffer =
      data instanceof ArrayBuffer
        ? data.slice(0)
        : (data.buffer as ArrayBuffer).slice(
            (data as ArrayBufferView).byteOffset,
            (data as ArrayBufferView).byteOffset + (data as ArrayBufferView).byteLength,
          );
    lastWriteByLabel.set(label, new Float32Array(arrayBuffer));
  };
  return { renderer: base, lastWriteByLabel };
};

const buildApp = (renderer: Renderer) => {
  const app = new App({ renderer, canvas: makeStubCanvas() });
  app.addPlugin(new StandardMaterialPlugin());
  const matPlugin = new MaterialPlugin(StandardMaterial);
  app.addPlugin(matPlugin);
  app.addPlugin(new Light3dPlugin());
  app.addPlugin(new PrepassPlugin());
  return { app, matPlugin };
};

describe('Motion-vector prepass — integration', () => {
  it('queues prepass items when a camera has DepthPrepass + NormalPrepass + MotionVectorPrepass', async () => {
    const { renderer } = makeWriteCapturingRenderer();
    const { app, matPlugin } = buildApp(renderer);

    const meshHandle = app.getResource(Meshes)!.add(new Cuboid().mesh().build());
    const matHandle = app
      .getResource(matPlugin.Materials)!
      .add(new StandardMaterial({ baseColor: vec4.create(1, 0.5, 0.25, 1) }));
    app.world.spawn(new Mesh3d(meshHandle), new matPlugin.MeshMaterial3d(matHandle));
    app.world.spawn(
      ...Camera3d(),
      new DepthPrepass(),
      new NormalPrepass(),
      new MotionVectorPrepass(),
    );

    await app.run();
    app.stop();

    const phases = app.getResource(ViewPhases3d)!;
    let totalPrepassItems = 0;
    for (const items of phases.prepass.values()) totalPrepassItems += items.length;
    expect(totalPrepassItems).toBeGreaterThan(0);
  });

  it('first-frame previous-instance contents equal the current model — zero motion', async () => {
    const { renderer, lastWriteByLabel } = makeWriteCapturingRenderer();
    const { app, matPlugin } = buildApp(renderer);

    const meshHandle = app.getResource(Meshes)!.add(new Cuboid().mesh().build());
    const matHandle = app
      .getResource(matPlugin.Materials)!
      .add(new StandardMaterial({ baseColor: vec4.create(1, 1, 1, 1) }));
    app.world.spawn(new Mesh3d(meshHandle), new matPlugin.MeshMaterial3d(matHandle));
    app.world.spawn(
      ...Camera3d(),
      new DepthPrepass(),
      new NormalPrepass(),
      new MotionVectorPrepass(),
    );

    await app.run();
    app.stop();

    const prevWrite = lastWriteByLabel.get('mesh-previous-instance-buffer');
    const curWrite = lastWriteByLabel.get('mesh-instance-buffer');
    expect(prevWrite).toBeDefined();
    expect(curWrite).toBeDefined();
    // The current-instance buffer packs model (16 floats) + inv-transpose (16
    // floats) per instance — 32 floats. The previous-instance buffer packs
    // only the model — 16 floats per instance. First-frame motion is zero
    // when the previous model matches the current model.
    for (let i = 0; i < PREVIOUS_INSTANCE_FLOAT_COUNT; i++) {
      expect(prevWrite![i]).toBeCloseTo(curWrite![i]!);
    }
  });

  it('compiles a motion-variant shader module distinct from the depth-only module', async () => {
    // A camera with DepthPrepass + NormalPrepass + MotionVectorPrepass must
    // force the lazy compile of the `PREPASS_MOTION_VECTOR`-defined
    // pbr-vertex / pbr-fragment variant. The variant differs in source
    // (different #ifdef branches), so the `PipelineCache.shaderModuleCount`
    // grows by at least one extra module versus a camera with only
    // DepthPrepass.
    const { renderer } = makeWriteCapturingRenderer();
    const { app, matPlugin } = buildApp(renderer);
    const meshHandle = app.getResource(Meshes)!.add(new Cuboid().mesh().build());
    const matHandle = app
      .getResource(matPlugin.Materials)!
      .add(new StandardMaterial({ baseColor: vec4.create(1, 1, 1, 1) }));
    app.world.spawn(new Mesh3d(meshHandle), new matPlugin.MeshMaterial3d(matHandle));
    app.world.spawn(
      ...Camera3d(),
      new DepthPrepass(),
      new NormalPrepass(),
      new MotionVectorPrepass(),
    );
    await app.run();
    const motionShaderCount = app.getResource(PipelineCache)!.shaderModuleCount;
    app.stop();

    const { renderer: renderer2 } = makeWriteCapturingRenderer();
    const { app: app2, matPlugin: matPlugin2 } = buildApp(renderer2);
    const mesh2 = app2.getResource(Meshes)!.add(new Cuboid().mesh().build());
    const mat2 = app2
      .getResource(matPlugin2.Materials)!
      .add(new StandardMaterial({ baseColor: vec4.create(1, 1, 1, 1) }));
    app2.world.spawn(new Mesh3d(mesh2), new matPlugin2.MeshMaterial3d(mat2));
    app2.world.spawn(...Camera3d(), new DepthPrepass());
    await app2.run();
    const depthOnlyShaderCount = app2.getResource(PipelineCache)!.shaderModuleCount;
    app2.stop();

    expect(motionShaderCount).toBeGreaterThan(depthOnlyShaderCount);
  });

  it('cardinality: one prepass pipeline per opt-in material across N identical entities', async () => {
    const { renderer } = makeWriteCapturingRenderer();
    const { app, matPlugin } = buildApp(renderer);

    const meshHandle = app.getResource(Meshes)!.add(new Cuboid().mesh().build());
    const matHandle = app
      .getResource(matPlugin.Materials)!
      .add(new StandardMaterial({ baseColor: vec4.create(1, 1, 1, 1) }));
    for (let i = 0; i < 5; i++) {
      app.world.spawn(new Mesh3d(meshHandle), new matPlugin.MeshMaterial3d(matHandle));
    }
    app.world.spawn(
      ...Camera3d(),
      new DepthPrepass(),
      new NormalPrepass(),
      new MotionVectorPrepass(),
    );

    await app.run();
    app.stop();

    // Five identical entities + one camera with all three flags must produce
    // exactly one StandardMaterial prepass pipeline (the d+n+m variant), not
    // three (one per flag). The pipeline-cache count captures every distinct
    // pipeline across the engine — count it now and assert that adding a
    // sixth identical entity wouldn't grow it.
    const cache = app.getResource(PipelineCache)!;
    const baseline = cache.renderPipelineCount;

    // A second identical app sharing the same (mesh, material) handles
    // produces the same delta — no per-entity pipeline explosion.
    const { renderer: renderer2 } = makeWriteCapturingRenderer();
    const { app: app2, matPlugin: matPlugin2 } = buildApp(renderer2);
    const mesh2 = app2.getResource(Meshes)!.add(new Cuboid().mesh().build());
    const mat2 = app2
      .getResource(matPlugin2.Materials)!
      .add(new StandardMaterial({ baseColor: vec4.create(1, 1, 1, 1) }));
    for (let i = 0; i < 50; i++) {
      app2.world.spawn(new Mesh3d(mesh2), new matPlugin2.MeshMaterial3d(mat2));
    }
    app2.world.spawn(
      ...Camera3d(),
      new DepthPrepass(),
      new NormalPrepass(),
      new MotionVectorPrepass(),
    );
    await app2.run();
    app2.stop();

    expect(app2.getResource(PipelineCache)!.renderPipelineCount).toBe(baseline);
  });
});
