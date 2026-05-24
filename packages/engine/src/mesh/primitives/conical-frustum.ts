import { Mesh } from '../mesh';
import { u32Indices } from '../indices';
import { MeshAttribute } from '../vertex-attribute';
import type { Meshable, MeshBuilder } from './meshable';

/**
 * Conical frustum — a cone with the apex sliced off. Axis is the Y axis;
 * centred at the origin.
 *
 * Useful for spotlight cones, capsule end caps that are not full hemispheres,
 * speedometer indicators, and so on. Degenerates to a {@link Cylinder} when
 * `radiusTop === radiusBottom` and to a {@link Cone} when `radiusTop === 0`.
 */
export class ConicalFrustum implements Meshable<ConicalFrustumMeshBuilder> {
  readonly radiusTop: number;
  readonly radiusBottom: number;
  readonly height: number;

  constructor(options?: { radiusTop?: number; radiusBottom?: number; height?: number }) {
    this.radiusTop = options?.radiusTop ?? 0.25;
    this.radiusBottom = options?.radiusBottom ?? 0.5;
    this.height = options?.height ?? 1;
  }

  mesh(): ConicalFrustumMeshBuilder {
    return new ConicalFrustumMeshBuilder(this);
  }
}

export class ConicalFrustumMeshBuilder implements MeshBuilder {
  private resolutionValue = 32;

  constructor(private readonly frustum: ConicalFrustum) {}

  /** Number of radial segments. Default 32. */
  resolution(n: number): this {
    this.resolutionValue = n;
    return this;
  }

  build(): Mesh {
    const rt = this.frustum.radiusTop;
    const rb = this.frustum.radiusBottom;
    const halfH = this.frustum.height / 2;
    const res = this.resolutionValue;
    // Side: 2 * (res + 1) vertices.
    const sideVerts = (res + 1) * 2;
    // Top cap: centre + (res + 1) ring.
    // Bottom cap: centre + (res + 1) ring.
    const capVerts = 2 * (1 + (res + 1));
    const total = sideVerts + capVerts;
    const positions = new Float32Array(total * 3);
    const normals = new Float32Array(total * 3);
    const uvs = new Float32Array(total * 2);
    let p = 0;
    let n = 0;
    let u = 0;
    // Compute side normal Y component.
    const slope = (rb - rt) / this.frustum.height;
    const slant = Math.hypot(1, slope) || 1;
    const ny = slope / slant;
    const nrFactor = 1 / slant;
    for (let i = 0; i <= res; i++) {
      const uu = i / res;
      const theta = uu * Math.PI * 2;
      const ct = Math.cos(theta);
      const st = Math.sin(theta);
      // Bottom.
      positions[p++] = ct * rb;
      positions[p++] = -halfH;
      positions[p++] = st * rb;
      normals[n++] = ct * nrFactor;
      normals[n++] = ny;
      normals[n++] = st * nrFactor;
      uvs[u++] = uu;
      uvs[u++] = 1;
      // Top.
      positions[p++] = ct * rt;
      positions[p++] = halfH;
      positions[p++] = st * rt;
      normals[n++] = ct * nrFactor;
      normals[n++] = ny;
      normals[n++] = st * nrFactor;
      uvs[u++] = uu;
      uvs[u++] = 0;
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
    positions[p++] = 0;
    positions[p++] = halfH;
    positions[p++] = 0;
    normals[n++] = 0;
    normals[n++] = 1;
    normals[n++] = 0;
    uvs[u++] = 0.5;
    uvs[u++] = 0.5;
    const topRingStart = topCentreIdx + 1;
    for (let i = 0; i <= res; i++) {
      const uu = i / res;
      const theta = uu * Math.PI * 2;
      const ct = Math.cos(theta);
      const st = Math.sin(theta);
      positions[p++] = ct * rt;
      positions[p++] = halfH;
      positions[p++] = st * rt;
      normals[n++] = 0;
      normals[n++] = 1;
      normals[n++] = 0;
      uvs[u++] = ct * 0.5 + 0.5;
      uvs[u++] = st * 0.5 + 0.5;
    }
    for (let i = 0; i < res; i++) {
      indices.push(topCentreIdx, topRingStart + i + 1, topRingStart + i);
    }
    // Bottom cap.
    const bottomCentreIdx = topRingStart + res + 1;
    positions[p++] = 0;
    positions[p++] = -halfH;
    positions[p++] = 0;
    normals[n++] = 0;
    normals[n++] = -1;
    normals[n++] = 0;
    uvs[u++] = 0.5;
    uvs[u++] = 0.5;
    const bottomRingStart = bottomCentreIdx + 1;
    for (let i = 0; i <= res; i++) {
      const uu = i / res;
      const theta = uu * Math.PI * 2;
      const ct = Math.cos(theta);
      const st = Math.sin(theta);
      positions[p++] = ct * rb;
      positions[p++] = -halfH;
      positions[p++] = st * rb;
      normals[n++] = 0;
      normals[n++] = -1;
      normals[n++] = 0;
      uvs[u++] = ct * 0.5 + 0.5;
      uvs[u++] = st * 0.5 + 0.5;
    }
    for (let i = 0; i < res; i++) {
      indices.push(bottomCentreIdx, bottomRingStart + i, bottomRingStart + i + 1);
    }
    return new Mesh({ label: 'ConicalFrustum' })
      .insertAttribute(MeshAttribute.POSITION, positions)
      .insertAttribute(MeshAttribute.NORMAL, normals)
      .insertAttribute(MeshAttribute.UV_0, uvs)
      .setIndices(u32Indices(new Uint32Array(indices)));
  }
}
