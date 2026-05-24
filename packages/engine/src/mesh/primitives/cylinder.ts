import { Mesh } from '../mesh';
import { u32Indices } from '../indices';
import { MeshAttribute } from '../vertex-attribute';
import type { Meshable, MeshBuilder } from './meshable';

/**
 * Right-circular cylinder. Axis is the Y axis; centred at the origin.
 *
 * `radius` defaults to 0.5; `height` defaults to 1 (top cap at y = 0.5,
 * bottom cap at y = -0.5).
 */
export class Cylinder implements Meshable<CylinderMeshBuilder> {
  readonly radius: number;
  readonly height: number;

  constructor(options?: { radius?: number; height?: number }) {
    this.radius = options?.radius ?? 0.5;
    this.height = options?.height ?? 1;
  }

  mesh(): CylinderMeshBuilder {
    return new CylinderMeshBuilder(this);
  }
}

export class CylinderMeshBuilder implements MeshBuilder {
  private resolutionValue = 32;

  constructor(private readonly cylinder: Cylinder) {}

  /** Number of radial segments around the cylinder. Default 32. */
  resolution(n: number): this {
    this.resolutionValue = n;
    return this;
  }

  build(): Mesh {
    const r = this.cylinder.radius;
    const halfH = this.cylinder.height / 2;
    const res = this.resolutionValue;
    // 2 * (res + 1) for side, plus 2 * (res + 1) for caps centred on a fan vertex.
    const sideVerts = (res + 1) * 2;
    const capVerts = (res + 2) * 2; // top centre + ring + bottom centre + ring
    const total = sideVerts + capVerts;
    const positions = new Float32Array(total * 3);
    const normals = new Float32Array(total * 3);
    const uvs = new Float32Array(total * 2);
    let pi = 0;
    let ni = 0;
    let ui = 0;
    // Side ring vertices: bottom then top, repeated for each segment + 1 (UV seam).
    for (let i = 0; i <= res; i++) {
      const u = i / res;
      const theta = u * Math.PI * 2;
      const cx = Math.cos(theta);
      const cz = Math.sin(theta);
      // Bottom.
      positions[pi++] = cx * r;
      positions[pi++] = -halfH;
      positions[pi++] = cz * r;
      normals[ni++] = cx;
      normals[ni++] = 0;
      normals[ni++] = cz;
      uvs[ui++] = u;
      uvs[ui++] = 1;
      // Top.
      positions[pi++] = cx * r;
      positions[pi++] = halfH;
      positions[pi++] = cz * r;
      normals[ni++] = cx;
      normals[ni++] = 0;
      normals[ni++] = cz;
      uvs[ui++] = u;
      uvs[ui++] = 0;
    }
    const indices: number[] = [];
    for (let i = 0; i < res; i++) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, b, c, b, d, c);
    }
    // Top cap.
    const topCentreIdx = sideVerts;
    positions[pi++] = 0;
    positions[pi++] = halfH;
    positions[pi++] = 0;
    normals[ni++] = 0;
    normals[ni++] = 1;
    normals[ni++] = 0;
    uvs[ui++] = 0.5;
    uvs[ui++] = 0.5;
    const topRingStart = sideVerts + 1;
    for (let i = 0; i <= res; i++) {
      const u = i / res;
      const theta = u * Math.PI * 2;
      const cx = Math.cos(theta);
      const cz = Math.sin(theta);
      positions[pi++] = cx * r;
      positions[pi++] = halfH;
      positions[pi++] = cz * r;
      normals[ni++] = 0;
      normals[ni++] = 1;
      normals[ni++] = 0;
      uvs[ui++] = cx * 0.5 + 0.5;
      uvs[ui++] = cz * 0.5 + 0.5;
    }
    for (let i = 0; i < res; i++) {
      indices.push(topCentreIdx, topRingStart + i + 1, topRingStart + i);
    }
    // Bottom cap.
    const bottomCentreIdx = topRingStart + res + 1;
    positions[pi++] = 0;
    positions[pi++] = -halfH;
    positions[pi++] = 0;
    normals[ni++] = 0;
    normals[ni++] = -1;
    normals[ni++] = 0;
    uvs[ui++] = 0.5;
    uvs[ui++] = 0.5;
    const bottomRingStart = bottomCentreIdx + 1;
    for (let i = 0; i <= res; i++) {
      const u = i / res;
      const theta = u * Math.PI * 2;
      const cx = Math.cos(theta);
      const cz = Math.sin(theta);
      positions[pi++] = cx * r;
      positions[pi++] = -halfH;
      positions[pi++] = cz * r;
      normals[ni++] = 0;
      normals[ni++] = -1;
      normals[ni++] = 0;
      uvs[ui++] = cx * 0.5 + 0.5;
      uvs[ui++] = cz * 0.5 + 0.5;
    }
    for (let i = 0; i < res; i++) {
      indices.push(bottomCentreIdx, bottomRingStart + i, bottomRingStart + i + 1);
    }
    return new Mesh({ label: 'Cylinder' })
      .insertAttribute(MeshAttribute.POSITION, positions)
      .insertAttribute(MeshAttribute.NORMAL, normals)
      .insertAttribute(MeshAttribute.UV_0, uvs)
      .setIndices(u32Indices(new Uint32Array(indices)));
  }
}
