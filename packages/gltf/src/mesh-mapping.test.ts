import { MeshAttribute } from '@retro-engine/engine';
import { describe, expect, it } from 'bun:test';

import { mapPrimitiveToMesh } from './mesh-mapping';
import { rawBytes } from './mapping-test-support';
import type {
  GltfAccessor,
  GltfAccessorType,
  GltfBufferView,
  GltfComponentType,
  GltfDocument,
  GltfPrimitive,
} from './schema';

interface AccessorEntry {
  componentType: GltfComponentType;
  type: GltfAccessorType;
  count: number;
  normalized?: boolean;
  data: ArrayBufferView;
}

/** Build a document where each accessor gets its own (offset-0) buffer. */
const buildDoc = (entries: AccessorEntry[]): { document: GltfDocument; buffers: Uint8Array[] } => {
  const buffers: Uint8Array[] = [];
  const bufferViews: GltfBufferView[] = [];
  const accessors: GltfAccessor[] = [];
  entries.forEach((e, i) => {
    buffers.push(rawBytes(e.data));
    bufferViews.push({ buffer: i, byteOffset: 0, byteLength: e.data.byteLength });
    accessors.push({
      bufferView: i,
      componentType: e.componentType,
      count: e.count,
      type: e.type,
      ...(e.normalized ? { normalized: true } : {}),
    });
  });
  return { document: { asset: { version: '2.0' }, bufferViews, accessors }, buffers };
};

describe('mapPrimitiveToMesh — attributes', () => {
  it('maps semantics and applies no coordinate conversion', () => {
    const { document, buffers } = buildDoc([
      { componentType: 5126, type: 'VEC3', count: 2, data: new Float32Array([0, 0, 0, 1, 2, 3]) },
      { componentType: 5126, type: 'VEC3', count: 2, data: new Float32Array([0, 1, 0, 0, 1, 0]) },
      { componentType: 5126, type: 'VEC2', count: 2, data: new Float32Array([0, 0, 1, 1]) },
      {
        componentType: 5126,
        type: 'VEC4',
        count: 2,
        data: new Float32Array([1, 0, 0, 1, 0, 1, 0, 1]),
      },
    ]);
    const primitive: GltfPrimitive = {
      attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2, TANGENT: 3 },
    };

    const mesh = mapPrimitiveToMesh(document, buffers, primitive);

    expect(mesh.attributeCount).toBe(4);
    expect(mesh.hasAttribute(MeshAttribute.POSITION)).toBe(true);
    expect(mesh.hasAttribute(MeshAttribute.NORMAL)).toBe(true);
    expect(mesh.hasAttribute(MeshAttribute.UV_0)).toBe(true);
    expect(mesh.hasAttribute(MeshAttribute.TANGENT)).toBe(true);
    // Positions are carried through verbatim — no winding/axis remap.
    expect(Array.from(mesh.getAttribute(MeshAttribute.POSITION)!.data)).toEqual([0, 0, 0, 1, 2, 3]);
  });

  it('inserts attributes in canonical slot order regardless of glTF key order', () => {
    // Blender exports often list COLOR_0 first; the engine's shaders expect
    // position at location 0, so insertion order must not follow the file.
    const { document, buffers } = buildDoc([
      {
        componentType: 5123,
        type: 'VEC4',
        count: 1,
        normalized: true,
        data: new Uint16Array([65535, 65535, 65535, 65535]),
      },
      { componentType: 5126, type: 'VEC3', count: 1, data: new Float32Array([1, 2, 3]) },
      { componentType: 5126, type: 'VEC3', count: 1, data: new Float32Array([0, 1, 0]) },
      { componentType: 5126, type: 'VEC2', count: 1, data: new Float32Array([0.25, 0.75]) },
    ]);
    const mesh = mapPrimitiveToMesh(document, buffers, {
      attributes: { COLOR_0: 0, POSITION: 1, NORMAL: 2, TEXCOORD_0: 3 },
    });

    const order = [...mesh.iterAttributes()].map((a) => a.attribute);
    expect(order[0]).toBe(MeshAttribute.POSITION);
    expect(order[1]).toBe(MeshAttribute.NORMAL);
    expect(order[2]).toBe(MeshAttribute.UV_0);
    expect(order[3]).toBe(MeshAttribute.COLOR);
  });

  it('carries normalized u16 COLOR_0 through as expanded floats', () => {
    const { document, buffers } = buildDoc([
      { componentType: 5126, type: 'VEC3', count: 2, data: new Float32Array([0, 0, 0, 1, 1, 1]) },
      {
        componentType: 5123,
        type: 'VEC4',
        count: 2,
        normalized: true,
        data: new Uint16Array([0, 65535, 0, 65535, 65535, 0, 0, 65535]),
      },
    ]);
    const mesh = mapPrimitiveToMesh(document, buffers, { attributes: { POSITION: 0, COLOR_0: 1 } });

    const color = mesh.getAttribute(MeshAttribute.COLOR)!.data;
    expect(color).toBeInstanceOf(Float32Array);
    expect(Array.from(color)).toEqual([0, 1, 0, 1, 1, 0, 0, 1]);
  });

  it('expands a VEC3 COLOR_0 to VEC4 with opaque alpha', () => {
    const { document, buffers } = buildDoc([
      { componentType: 5126, type: 'VEC3', count: 1, data: new Float32Array([0, 0, 0]) },
      {
        componentType: 5121,
        type: 'VEC3',
        count: 1,
        normalized: true,
        data: new Uint8Array([255, 0, 128]),
      },
    ]);
    const mesh = mapPrimitiveToMesh(document, buffers, { attributes: { POSITION: 0, COLOR_0: 1 } });

    const color = Array.from(mesh.getAttribute(MeshAttribute.COLOR)!.data);
    expect(color[0]).toBe(1);
    expect(color[1]).toBe(0);
    expect(color[3]).toBe(1); // appended opaque alpha
    expect(color).toHaveLength(4);
  });

  it('skips deferred attributes without decoding them', () => {
    const { document, buffers } = buildDoc([
      { componentType: 5126, type: 'VEC3', count: 1, data: new Float32Array([0, 0, 0]) },
    ]);
    // TEXCOORD_1 is still deferred; it points at a non-existent accessor, so if it
    // were decoded instead of skipped, mapPrimitiveToMesh would throw.
    const mesh = mapPrimitiveToMesh(document, buffers, {
      attributes: { POSITION: 0, TEXCOORD_1: 9 },
    });
    expect(mesh.attributeCount).toBe(1);
    expect(mesh.hasAttribute(MeshAttribute.POSITION)).toBe(true);
  });

  it('maps JOINTS_0 / WEIGHTS_0 to skinning attributes, widening byte joints to u16', () => {
    const { document, buffers } = buildDoc([
      { componentType: 5126, type: 'VEC3', count: 2, data: new Float32Array([0, 0, 0, 1, 1, 1]) },
      // JOINTS_0 as UNSIGNED_BYTE VEC4 — must widen to Uint16Array, values preserved.
      { componentType: 5121, type: 'VEC4', count: 2, data: new Uint8Array([0, 1, 2, 3, 4, 0, 0, 0]) },
      {
        componentType: 5126,
        type: 'VEC4',
        count: 2,
        data: new Float32Array([0.5, 0.5, 0, 0, 1, 0, 0, 0]),
      },
    ]);
    const mesh = mapPrimitiveToMesh(document, buffers, {
      attributes: { POSITION: 0, JOINTS_0: 1, WEIGHTS_0: 2 },
    });
    expect(mesh.hasAttribute(MeshAttribute.JOINT_INDEX)).toBe(true);
    expect(mesh.hasAttribute(MeshAttribute.JOINT_WEIGHT)).toBe(true);
    const joints = mesh.getAttribute(MeshAttribute.JOINT_INDEX)!.data;
    expect(joints).toBeInstanceOf(Uint16Array);
    expect(Array.from(joints)).toEqual([0, 1, 2, 3, 4, 0, 0, 0]);
    const weights = mesh.getAttribute(MeshAttribute.JOINT_WEIGHT)!.data;
    expect(weights).toBeInstanceOf(Float32Array);
    expect(Array.from(weights)).toEqual([0.5, 0.5, 0, 0, 1, 0, 0, 0]);
  });

  it('keeps joint indices at shader locations 3/4 ahead of TANGENT', () => {
    const { document, buffers } = buildDoc([
      { componentType: 5126, type: 'VEC3', count: 1, data: new Float32Array([0, 0, 0]) },
      { componentType: 5126, type: 'VEC3', count: 1, data: new Float32Array([0, 1, 0]) },
      { componentType: 5126, type: 'VEC2', count: 1, data: new Float32Array([0, 0]) },
      { componentType: 5123, type: 'VEC4', count: 1, data: new Uint16Array([0, 0, 0, 0]) },
      { componentType: 5126, type: 'VEC4', count: 1, data: new Float32Array([1, 0, 0, 0]) },
      { componentType: 5126, type: 'VEC4', count: 1, data: new Float32Array([1, 0, 0, 1]) },
    ]);
    const mesh = mapPrimitiveToMesh(document, buffers, {
      attributes: { COLOR_0: 5, TANGENT: 5, WEIGHTS_0: 4, JOINTS_0: 3, NORMAL: 1, POSITION: 0, TEXCOORD_0: 2 },
    });
    const order = [...mesh.iterAttributes()].map((a) => a.attribute);
    expect(order[0]).toBe(MeshAttribute.POSITION);
    expect(order[1]).toBe(MeshAttribute.NORMAL);
    expect(order[2]).toBe(MeshAttribute.UV_0);
    expect(order[3]).toBe(MeshAttribute.JOINT_INDEX);
    expect(order[4]).toBe(MeshAttribute.JOINT_WEIGHT);
    expect(order[5]).toBe(MeshAttribute.TANGENT);
  });
});

describe('mapPrimitiveToMesh — indices', () => {
  const posDoc = (): AccessorEntry => ({
    componentType: 5126,
    type: 'VEC3',
    count: 3,
    data: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  });

  it('promotes u8 indices to u16', () => {
    const { document, buffers } = buildDoc([
      posDoc(),
      { componentType: 5121, type: 'SCALAR', count: 3, data: new Uint8Array([0, 1, 2]) },
    ]);
    const mesh = mapPrimitiveToMesh(document, buffers, { attributes: { POSITION: 0 }, indices: 1 });
    expect(mesh.indices?.kind).toBe('u16');
    expect(mesh.indices?.data).toBeInstanceOf(Uint16Array);
    expect(Array.from(mesh.indices!.data)).toEqual([0, 1, 2]);
  });

  it('keeps u16 and u32 indices', () => {
    const u16 = buildDoc([
      posDoc(),
      { componentType: 5123, type: 'SCALAR', count: 3, data: new Uint16Array([0, 1, 2]) },
    ]);
    expect(
      mapPrimitiveToMesh(u16.document, u16.buffers, { attributes: { POSITION: 0 }, indices: 1 })
        .indices?.kind,
    ).toBe('u16');

    const u32 = buildDoc([
      posDoc(),
      { componentType: 5125, type: 'SCALAR', count: 3, data: new Uint32Array([0, 1, 2]) },
    ]);
    expect(
      mapPrimitiveToMesh(u32.document, u32.buffers, { attributes: { POSITION: 0 }, indices: 1 })
        .indices?.kind,
    ).toBe('u32');
  });
});
