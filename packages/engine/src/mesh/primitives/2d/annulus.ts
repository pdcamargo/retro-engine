import { Mesh } from '../../mesh';
import { u32Indices } from '../../indices';
import { MeshAttribute } from '../../vertex-attribute';
import type { Meshable, MeshBuilder } from '../meshable';

/**
 * 2D annulus — flat ring between `innerRadius` and `outerRadius` on the XY
 * plane (normal `(0, 0, 1)`), centred at the origin.
 */
export class Annulus implements Meshable<AnnulusMeshBuilder> {
  readonly innerRadius: number;
  readonly outerRadius: number;

  constructor(options?: { innerRadius?: number; outerRadius?: number }) {
    this.innerRadius = options?.innerRadius ?? 0.25;
    this.outerRadius = options?.outerRadius ?? 0.5;
  }

  mesh(): AnnulusMeshBuilder {
    return new AnnulusMeshBuilder(this);
  }
}

export class AnnulusMeshBuilder implements MeshBuilder {
  private resolutionValue = 32;

  constructor(private readonly annulus: Annulus) {}

  /** Segments around the ring. Default 32. */
  resolution(n: number): this {
    this.resolutionValue = n;
    return this;
  }

  build(): Mesh {
    const ri = this.annulus.innerRadius;
    const ro = this.annulus.outerRadius;
    const res = this.resolutionValue;
    const total = (res + 1) * 2;
    const positions = new Float32Array(total * 3);
    const normals = new Float32Array(total * 3);
    const uvs = new Float32Array(total * 2);
    for (let i = 0; i <= res; i++) {
      const theta = (i / res) * Math.PI * 2;
      const c = Math.cos(theta);
      const s = Math.sin(theta);
      const ai = i * 2;
      const bi = ai + 1;
      // Inner.
      positions[ai * 3] = c * ri;
      positions[ai * 3 + 1] = s * ri;
      positions[ai * 3 + 2] = 0;
      normals[ai * 3] = 0;
      normals[ai * 3 + 1] = 0;
      normals[ai * 3 + 2] = 1;
      uvs[ai * 2] = c * (ri / ro) * 0.5 + 0.5;
      uvs[ai * 2 + 1] = s * (ri / ro) * 0.5 + 0.5;
      // Outer.
      positions[bi * 3] = c * ro;
      positions[bi * 3 + 1] = s * ro;
      positions[bi * 3 + 2] = 0;
      normals[bi * 3] = 0;
      normals[bi * 3 + 1] = 0;
      normals[bi * 3 + 2] = 1;
      uvs[bi * 2] = c * 0.5 + 0.5;
      uvs[bi * 2 + 1] = s * 0.5 + 0.5;
    }
    const indices: number[] = [];
    for (let i = 0; i < res; i++) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, b, c, c, b, d);
    }
    return new Mesh({ label: 'Annulus' })
      .insertAttribute(MeshAttribute.POSITION, positions)
      .insertAttribute(MeshAttribute.NORMAL, normals)
      .insertAttribute(MeshAttribute.UV_0, uvs)
      .setIndices(u32Indices(new Uint32Array(indices)));
  }
}
