import { Mesh } from '../mesh';
import { u32Indices } from '../indices';
import { MeshAttribute } from '../vertex-attribute';
import type { Meshable, MeshBuilder } from './meshable';

/**
 * Right-circular cone with apex up the +Y axis. `radius` is the base radius;
 * `height` is the apex-to-base distance. The base sits at `y = -height/2`,
 * apex at `y = height/2`.
 */
export class Cone implements Meshable<ConeMeshBuilder> {
  readonly radius: number;
  readonly height: number;

  constructor(options?: { radius?: number; height?: number }) {
    this.radius = options?.radius ?? 0.5;
    this.height = options?.height ?? 1;
  }

  mesh(): ConeMeshBuilder {
    return new ConeMeshBuilder(this);
  }
}

export class ConeMeshBuilder implements MeshBuilder {
  private resolutionValue = 32;

  constructor(private readonly cone: Cone) {}

  /** Number of radial segments. Default 32. */
  resolution(n: number): this {
    this.resolutionValue = n;
    return this;
  }

  build(): Mesh {
    const r = this.cone.radius;
    const halfH = this.cone.height / 2;
    const res = this.resolutionValue;
    // Side: per-segment apex + base (apex duplicated per segment for correct normals).
    // Base: centre + ring.
    const sideVerts = res * 3;
    const baseVerts = 1 + (res + 1);
    const total = sideVerts + baseVerts;
    const positions = new Float32Array(total * 3);
    const normals = new Float32Array(total * 3);
    const uvs = new Float32Array(total * 2);
    let p = 0;
    let n = 0;
    let u = 0;
    // Side triangles — one triangle per segment, with face-correct normals.
    const slant = Math.hypot(r, this.cone.height) || 1;
    const ny = r / slant; // normal Y component (constant for all side normals).
    const nrFactor = this.cone.height / slant;
    for (let i = 0; i < res; i++) {
      const theta0 = (i / res) * Math.PI * 2;
      const theta1 = ((i + 1) / res) * Math.PI * 2;
      const c0 = Math.cos(theta0);
      const s0 = Math.sin(theta0);
      const c1 = Math.cos(theta1);
      const s1 = Math.sin(theta1);
      // Mid-segment angle for the face normal.
      const mc = Math.cos((theta0 + theta1) / 2);
      const ms = Math.sin((theta0 + theta1) / 2);
      // Apex.
      positions[p++] = 0;
      positions[p++] = halfH;
      positions[p++] = 0;
      // Base-left.
      positions[p++] = c0 * r;
      positions[p++] = -halfH;
      positions[p++] = s0 * r;
      // Base-right.
      positions[p++] = c1 * r;
      positions[p++] = -halfH;
      positions[p++] = s1 * r;
      for (let k = 0; k < 3; k++) {
        normals[n++] = mc * nrFactor;
        normals[n++] = ny;
        normals[n++] = ms * nrFactor;
      }
      uvs[u++] = (i + 0.5) / res;
      uvs[u++] = 0;
      uvs[u++] = i / res;
      uvs[u++] = 1;
      uvs[u++] = (i + 1) / res;
      uvs[u++] = 1;
    }
    const indices: number[] = [];
    for (let i = 0; i < res; i++) {
      const base = i * 3;
      indices.push(base, base + 2, base + 1);
    }
    // Base cap.
    const baseCentreIdx = sideVerts;
    positions[p++] = 0;
    positions[p++] = -halfH;
    positions[p++] = 0;
    normals[n++] = 0;
    normals[n++] = -1;
    normals[n++] = 0;
    uvs[u++] = 0.5;
    uvs[u++] = 0.5;
    const baseRingStart = baseCentreIdx + 1;
    for (let i = 0; i <= res; i++) {
      const theta = (i / res) * Math.PI * 2;
      const cx = Math.cos(theta);
      const cz = Math.sin(theta);
      positions[p++] = cx * r;
      positions[p++] = -halfH;
      positions[p++] = cz * r;
      normals[n++] = 0;
      normals[n++] = -1;
      normals[n++] = 0;
      uvs[u++] = cx * 0.5 + 0.5;
      uvs[u++] = cz * 0.5 + 0.5;
    }
    for (let i = 0; i < res; i++) {
      indices.push(baseCentreIdx, baseRingStart + i, baseRingStart + i + 1);
    }
    return new Mesh({ label: 'Cone' })
      .insertAttribute(MeshAttribute.POSITION, positions)
      .insertAttribute(MeshAttribute.NORMAL, normals)
      .insertAttribute(MeshAttribute.UV_0, uvs)
      .setIndices(u32Indices(new Uint32Array(indices)));
  }
}
