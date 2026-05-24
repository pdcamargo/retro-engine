import { Mesh } from '../mesh';
import { u32Indices } from '../indices';
import { MeshAttribute } from '../vertex-attribute';
import type { Meshable, MeshBuilder } from './meshable';

/**
 * Torus primitive. Axis is the Y axis.
 *
 * `minorRadius` is the tube radius; `majorRadius` is the distance from the
 * tube centre to the torus centre.
 */
export class Torus implements Meshable<TorusMeshBuilder> {
  readonly minorRadius: number;
  readonly majorRadius: number;

  constructor(options?: { minorRadius?: number; majorRadius?: number }) {
    this.minorRadius = options?.minorRadius ?? 0.25;
    this.majorRadius = options?.majorRadius ?? 1;
  }

  mesh(): TorusMeshBuilder {
    return new TorusMeshBuilder(this);
  }
}

export class TorusMeshBuilder implements MeshBuilder {
  private majorResolutionValue = 32;
  private minorResolutionValue = 16;

  constructor(private readonly torus: Torus) {}

  /** Number of segments around the torus (major axis). Default 32. */
  majorResolution(n: number): this {
    this.majorResolutionValue = n;
    return this;
  }

  /** Number of segments around the tube (minor axis). Default 16. */
  minorResolution(n: number): this {
    this.minorResolutionValue = n;
    return this;
  }

  build(): Mesh {
    const R = this.torus.majorRadius;
    const r = this.torus.minorRadius;
    const major = this.majorResolutionValue;
    const minor = this.minorResolutionValue;
    const ringStride = minor + 1;
    const vertexCount = (major + 1) * ringStride;
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    let p = 0;
    let n = 0;
    let u = 0;
    for (let i = 0; i <= major; i++) {
      const theta = (i / major) * Math.PI * 2;
      const ct = Math.cos(theta);
      const st = Math.sin(theta);
      for (let j = 0; j <= minor; j++) {
        const phi = (j / minor) * Math.PI * 2;
        const cp = Math.cos(phi);
        const sp = Math.sin(phi);
        const rr = R + r * cp;
        positions[p++] = rr * ct;
        positions[p++] = r * sp;
        positions[p++] = rr * st;
        normals[n++] = cp * ct;
        normals[n++] = sp;
        normals[n++] = cp * st;
        uvs[u++] = i / major;
        uvs[u++] = j / minor;
      }
    }
    const indices: number[] = [];
    for (let i = 0; i < major; i++) {
      for (let j = 0; j < minor; j++) {
        const a = i * ringStride + j;
        const b = a + ringStride;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    return new Mesh({ label: 'Torus' })
      .insertAttribute(MeshAttribute.POSITION, positions)
      .insertAttribute(MeshAttribute.NORMAL, normals)
      .insertAttribute(MeshAttribute.UV_0, uvs)
      .setIndices(u32Indices(new Uint32Array(indices)));
  }
}
