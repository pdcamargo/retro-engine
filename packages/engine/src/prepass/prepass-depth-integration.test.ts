import type {
  CommandBuffer,
  CommandEncoder,
  RenderPassDescriptor,
  RenderPassEncoder,
} from '@retro-engine/renderer-core';
import { describe, expect, it } from 'bun:test';

import { App, Camera3d, Cuboid, Mesh3d, Meshes } from '../index';
import { MaterialPlugin } from '../material/material-plugin';
import { UnlitMaterial, UnlitMaterialPlugin } from '../material/unlit-material';
import { makeRenderingRenderer, makeStubCanvas } from '../test-utils';
import { vec4 } from '@retro-engine/math';

import { DepthPrepass } from './components';
import { PrepassPlugin } from './prepass-plugin';

interface CapturedDescriptor {
  label: string | undefined;
  depthLoadOp: 'load' | 'clear' | undefined;
}

const wrapWithDescriptorCapture = (): {
  renderer: ReturnType<typeof makeRenderingRenderer>;
  passes: CapturedDescriptor[];
} => {
  const base = makeRenderingRenderer();
  const passes: CapturedDescriptor[] = [];
  const pass: RenderPassEncoder = {
    setPipeline: () => undefined,
    setBindGroup: () => undefined,
    setVertexBuffer: () => undefined,
    setIndexBuffer: () => undefined,
    draw: () => undefined,
    drawIndexed: () => undefined,
    setStencilReference: () => undefined,
    end: () => undefined,
  };
  const cmd: CommandBuffer = { destroy: () => undefined };
  const encoder: CommandEncoder = {
    beginRenderPass(d: RenderPassDescriptor) {
      passes.push({
        label: d.label,
        depthLoadOp: d.depthStencilAttachment?.depthLoadOp,
      });
      return pass;
    },
    finish: () => cmd,
  };
  return {
    renderer: { ...base, createCommandEncoder: () => encoder },
    passes,
  };
};

describe('OpaquePass3dNode + PrepassNode3d depth integration', () => {
  it("loads depth in opaque pass when prepass produced an entry; clears otherwise", async () => {
    // Camera WITH a prepass marker.
    const { renderer: rWith, passes: passesWith } = wrapWithDescriptorCapture();
    const appWith = new App({ renderer: rWith, canvas: makeStubCanvas() });
    appWith.addPlugin(new UnlitMaterialPlugin());
    const pluginWith = new MaterialPlugin(UnlitMaterial);
    appWith.addPlugin(pluginWith);
    appWith.addPlugin(new PrepassPlugin());

    const meshHandleW = appWith.getResource(Meshes)!.add(new Cuboid().mesh().build());
    const matHandleW = appWith
      .getResource(pluginWith.Materials)!
      .add(new UnlitMaterial({ color: vec4.create(1, 1, 1, 1) }));
    appWith.world.spawn(new Mesh3d(meshHandleW), new pluginWith.MeshMaterial3d(matHandleW));
    appWith.world.spawn(...Camera3d(), new DepthPrepass());

    await appWith.run();
    appWith.stop();

    const opaqueWith = passesWith.find((p) => p.label?.endsWith('.opaque3d'));
    expect(opaqueWith).toBeDefined();
    expect(opaqueWith?.depthLoadOp).toBe('load');

    // Camera WITHOUT a prepass marker — same set-up but no marker.
    const { renderer: rNo, passes: passesNo } = wrapWithDescriptorCapture();
    const appNo = new App({ renderer: rNo, canvas: makeStubCanvas() });
    appNo.addPlugin(new UnlitMaterialPlugin());
    const pluginNo = new MaterialPlugin(UnlitMaterial);
    appNo.addPlugin(pluginNo);
    appNo.addPlugin(new PrepassPlugin());

    const meshHandleN = appNo.getResource(Meshes)!.add(new Cuboid().mesh().build());
    const matHandleN = appNo
      .getResource(pluginNo.Materials)!
      .add(new UnlitMaterial({ color: vec4.create(1, 1, 1, 1) }));
    appNo.world.spawn(new Mesh3d(meshHandleN), new pluginNo.MeshMaterial3d(matHandleN));
    appNo.world.spawn(...Camera3d());

    await appNo.run();
    appNo.stop();

    const opaqueNo = passesNo.find((p) => p.label?.endsWith('.opaque3d'));
    expect(opaqueNo).toBeDefined();
    expect(opaqueNo?.depthLoadOp).toBe('clear');
  });

  it("emits a prepass_3d pass for a camera with DepthPrepass", async () => {
    const { renderer, passes } = wrapWithDescriptorCapture();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new UnlitMaterialPlugin());
    app.addPlugin(new MaterialPlugin(UnlitMaterial));
    app.addPlugin(new PrepassPlugin());

    app.world.spawn(...Camera3d(), new DepthPrepass());

    await app.run();
    app.stop();

    const prepass = passes.find((p) => p.label?.endsWith('.prepass_3d'));
    expect(prepass).toBeDefined();
    expect(prepass?.depthLoadOp).toBe('clear');
  });

  it("does NOT emit a prepass_3d pass when no prepass marker is present", async () => {
    const { renderer, passes } = wrapWithDescriptorCapture();
    const app = new App({ renderer, canvas: makeStubCanvas() });
    app.addPlugin(new UnlitMaterialPlugin());
    app.addPlugin(new MaterialPlugin(UnlitMaterial));
    app.addPlugin(new PrepassPlugin());

    app.world.spawn(...Camera3d()); // no DepthPrepass marker.

    await app.run();
    app.stop();

    const prepass = passes.find((p) => p.label?.endsWith('.prepass_3d'));
    expect(prepass).toBeUndefined();
  });
});
