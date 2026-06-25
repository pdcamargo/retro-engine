/**
 * A reusable, shareable set of bones an animation layer is allowed to affect,
 * keyed by the same stable target id a clip track binds through (a glTF node
 * index as a string, or a bone name). Membership is **binary** — a bone is
 * either included or excluded, like a Unity generic/Transform mask — so a layer
 * masked to "spine + arms" can wave the upper body while lower layers keep
 * driving the legs.
 *
 * A mask scopes *which bones* a layer writes; it does not weight them. The
 * per-field blend weights inside a single layer's pose stay independent of the
 * mask. An animation layer with no mask affects every bone its motion animates.
 *
 * This is the generic mask. A humanoid body-part mask (head / arms / legs by
 * standardized silhouette) is a later addition that resolves to the same
 * included-bone set once a canonical humanoid avatar exists.
 */
export class AvatarMask {
  private readonly bones: Set<string>;

  constructor(
    /** Target ids of the bones this mask includes. Duplicates are coalesced. */
    included: Iterable<string> = [],
    /** Optional human-readable name carried for tooling. */
    public name?: string,
  ) {
    this.bones = new Set(included);
  }

  /** Whether `targetId` is in the included set — i.e. a layer using this mask may write it. */
  has(targetId: string): boolean {
    return this.bones.has(targetId);
  }

  /** Add `targetId` to the included set. */
  include(targetId: string): void {
    this.bones.add(targetId);
  }

  /** Remove `targetId` from the included set. */
  exclude(targetId: string): void {
    this.bones.delete(targetId);
  }

  /** The included target ids, in insertion order. */
  ids(): string[] {
    return [...this.bones];
  }

  /** Number of included bones. */
  get size(): number {
    return this.bones.size;
  }
}
