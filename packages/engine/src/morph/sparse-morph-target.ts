/**
 * A sparse morph target: per-vertex position deltas keyed by vertex index against
 * a fixed-topology base mesh. Only moved vertices are stored — the i-th
 * {@link indices} entry is the base-mesh vertex displaced by the delta at
 * `deltas[i*3 .. i*3+2]`. This is the shape MakeHuman `.target` files carry, and
 * the unit the character creator composes onto a base mesh.
 *
 * Unlike the dense glTF blend shape (`MorphTarget`, a full per-vertex delta over
 * every vertex), a sparse target stores only the handful of vertices a slider
 * moves — the 19k-vertex MakeHuman base with a nose tweak touching ~200 vertices
 * is a few KB, not a full delta buffer.
 */
export class SparseMorphTarget {
  constructor(
    /** Display / addressing name (typically the source file's stem, e.g. `'nose-base-down'`). */
    readonly name: string,
    /** Base-mesh vertex indices that move, ascending or in source order. */
    readonly indices: Uint32Array,
    /** Position deltas parallel to {@link indices}: `indices.length × 3` floats. */
    readonly deltas: Float32Array,
  ) {}

  /** Number of moved vertices. */
  get count(): number {
    return this.indices.length;
  }

  /** Highest base-mesh vertex index this target moves, or `-1` when it moves none. */
  get maxIndex(): number {
    let max = -1;
    for (let i = 0; i < this.indices.length; i++) {
      const idx = this.indices[i]!;
      if (idx > max) max = idx;
    }
    return max;
  }

  /** True when every moved index is addressable on a base mesh of `baseVertexCount` vertices. */
  fitsBase(baseVertexCount: number): boolean {
    return this.maxIndex < baseVertexCount;
  }

  /**
   * Expand to a dense per-vertex delta array over `baseVertexCount` vertices
   * (`baseVertexCount × 3`), zero everywhere except the moved vertices. The form
   * the runtime morph path and CPU composition consume.
   *
   * @throws RangeError when a moved index is out of range for `baseVertexCount`.
   */
  toDense(baseVertexCount: number): Float32Array {
    const out = new Float32Array(baseVertexCount * 3);
    for (let i = 0; i < this.indices.length; i++) {
      const v = this.indices[i]!;
      if (v >= baseVertexCount) {
        throw new RangeError(
          `SparseMorphTarget '${this.name}': vertex index ${v} exceeds base vertex count ${baseVertexCount}`,
        );
      }
      out[v * 3] = this.deltas[i * 3]!;
      out[v * 3 + 1] = this.deltas[i * 3 + 1]!;
      out[v * 3 + 2] = this.deltas[i * 3 + 2]!;
    }
    return out;
  }
}

/**
 * Parse a MakeHuman `.target` text body into a {@link SparseMorphTarget}.
 *
 * Each non-empty, non-`#`-comment line is `vertexIndex dx dy dz` (whitespace
 * separated; MakeHuman writes leading-dot floats like `-.011`, which parse
 * natively). Lines are taken in source order.
 *
 * @throws Error on a malformed line (wrong field count, a non-integer / negative
 *   index, or a non-finite delta) — the file is topology-locked data, so a parse
 *   error means corruption rather than something to skip silently.
 */
export const parseSparseMorphTarget = (text: string, name = ''): SparseMorphTarget => {
  const indices: number[] = [];
  const deltas: number[] = [];
  const lines = text.split('\n');
  for (let l = 0; l < lines.length; l++) {
    const line = lines[l]!.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    if (parts.length !== 4) {
      throw new Error(`parseSparseMorphTarget '${name}': line ${l + 1} has ${parts.length} fields, expected 4: "${line}"`);
    }
    const index = Number(parts[0]);
    if (!Number.isInteger(index) || index < 0) {
      throw new Error(`parseSparseMorphTarget '${name}': line ${l + 1} has a non-integer/negative index: "${parts[0]}"`);
    }
    const dx = parseFloat(parts[1]!);
    const dy = parseFloat(parts[2]!);
    const dz = parseFloat(parts[3]!);
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(dz)) {
      throw new Error(`parseSparseMorphTarget '${name}': line ${l + 1} has a non-finite delta: "${line}"`);
    }
    indices.push(index);
    deltas.push(dx, dy, dz);
  }
  return new SparseMorphTarget(name, Uint32Array.from(indices), Float32Array.from(deltas));
};
