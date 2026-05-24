import { Aabb } from '@retro-engine/math';
import type { PrimitiveTopology } from '@retro-engine/renderer-core';
import { vertexFormatByteSize } from '@retro-engine/renderer-core';

import type { Indices } from './indices';
import type { MeshVertexAttribute, MeshVertexAttributeId } from './vertex-attribute';
import { MeshAttribute } from './vertex-attribute';

/**
 * One attribute's storage on a {@link Mesh}: the per-vertex format declaration
 * paired with the packed bytes. Consumers read the typed array directly; the
 * attribute carries the metadata needed to interpret it.
 */
export interface MeshAttributeData {
  readonly attribute: MeshVertexAttribute;
  /**
   * Packed attribute bytes, one element per vertex. The element width matches
   * the attribute's {@link VertexFormat} ({@link vertexFormatByteSize}).
   */
  readonly data: Float32Array | Uint32Array | Int32Array | Uint16Array | Uint8Array;
}

/**
 * CPU-side mesh asset.
 *
 * Holds per-attribute vertex data, optional indices, and a primitive topology.
 * Builders ({@link Meshable}-derived primitives, glTF loader, custom geometry
 * generators) emit `Mesh` instances; the engine extracts those into a
 * GPU-side {@link RenderMesh} via the {@link Meshes} registry and
 * {@link MeshAllocator} on the render world.
 *
 * Pre-asset-system shape: `Mesh` is a plain value class today. Once
 * `@retro-engine/assets` lands, `Mesh` becomes a typed asset with a
 * `Handle<Mesh>` indirection; the field shape is the same in both worlds.
 */
export class Mesh {
  /** Optional label propagated to GPU buffers + diagnostics. */
  readonly label?: string;

  /**
   * Vertex attributes, keyed by id. Insertion order is the order in which
   * attributes appear in the derived vertex-buffer layout (see
   * {@link Mesh.deriveLayout}).
   */
  private readonly attributes = new Map<MeshVertexAttributeId, MeshAttributeData>();

  /** Optional index buffer. When present, the mesh draws via `drawIndexed`. */
  private indicesValue?: Indices;

  /** Primitive topology to rasterise. Defaults to `'triangle-list'`. */
  primitiveTopology: PrimitiveTopology;

  constructor(options?: { label?: string; primitiveTopology?: PrimitiveTopology }) {
    if (options?.label !== undefined) this.label = options.label;
    this.primitiveTopology = options?.primitiveTopology ?? 'triangle-list';
  }

  /**
   * Insert (or replace) an attribute's data.
   *
   * `data` must be the right typed-array width for the attribute's format —
   * a `float32x3` POSITION takes a `Float32Array` of length `3 × vertexCount`.
   * The length is not validated against other attributes at write time;
   * cross-attribute consistency is checked by {@link Mesh.vertexCount}.
   */
  insertAttribute(attribute: MeshVertexAttribute, data: MeshAttributeData['data']): this {
    this.attributes.set(attribute.id, { attribute, data });
    return this;
  }

  /**
   * Builder-style insert; returns the same mesh for fluent chaining. Identical
   * semantics to {@link Mesh.insertAttribute}.
   */
  withInsertedAttribute(attribute: MeshVertexAttribute, data: MeshAttributeData['data']): this {
    return this.insertAttribute(attribute, data);
  }

  /** Read one attribute's storage. Returns `undefined` when the slot is empty. */
  getAttribute(attribute: MeshVertexAttribute): MeshAttributeData | undefined {
    return this.attributes.get(attribute.id);
  }

  /** True when the named attribute slot has data. */
  hasAttribute(attribute: MeshVertexAttribute): boolean {
    return this.attributes.has(attribute.id);
  }

  /** Iterate every registered attribute. Order matches insertion order. */
  *iterAttributes(): IterableIterator<MeshAttributeData> {
    for (const value of this.attributes.values()) yield value;
  }

  /** Number of distinct attributes registered. */
  get attributeCount(): number {
    return this.attributes.size;
  }

  /**
   * Replace the index buffer. Pass `undefined` to drop indices (the mesh draws
   * non-indexed thereafter).
   */
  setIndices(indices: Indices | undefined): this {
    if (indices === undefined) {
      delete this.indicesValue;
    } else {
      this.indicesValue = indices;
    }
    return this;
  }

  /** The current index buffer, if any. */
  get indices(): Indices | undefined {
    return this.indicesValue;
  }

  /**
   * Number of vertices in the mesh, derived from the registered attributes.
   *
   * If at least one attribute is present, returns the vertex-count implied by
   * that attribute's data length and per-element width. Returns `0` when no
   * attribute is present. Cross-attribute length consistency is not validated
   * here — call {@link Mesh.checkConsistency} to opt into the check.
   */
  get vertexCount(): number {
    const first = this.attributes.values().next();
    if (first.done === true) return 0;
    const { attribute, data } = first.value;
    const elementSize = vertexFormatByteSize(attribute.format);
    return (data.byteLength / elementSize) | 0;
  }

  /**
   * Throw if any two attributes disagree on the implied vertex count.
   *
   * Called by builders that want a one-shot validation before handing the mesh
   * to {@link Meshes.add}; not part of the hot path.
   */
  checkConsistency(): void {
    let expected = -1;
    let referenceName = '';
    for (const { attribute, data } of this.attributes.values()) {
      const elementSize = vertexFormatByteSize(attribute.format);
      const count = (data.byteLength / elementSize) | 0;
      if (expected < 0) {
        expected = count;
        referenceName = attribute.name;
        continue;
      }
      if (count !== expected) {
        throw new Error(
          `Mesh attribute '${attribute.name}' has ${count} vertices, but '${referenceName}' has ${expected}`,
        );
      }
    }
  }

  /**
   * Compute the axis-aligned bounding box from {@link MeshAttribute.POSITION}.
   *
   * Returns a zero-sized AABB at the origin if no positions are present.
   * Always allocates a fresh {@link Aabb}; pass `dst` to reuse storage.
   */
  computeAabb(dst?: Aabb): Aabb {
    const positions = this.attributes.get(MeshAttribute.POSITION.id);
    if (!positions || !(positions.data instanceof Float32Array)) {
      return Aabb.fromPoints(new Float32Array(), dst);
    }
    return Aabb.fromPoints(positions.data, dst);
  }

  /**
   * Compute flat normals (one normal per triangle, duplicated across all three
   * vertices) and store them in {@link MeshAttribute.NORMAL}.
   *
   * Requires `POSITION` and an index buffer; throws otherwise. The mesh's
   * topology must be `'triangle-list'`. The resulting normals are unit-length
   * face normals — sharing positions across faces produces faceted shading.
   * Use {@link Mesh.computeSmoothNormals} for shared-vertex smooth shading.
   */
  computeFlatNormals(): this {
    if (this.primitiveTopology !== 'triangle-list') {
      throw new Error(`computeFlatNormals requires topology 'triangle-list', got '${this.primitiveTopology}'`);
    }
    const positions = this.attributes.get(MeshAttribute.POSITION.id);
    if (!positions || !(positions.data instanceof Float32Array)) {
      throw new Error('computeFlatNormals requires a Float32Array POSITION attribute');
    }
    const indices = this.indicesValue;
    if (!indices) {
      throw new Error('computeFlatNormals requires an index buffer');
    }
    const positionData = positions.data;
    const vertexCount = positionData.length / 3;
    const normals = new Float32Array(vertexCount * 3);

    const indexData = indices.data;
    for (let i = 0; i + 2 < indexData.length; i += 3) {
      const ia = indexData[i]!;
      const ib = indexData[i + 1]!;
      const ic = indexData[i + 2]!;
      const ax = positionData[ia * 3]!,
        ay = positionData[ia * 3 + 1]!,
        az = positionData[ia * 3 + 2]!;
      const bx = positionData[ib * 3]!,
        by = positionData[ib * 3 + 1]!,
        bz = positionData[ib * 3 + 2]!;
      const cx = positionData[ic * 3]!,
        cy = positionData[ic * 3 + 1]!,
        cz = positionData[ic * 3 + 2]!;
      const ex = bx - ax,
        ey = by - ay,
        ez = bz - az;
      const fx = cx - ax,
        fy = cy - ay,
        fz = cz - az;
      const nx = ey * fz - ez * fy;
      const ny = ez * fx - ex * fz;
      const nz = ex * fy - ey * fx;
      const len = Math.hypot(nx, ny, nz) || 1;
      const ux = nx / len,
        uy = ny / len,
        uz = nz / len;
      normals[ia * 3] = ux;
      normals[ia * 3 + 1] = uy;
      normals[ia * 3 + 2] = uz;
      normals[ib * 3] = ux;
      normals[ib * 3 + 1] = uy;
      normals[ib * 3 + 2] = uz;
      normals[ic * 3] = ux;
      normals[ic * 3 + 1] = uy;
      normals[ic * 3 + 2] = uz;
    }
    this.insertAttribute(MeshAttribute.NORMAL, normals);
    return this;
  }

  /**
   * Compute area-weighted smooth normals (one accumulated normal per vertex,
   * shared across every triangle that uses the vertex) and store them in
   * {@link MeshAttribute.NORMAL}.
   *
   * Requires `POSITION` and an index buffer; throws otherwise. Vertices used
   * by multiple faces interpolate smoothly. Use {@link Mesh.computeFlatNormals}
   * when faceted shading is wanted.
   */
  computeSmoothNormals(): this {
    if (this.primitiveTopology !== 'triangle-list') {
      throw new Error(`computeSmoothNormals requires topology 'triangle-list', got '${this.primitiveTopology}'`);
    }
    const positions = this.attributes.get(MeshAttribute.POSITION.id);
    if (!positions || !(positions.data instanceof Float32Array)) {
      throw new Error('computeSmoothNormals requires a Float32Array POSITION attribute');
    }
    const indices = this.indicesValue;
    if (!indices) {
      throw new Error('computeSmoothNormals requires an index buffer');
    }
    const positionData = positions.data;
    const vertexCount = positionData.length / 3;
    const normals = new Float32Array(vertexCount * 3);

    const indexData = indices.data;
    for (let i = 0; i + 2 < indexData.length; i += 3) {
      const ia = indexData[i]!;
      const ib = indexData[i + 1]!;
      const ic = indexData[i + 2]!;
      const ax = positionData[ia * 3]!,
        ay = positionData[ia * 3 + 1]!,
        az = positionData[ia * 3 + 2]!;
      const bx = positionData[ib * 3]!,
        by = positionData[ib * 3 + 1]!,
        bz = positionData[ib * 3 + 2]!;
      const cx = positionData[ic * 3]!,
        cy = positionData[ic * 3 + 1]!,
        cz = positionData[ic * 3 + 2]!;
      const ex = bx - ax,
        ey = by - ay,
        ez = bz - az;
      const fx = cx - ax,
        fy = cy - ay,
        fz = cz - az;
      // Un-normalised face normal — magnitude is `2 × triangleArea`, which
      // gives an area-weighted average when accumulated across faces sharing a
      // vertex.
      const nx = ey * fz - ez * fy;
      const ny = ez * fx - ex * fz;
      const nz = ex * fy - ey * fx;
      normals[ia * 3] = (normals[ia * 3] ?? 0) + nx;
      normals[ia * 3 + 1] = (normals[ia * 3 + 1] ?? 0) + ny;
      normals[ia * 3 + 2] = (normals[ia * 3 + 2] ?? 0) + nz;
      normals[ib * 3] = (normals[ib * 3] ?? 0) + nx;
      normals[ib * 3 + 1] = (normals[ib * 3 + 1] ?? 0) + ny;
      normals[ib * 3 + 2] = (normals[ib * 3 + 2] ?? 0) + nz;
      normals[ic * 3] = (normals[ic * 3] ?? 0) + nx;
      normals[ic * 3 + 1] = (normals[ic * 3 + 1] ?? 0) + ny;
      normals[ic * 3 + 2] = (normals[ic * 3 + 2] ?? 0) + nz;
    }
    for (let v = 0; v < vertexCount; v++) {
      const x = normals[v * 3]!,
        y = normals[v * 3 + 1]!,
        z = normals[v * 3 + 2]!;
      const len = Math.hypot(x, y, z) || 1;
      normals[v * 3] = x / len;
      normals[v * 3 + 1] = y / len;
      normals[v * 3 + 2] = z / len;
    }
    this.insertAttribute(MeshAttribute.NORMAL, normals);
    return this;
  }
}
