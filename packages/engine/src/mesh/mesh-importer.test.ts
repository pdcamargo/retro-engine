import { describe, expect, it } from 'bun:test';

import { u16Indices } from './indices';
import { MESH_FORMAT_VERSION, createMeshSerializer } from './mesh-importer';
import { Mesh } from './mesh';
import { MeshAttribute } from './vertex-attribute';

const cube = (): Mesh =>
  new Mesh({ label: 'cube' })
    .insertAttribute(
      MeshAttribute.POSITION,
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]),
    )
    .insertAttribute(MeshAttribute.NORMAL, new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]))
    .insertAttribute(MeshAttribute.UV_0, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]))
    .setIndices(u16Indices([0, 1, 2, 1, 3, 2]));

describe('mesh serializer round-trip', () => {
  it('round-trips attributes (in order), indices, topology, and label', () => {
    const codec = createMeshSerializer();
    const restored = codec.deserialize(codec.serialize(cube()));

    expect(restored).toBeInstanceOf(Mesh);
    expect(restored.label).toBe('cube');
    expect(restored.primitiveTopology).toBe('triangle-list');

    // Attribute order preserved: POSITION, NORMAL, UV_0.
    const ids = [...restored.iterAttributes()].map((a) => a.attribute.id);
    expect(ids).toEqual([MeshAttribute.POSITION.id, MeshAttribute.NORMAL.id, MeshAttribute.UV_0.id]);

    // POSITION bytes survive exactly, as a Float32Array.
    const pos = restored.getAttribute(MeshAttribute.POSITION)!;
    expect(pos.data).toBeInstanceOf(Float32Array);
    expect(Array.from(pos.data)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]);

    // Indices survive with their width.
    expect(restored.indices?.kind).toBe('u16');
    expect(Array.from(restored.indices!.data)).toEqual([0, 1, 2, 1, 3, 2]);
  });

  it('serialize ∘ deserialize is byte-stable', () => {
    const codec = createMeshSerializer();
    const once = codec.serialize(cube());
    const twice = codec.serialize(codec.deserialize(once));
    expect(new TextDecoder().decode(twice)).toBe(new TextDecoder().decode(once));
  });

  it('rejects a future format version', () => {
    const codec = createMeshSerializer();
    const bytes = new TextEncoder().encode(
      JSON.stringify({ version: MESH_FORMAT_VERSION + 1, primitiveTopology: 'triangle-list', attributes: [] }),
    );
    expect(() => codec.deserialize(bytes)).toThrow(/unsupported format version/);
  });
});
