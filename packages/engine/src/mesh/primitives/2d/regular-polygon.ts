import { Mesh } from '../../mesh';
import { u32Indices } from '../../indices';
import { MeshAttribute } from '../../vertex-attribute';
import type { Meshable, MeshBuilder } from '../meshable';

/**
 * Regular polygon — `sides`-sided shape on the XY plane (normal `(0, 0, 1)`),
 * inscribed in a circle of radius `circumradius`.
 *
 * `sides` must be `>= 3`.
 */
export class RegularPolygon implements Meshable<RegularPolygonMeshBuilder> {
  readonly circumradius: number;
  readonly sides: number;

  constructor(options?: { circumradius?: number; sides?: number }) {
    this.circumradius = options?.circumradius ?? 0.5;
    this.sides = Math.max(3, options?.sides ?? 6);
  }

  mesh(): RegularPolygonMeshBuilder {
    return new RegularPolygonMeshBuilder(this);
  }
}

export class RegularPolygonMeshBuilder implements MeshBuilder {
  constructor(private readonly polygon: RegularPolygon) {}

  build(): Mesh {
    const r = this.polygon.circumradius;
    const sides = this.polygon.sides;
    const total = 1 + sides; // centre + N corners
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
    for (let i = 0; i < sides; i++) {
      // Rotate so the first vertex points up (+Y).
      const theta = (i / sides) * Math.PI * 2 + Math.PI / 2;
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
    for (let i = 0; i < sides; i++) {
      const a = i + 1;
      const b = ((i + 1) % sides) + 1;
      indices.push(0, a, b);
    }
    return new Mesh({ label: 'RegularPolygon' })
      .insertAttribute(MeshAttribute.POSITION, positions)
      .insertAttribute(MeshAttribute.NORMAL, normals)
      .insertAttribute(MeshAttribute.UV_0, uvs)
      .setIndices(u32Indices(new Uint32Array(indices)));
  }
}
