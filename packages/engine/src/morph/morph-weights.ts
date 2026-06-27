import type { MorphTargets } from './morph-targets';

/**
 * The live morph-target weights for an entity's mesh: one weight per target,
 * blended into the mesh in the vertex shader each frame
 * (`position += Σ weightᵢ · deltaᵢ`).
 *
 * Authored state — it survives a saved scene and a code reload. {@link names}
 * is parallel to {@link weights}; the names address targets for animation
 * channels and the inspector. A weight of `0` leaves a target inert, `1` applies
 * it fully; values outside `[0, 1]` extrapolate (glTF permits it).
 */
export class MorphWeights {
  constructor(
    /** Target names, parallel to {@link weights}. */
    public names: string[] = [],
    /** Per-target weight, parallel to {@link names}. */
    public weights: number[] = [],
  ) {}

  /**
   * Build weights for a mesh's targets, seeded with the targets' default
   * weights. The result is independent of the mesh — editing it never mutates
   * the shared {@link MorphTargets}.
   */
  static fromTargets(targets: MorphTargets): MorphWeights {
    return new MorphWeights([...targets.names], [...targets.defaultWeights]);
  }

  /** Index of the named target, or `-1` when absent. */
  indexOf(name: string): number {
    return this.names.indexOf(name);
  }

  /** Current weight of the named target, or `undefined` when absent. */
  get(name: string): number | undefined {
    const i = this.names.indexOf(name);
    return i === -1 ? undefined : this.weights[i];
  }

  /** Set the named target's weight. No-op when the name is unknown. */
  set(name: string, value: number): void {
    const i = this.names.indexOf(name);
    if (i !== -1) this.weights[i] = value;
  }
}
