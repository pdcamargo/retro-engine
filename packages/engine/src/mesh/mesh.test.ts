import { describe, expect, it } from 'bun:test';

import { Mesh } from './mesh';
import { u16Indices, u32Indices } from './indices';
import { MeshAttribute } from './vertex-attribute';

describe('Mesh', () => {
  it('defaults to triangle-list topology and zero attributes / no indices', () => {
    const mesh = new Mesh();
    expect(mesh.primitiveTopology).toBe('triangle-list');
    expect(mesh.attributeCount).toBe(0);
    expect(mesh.indices).toBeUndefined();
    expect(mesh.vertexCount).toBe(0);
  });

  it('inserts and reads back an attribute with the expected vertex count', () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const mesh = new Mesh().insertAttribute(MeshAttribute.POSITION, positions);
    expect(mesh.attributeCount).toBe(1);
    expect(mesh.hasAttribute(MeshAttribute.POSITION)).toBe(true);
    expect(mesh.hasAttribute(MeshAttribute.NORMAL)).toBe(false);
    expect(mesh.vertexCount).toBe(3);
    expect(mesh.getAttribute(MeshAttribute.POSITION)?.data).toBe(positions);
  });

  it('replaces an attribute on second insert (same slot)', () => {
    const a = new Float32Array([0, 0, 0]);
    const b = new Float32Array([1, 1, 1]);
    const mesh = new Mesh()
      .insertAttribute(MeshAttribute.POSITION, a)
      .insertAttribute(MeshAttribute.POSITION, b);
    expect(mesh.attributeCount).toBe(1);
    expect(mesh.getAttribute(MeshAttribute.POSITION)?.data).toBe(b);
  });

  it('checkConsistency throws when attributes disagree on vertex count', () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0]); // 2 vertices
    const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]); // 3 vertices
    const mesh = new Mesh()
      .insertAttribute(MeshAttribute.POSITION, positions)
      .insertAttribute(MeshAttribute.NORMAL, normals);
    expect(() => mesh.checkConsistency()).toThrow(/has 3 vertices/);
  });

  it('checkConsistency passes for a single-attribute mesh', () => {
    const mesh = new Mesh().insertAttribute(MeshAttribute.POSITION, new Float32Array(9));
    expect(() => mesh.checkConsistency()).not.toThrow();
  });

  it('round-trips u16 and u32 indices', () => {
    const u16 = new Mesh().setIndices(u16Indices([0, 1, 2]));
    expect(u16.indices?.kind).toBe('u16');
    expect(u16.indices?.data).toBeInstanceOf(Uint16Array);
    const u32 = new Mesh().setIndices(u32Indices([0, 1, 2, 3, 4, 5]));
    expect(u32.indices?.kind).toBe('u32');
    expect(u32.indices?.data).toBeInstanceOf(Uint32Array);
  });

  it('setIndices(undefined) drops the index buffer', () => {
    const mesh = new Mesh().setIndices(u32Indices([0, 1, 2])).setIndices(undefined);
    expect(mesh.indices).toBeUndefined();
  });

  it('computeAabb produces a zero AABB when no positions are present', () => {
    const aabb = new Mesh().computeAabb();
    expect(aabb.center[0]).toBe(0);
    expect(aabb.halfExtents[0]).toBe(0);
  });

  it('computeAabb produces the tight bounds of the position attribute', () => {
    const positions = new Float32Array([-2, -3, -4, 6, 7, 8]);
    const aabb = new Mesh().insertAttribute(MeshAttribute.POSITION, positions).computeAabb();
    expect(aabb.center[0]).toBe(2);
    expect(aabb.center[1]).toBe(2);
    expect(aabb.center[2]).toBe(2);
    expect(aabb.halfExtents[0]).toBe(4);
    expect(aabb.halfExtents[1]).toBe(5);
    expect(aabb.halfExtents[2]).toBe(6);
  });

  it('computeFlatNormals writes face normals for an indexed triangle on the XY plane', () => {
    const mesh = new Mesh()
      .insertAttribute(MeshAttribute.POSITION, new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
      .setIndices(u32Indices([0, 1, 2]))
      .computeFlatNormals();
    const normals = mesh.getAttribute(MeshAttribute.NORMAL)!.data as Float32Array;
    for (let v = 0; v < 3; v++) {
      expect(normals[v * 3]).toBeCloseTo(0);
      expect(normals[v * 3 + 1]).toBeCloseTo(0);
      expect(normals[v * 3 + 2]).toBeCloseTo(1);
    }
  });

  it('computeSmoothNormals area-averages and unit-length normals across shared vertices', () => {
    // Two triangles in the XY plane sharing one edge — every vertex's normal
    // is (0, 0, 1) regardless of weighting.
    const mesh = new Mesh()
      .insertAttribute(MeshAttribute.POSITION, new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]))
      .setIndices(u32Indices([0, 1, 2, 1, 3, 2]))
      .computeSmoothNormals();
    const normals = mesh.getAttribute(MeshAttribute.NORMAL)!.data as Float32Array;
    for (let v = 0; v < 4; v++) {
      expect(normals[v * 3]).toBeCloseTo(0);
      expect(normals[v * 3 + 1]).toBeCloseTo(0);
      expect(normals[v * 3 + 2]).toBeCloseTo(1);
    }
  });

  it('computeFlatNormals throws without positions or indices', () => {
    const noPositions = new Mesh().setIndices(u32Indices([0, 1, 2]));
    expect(() => noPositions.computeFlatNormals()).toThrow();
    const noIndices = new Mesh().insertAttribute(
      MeshAttribute.POSITION,
      new Float32Array([0, 0, 0]),
    );
    expect(() => noIndices.computeFlatNormals()).toThrow();
  });
});
