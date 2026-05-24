import { Mesh } from '../mesh';
import { u32Indices } from '../indices';
import { MeshAttribute } from '../vertex-attribute';
import type { Meshable, MeshBuilder } from './meshable';

/**
 * Capsule (cylinder with hemispherical caps). Axis is the Y axis; centred at
 * the origin.
 *
 * `radius` and `halfLength` follow Bevy's convention — `halfLength` is the
 * half-height of the *cylindrical* middle section, so the capsule's total
 * height from end to end is `2 * (halfLength + radius)`.
 */
export class Capsule3d implements Meshable<Capsule3dMeshBuilder> {
  readonly radius: number;
  readonly halfLength: number;

  constructor(options?: { radius?: number; halfLength?: number }) {
    this.radius = options?.radius ?? 0.5;
    this.halfLength = options?.halfLength ?? 0.5;
  }

  mesh(): Capsule3dMeshBuilder {
    return new Capsule3dMeshBuilder(this);
  }
}

export class Capsule3dMeshBuilder implements MeshBuilder {
  private longitudesValue = 32;
  private latitudesValue = 16;

  constructor(private readonly capsule: Capsule3d) {}

  /** Number of radial divisions around the capsule (Y axis). Default 32. */
  longitudes(n: number): this {
    this.longitudesValue = n;
    return this;
  }

  /** Number of stacks in each hemispherical cap (top + bottom). Default 16. */
  latitudes(n: number): this {
    this.latitudesValue = n;
    return this;
  }

  build(): Mesh {
    const r = this.capsule.radius;
    const hl = this.capsule.halfLength;
    const longs = this.longitudesValue;
    const lats = this.latitudesValue;
    // Stack count for the full body: lats for top hemisphere + 1 stack of
    // cylinder + lats for bottom hemisphere.
    const stacks = lats * 2 + 1;
    const ringStride = longs + 1;
    const vertexCount = ringStride * (stacks + 1);
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    let p = 0;
    let n = 0;
    let u = 0;
    for (let i = 0; i <= stacks; i++) {
      // Map i to a y coordinate + a normal direction.
      // Top hemisphere: i in [0, lats], phi in [0, π/2].
      // Cylinder body: i = lats + 0.5 → midpoint.
      // Bottom hemisphere: i in [lats + 1, stacks], phi in [π/2, π].
      let ny: number;
      let yCenter: number;
      let radial: number; // cos(phi - center)
      if (i <= lats) {
        const phi = (i / lats) * (Math.PI / 2);
        const cp = Math.cos(phi);
        const sp = Math.sin(phi);
        ny = cp;
        radial = sp;
        yCenter = hl + cp * r;
      } else {
        const j = i - lats - 1; // 0..lats-1
        const phi = (j / lats) * (Math.PI / 2) + Math.PI / 2;
        const cp = Math.cos(phi);
        const sp = Math.sin(phi);
        ny = cp;
        radial = sp;
        yCenter = -hl + cp * r;
      }
      // Cylinder seam: when i === lats we are at top equator (ny = 0), when
      // i === lats + 1 we are at bottom equator (also ny = 0). Both rings sit
      // at radius r and are connected via cylinder-side quads.
      for (let j = 0; j <= longs; j++) {
        const theta = (j / longs) * Math.PI * 2;
        const ct = Math.cos(theta);
        const st = Math.sin(theta);
        positions[p++] = radial * ct * r;
        positions[p++] = yCenter;
        positions[p++] = radial * st * r;
        normals[n++] = radial * ct;
        normals[n++] = ny;
        normals[n++] = radial * st;
        uvs[u++] = j / longs;
        uvs[u++] = i / stacks;
      }
    }
    const indices: number[] = [];
    for (let i = 0; i < stacks; i++) {
      for (let j = 0; j < longs; j++) {
        const a = i * ringStride + j;
        const b = a + ringStride;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    return new Mesh({ label: 'Capsule3d' })
      .insertAttribute(MeshAttribute.POSITION, positions)
      .insertAttribute(MeshAttribute.NORMAL, normals)
      .insertAttribute(MeshAttribute.UV_0, uvs)
      .setIndices(u32Indices(new Uint32Array(indices)));
  }
}
