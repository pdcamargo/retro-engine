import { describe, expect, it } from 'bun:test';

import {
  Annulus,
  Capsule3d,
  Circle,
  Cone,
  ConicalFrustum,
  Cuboid,
  Cylinder,
  Ellipse,
  Plane3d,
  Rectangle,
  RegularPolygon,
  Sphere,
  Tetrahedron,
  Torus,
  Triangle,
} from './primitives';
import { MeshAttribute } from './vertex-attribute';
import type { Mesh } from './mesh';

const positionsOf = (mesh: Mesh): Float32Array =>
  mesh.getAttribute(MeshAttribute.POSITION)!.data as Float32Array;

const indexCountOf = (mesh: Mesh): number => {
  const i = mesh.indices;
  if (!i) throw new Error('mesh has no indices');
  return i.data.length;
};

describe('3D primitives', () => {
  it('Cuboid: 24 vertices (6 faces × 4) + 36 indices, POSITION/NORMAL/UV_0', () => {
    const mesh = new Cuboid().mesh().build();
    expect(mesh.vertexCount).toBe(24);
    expect(indexCountOf(mesh)).toBe(36);
    expect(mesh.hasAttribute(MeshAttribute.POSITION)).toBe(true);
    expect(mesh.hasAttribute(MeshAttribute.NORMAL)).toBe(true);
    expect(mesh.hasAttribute(MeshAttribute.UV_0)).toBe(true);
  });

  it('Sphere(ico, 0 subdivisions): 12 vertices (icosahedron), 20 faces × 3 indices', () => {
    const mesh = new Sphere().mesh().ico(0).build();
    expect(mesh.vertexCount).toBe(12);
    expect(indexCountOf(mesh)).toBe(60);
  });

  it('Sphere(uv): (stacks+1)(sectors+1) vertices, sectors * stacks * 6 indices', () => {
    const mesh = new Sphere().mesh().uv(8, 4).build();
    expect(mesh.vertexCount).toBe(5 * 9);
    expect(indexCountOf(mesh)).toBe(8 * 4 * 6);
  });

  it('Cylinder default: produces a valid AABB roughly matching radius/height', () => {
    const mesh = new Cylinder().mesh().resolution(8).build();
    const aabb = mesh.computeAabb();
    expect(aabb.halfExtents[0]).toBeCloseTo(0.5);
    expect(aabb.halfExtents[1]).toBeCloseTo(0.5);
    expect(aabb.halfExtents[2]).toBeCloseTo(0.5);
  });

  it('Capsule3d: bounds spans (radius + halfLength) along the Y axis', () => {
    const mesh = new Capsule3d({ radius: 0.25, halfLength: 0.5 }).mesh().longitudes(8).latitudes(4).build();
    const aabb = mesh.computeAabb();
    expect(aabb.halfExtents[1]).toBeCloseTo(0.75, 2);
  });

  it('Torus default: bounds span majorRadius + minorRadius on the XZ plane', () => {
    const mesh = new Torus().mesh().majorResolution(8).minorResolution(4).build();
    const aabb = mesh.computeAabb();
    expect(aabb.halfExtents[0]).toBeCloseTo(1.25);
    expect(aabb.halfExtents[2]).toBeCloseTo(1.25);
  });

  it('Plane3d default: 4 vertices, 6 indices, all normals point +Y', () => {
    const mesh = new Plane3d().mesh().build();
    expect(mesh.vertexCount).toBe(4);
    expect(indexCountOf(mesh)).toBe(6);
    const normals = mesh.getAttribute(MeshAttribute.NORMAL)!.data as Float32Array;
    for (let i = 0; i < 4; i++) {
      expect(normals[i * 3]).toBe(0);
      expect(normals[i * 3 + 1]).toBe(1);
      expect(normals[i * 3 + 2]).toBe(0);
    }
  });

  it('Cone: triangular sides + base cap', () => {
    const mesh = new Cone().mesh().resolution(8).build();
    expect(mesh.vertexCount).toBe(8 * 3 + 1 + 9);
    expect(indexCountOf(mesh)).toBe(8 * 3 + 8 * 3);
  });

  it('Tetrahedron: 12 vertices (4 faces × 3, duplicated for flat normals), 12 indices', () => {
    const mesh = new Tetrahedron().mesh().build();
    expect(mesh.vertexCount).toBe(12);
    expect(indexCountOf(mesh)).toBe(12);
  });

  it('ConicalFrustum: degenerates to a cylinder when radii match', () => {
    const mesh = new ConicalFrustum({ radiusTop: 0.5, radiusBottom: 0.5, height: 1 })
      .mesh()
      .resolution(8)
      .build();
    const aabb = mesh.computeAabb();
    expect(aabb.halfExtents[0]).toBeCloseTo(0.5);
    expect(aabb.halfExtents[1]).toBeCloseTo(0.5);
    expect(aabb.halfExtents[2]).toBeCloseTo(0.5);
  });
});

describe('2D primitives', () => {
  it('Rectangle: 4 vertices, 6 indices, normal (0,0,1)', () => {
    const mesh = new Rectangle().mesh().build();
    expect(mesh.vertexCount).toBe(4);
    expect(indexCountOf(mesh)).toBe(6);
    const normals = mesh.getAttribute(MeshAttribute.NORMAL)!.data as Float32Array;
    expect(normals[2]).toBe(1);
  });

  it('Circle: centre + (resolution + 1) ring vertices', () => {
    const mesh = new Circle().mesh().resolution(16).build();
    expect(mesh.vertexCount).toBe(1 + 17);
    expect(indexCountOf(mesh)).toBe(16 * 3);
  });

  it('Annulus: 2 * (resolution + 1) vertices, resolution * 6 indices', () => {
    const mesh = new Annulus().mesh().resolution(16).build();
    expect(mesh.vertexCount).toBe(2 * 17);
    expect(indexCountOf(mesh)).toBe(16 * 6);
  });

  it('RegularPolygon: 1 centre + N corner vertices, N triangle indices', () => {
    const mesh = new RegularPolygon({ sides: 5 }).mesh().build();
    expect(mesh.vertexCount).toBe(6);
    expect(indexCountOf(mesh)).toBe(15);
  });

  it('RegularPolygon: minimum sides clamped to 3', () => {
    const mesh = new RegularPolygon({ sides: 2 }).mesh().build();
    expect(mesh.vertexCount).toBe(4); // centre + 3 corners
  });

  it('Triangle default: 3 vertices, 3 indices, all on the XY plane', () => {
    const mesh = new Triangle().mesh().build();
    expect(mesh.vertexCount).toBe(3);
    expect(indexCountOf(mesh)).toBe(3);
    const positions = positionsOf(mesh);
    expect(positions[2]).toBe(0);
    expect(positions[5]).toBe(0);
    expect(positions[8]).toBe(0);
  });

  it('Ellipse: bounds span (halfWidth, halfHeight)', () => {
    const mesh = new Ellipse({ halfWidth: 0.7, halfHeight: 0.3 }).mesh().resolution(16).build();
    const aabb = mesh.computeAabb();
    expect(aabb.halfExtents[0]).toBeCloseTo(0.7);
    expect(aabb.halfExtents[1]).toBeCloseTo(0.3);
  });
});
