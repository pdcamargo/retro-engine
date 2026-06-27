/**
 * One morph target (blend shape): named per-vertex deltas relative to a mesh's
 * base geometry. Adding `weight · positionDeltas` to the base positions — and
 * likewise for normals — deforms the mesh toward this target.
 */
export interface MorphTarget {
  /** Display / addressing name (e.g. `'smile'`, `'jawOpen'`). */
  readonly name: string;
  /** Per-vertex position deltas: `vertexCount × 3` floats (x, y, z per vertex). */
  readonly positionDeltas: Float32Array;
  /**
   * Per-vertex normal deltas: `vertexCount × 3` floats. All-zero when the source
   * target carried no normal deltas, so the shader can blend unconditionally.
   */
  readonly normalDeltas: Float32Array;
}

/**
 * The morph targets attached to a {@link Mesh}: a fixed, ordered set of blend
 * shapes sharing the mesh's vertex order, plus the default weight each starts
 * at. Static mesh data — the live, animatable weights live on the `MorphWeights`
 * component attached to the entity that draws the mesh.
 *
 * Every target's delta arrays have the same length (`vertexCount × 3`); the i-th
 * target pairs with the i-th entry of {@link defaultWeights}.
 */
export class MorphTargets {
  /** The blend shapes, in a stable order weights and the GPU buffer index by. */
  readonly targets: readonly MorphTarget[];
  /** Vertices each target's deltas cover; matches the owning mesh's vertex count. */
  readonly vertexCount: number;
  /** Weight each target starts at, parallel to {@link targets} (glTF `mesh.weights`). */
  readonly defaultWeights: readonly number[];

  constructor(targets: readonly MorphTarget[], vertexCount: number, defaultWeights?: readonly number[]) {
    this.targets = targets;
    this.vertexCount = vertexCount;
    this.defaultWeights =
      defaultWeights !== undefined && defaultWeights.length === targets.length
        ? defaultWeights
        : targets.map(() => 0);
  }

  /** Number of targets. */
  get count(): number {
    return this.targets.length;
  }

  /** Target names in index order. */
  get names(): string[] {
    return this.targets.map((target) => target.name);
  }
}
