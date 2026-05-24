import { Mesh } from '../../mesh';
import { u32Indices } from '../../indices';
import { MeshAttribute } from '../../vertex-attribute';
import type { Meshable, MeshBuilder } from '../meshable';

/**
 * 2D circle (filled disk) on the XY plane (normal `(0, 0, 1)`), centred at the
 * origin.
 */
export class Circle implements Meshable<CircleMeshBuilder> {
  readonly radius: number;

  constructor(options?: { radius?: number }) {
    this.radius = options?.radius ?? 0.5;
  }

  mesh(): CircleMeshBuilder {
    return new CircleMeshBuilder(this);
  }
}

export class CircleMeshBuilder implements MeshBuilder {
  private resolutionValue = 32;

  constructor(private readonly circle: Circle) {}

  /** Number of segments around the circumference. Default 32. */
  resolution(n: number): this {
    this.resolutionValue = n;
    return this;
  }

  build(): Mesh {
    const r = this.circle.radius;
    const res = this.resolutionValue;
    // Centre + (res + 1) ring vertices (last one duplicates the seam UV).
    const total = 1 + (res + 1);
    const positions = new Float32Array(total * 3);
    const normals = new Float32Array(total * 3);
    const uvs = new Float32Array(total * 2);
    positions[0] = 0;
    positions[1] = 0;
    positions[2] = 0;
    normals[0] = 0;
    normals[1] = 0;
    normals[2] = 1;
    uvs[0] = 0.5;
    uvs[1] = 0.5;
    for (let i = 0; i <= res; i++) {
      const theta = (i / res) * Math.PI * 2;
      const c = Math.cos(theta);
      const s = Math.sin(theta);
      const v = i + 1;
      positions[v * 3] = c * r;
      positions[v * 3 + 1] = s * r;
      positions[v * 3 + 2] = 0;
      normals[v * 3] = 0;
      normals[v * 3 + 1] = 0;
      normals[v * 3 + 2] = 1;
      uvs[v * 2] = c * 0.5 + 0.5;
      uvs[v * 2 + 1] = s * 0.5 + 0.5;
    }
    const indices: number[] = [];
    for (let i = 0; i < res; i++) {
      indices.push(0, i + 1, i + 2);
    }
    return new Mesh({ label: 'Circle' })
      .insertAttribute(MeshAttribute.POSITION, positions)
      .insertAttribute(MeshAttribute.NORMAL, normals)
      .insertAttribute(MeshAttribute.UV_0, uvs)
      .setIndices(u32Indices(new Uint32Array(indices)));
  }
}
