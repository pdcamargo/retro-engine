import { describe, expect, it } from 'bun:test';

import { App } from '../index';
import { makeRenderingRenderer } from '../test-utils';
import { MeshAllocator } from './allocator';
import { Mesh } from './mesh';
import { Meshes } from './meshes';
import { MeshPlugin, RenderMeshes } from './mesh-plugin';
import { u32Indices } from './indices';
import { MeshAttribute } from './vertex-attribute';

const makeApp = (): App => new App({ renderer: makeRenderingRenderer() });

describe('MeshPlugin', () => {
  it('installs Meshes, MeshAllocator, and RenderMeshes resources', () => {
    const app = makeApp();
    expect(app.getResource(Meshes)).toBeDefined();
    expect(app.getResource(MeshAllocator)).toBeDefined();
    expect(app.getResource(RenderMeshes)).toBeDefined();
  });

  it('is registered automatically by CorePlugin (manual re-add throws)', () => {
    const app = makeApp();
    expect(() => app.addPlugin(new MeshPlugin())).toThrow();
  });

  it('Added events drive allocator state across a frame', () => {
    const app = makeApp();
    const meshes = app.getResource(Meshes)!;
    const renderMeshes = app.getResource(RenderMeshes)!;
    const handle = meshes.add(
      new Mesh()
        .insertAttribute(MeshAttribute.POSITION, new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
        .setIndices(u32Indices([0, 1, 2])),
    );
    expect(renderMeshes.has(handle)).toBe(false);
    app.advanceFrame();
    expect(renderMeshes.has(handle)).toBe(true);
    const rm = renderMeshes.get(handle)!;
    expect(rm.vertexCount).toBe(3);
    expect(rm.bufferInfo.kind).toBe('indexed');
    if (rm.bufferInfo.kind === 'indexed') {
      expect(rm.bufferInfo.indexCount).toBe(3);
      expect(rm.bufferInfo.indexFormat).toBe('uint32');
    }
    expect(rm.primitiveTopology).toBe('triangle-list');
  });

  it('Removed events drop the entry from RenderMeshes', () => {
    const app = makeApp();
    const meshes = app.getResource(Meshes)!;
    const renderMeshes = app.getResource(RenderMeshes)!;
    const handle = meshes.add(
      new Mesh().insertAttribute(MeshAttribute.POSITION, new Float32Array(9)),
    );
    app.advanceFrame();
    expect(renderMeshes.has(handle)).toBe(true);
    meshes.remove(handle);
    app.advanceFrame();
    expect(renderMeshes.has(handle)).toBe(false);
  });

  it('Modified events refresh the entry (new vertexCount)', () => {
    const app = makeApp();
    const meshes = app.getResource(Meshes)!;
    const renderMeshes = app.getResource(RenderMeshes)!;
    const handle = meshes.add(
      new Mesh().insertAttribute(MeshAttribute.POSITION, new Float32Array(9)),
    );
    app.advanceFrame();
    expect(renderMeshes.get(handle)?.vertexCount).toBe(3);
    meshes.mutate(handle, (m) => {
      m.insertAttribute(MeshAttribute.POSITION, new Float32Array(18));
    });
    app.advanceFrame();
    expect(renderMeshes.get(handle)?.vertexCount).toBe(6);
  });
});
