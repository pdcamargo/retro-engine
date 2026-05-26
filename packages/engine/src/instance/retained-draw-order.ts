import type { Entity } from '@retro-engine/ecs';
import type { Renderer } from '@retro-engine/renderer-core';

import { GrowableInstanceStore } from './growable-instance-store';
import type { Slot } from './retained-slot-map';

/**
 * One run of instances in the ordered buffer destined for a single instanced
 * draw. `key` is the run's first (back-most, for depth-ordered paths) member's
 * key — batch metadata the prepare turns into a draw.
 */
export interface OrderedBatch<K> {
  /** First instance of the run within the ordered buffer. */
  firstInstance: number;
  /** Instances in the run. */
  count: number;
  readonly key: K;
}

interface Member<K> {
  readonly entity: Entity;
  /** Live slot in the source slot buffer — `slot.first` is read fresh (it moves on compaction). */
  readonly slot: Slot;
  key: K;
  /** This member's first instance within the ordered buffer (assigned on rebuild). */
  orderedFirst: number;
}

/**
 * Retained draw-order index over a slot buffer for depth-ordered instanced
 * paths (sprites, 2D meshes, transparent 3D).
 *
 * The slot buffer holds camera-independent bytes at stable, alloc-order slots;
 * draws need them contiguous in sorted order. This index keeps a sorted member
 * list across frames and owns the ordered GPU buffer the draws read. It re-sorts
 * and rebuilds the ordered buffer (a byte memcpy from the slot buffer — never a
 * re-pack) only when the order is invalidated: a member added / removed
 * ({@link addMember} / {@link removeMember}), a member's sort key changed
 * ({@link updateMember}), or {@link invalidate} (e.g. slot compaction). When the
 * order is stable, a data-only change copies just that member's bytes into its
 * fixed ordered position ({@link updateMember} → in-place), so a steady-state
 * frame uploads O(changed) bytes and re-sorts nothing.
 *
 * Generic over a per-member key `K`: `compare` defines sort order (and, via a
 * non-zero result, what counts as a sort-affecting change); `sameBatch` decides
 * where one instanced draw ends and the next begins.
 *
 * @internal
 */
export class SortedSlotIndex<K> {
  /** The ordered GPU buffer the draws read. */
  readonly ordered: GrowableInstanceStore;
  /** Batches over {@link ordered}, valid after {@link prepare}. */
  readonly batches: OrderedBatch<K>[] = [];

  private readonly compare: (a: K, b: K) => number;
  private readonly sameBatch: (a: K, b: K) => boolean;
  private readonly members: Member<K>[] = [];
  private readonly byEntity = new Map<Entity, Member<K>>();
  private liveInstances = 0;
  private needsResort = false;

  /**
   * @param strideBytes Per-instance byte size (must match the source slot buffer).
   * @param label Debug label for the ordered GPU buffer.
   * @param compare Sort comparator over member keys; a non-zero result also
   *   marks a key change as sort-affecting (vs. a pure data change).
   * @param sameBatch Whether two adjacent members merge into one instanced draw.
   */
  constructor(
    strideBytes: number,
    label: string,
    compare: (a: K, b: K) => number,
    sameBatch: (a: K, b: K) => boolean,
  ) {
    this.ordered = new GrowableInstanceStore(strideBytes, label);
    this.compare = compare;
    this.sameBatch = sameBatch;
  }

  has(entity: Entity): boolean {
    return this.byEntity.has(entity);
  }

  /** Add a newly-visible / spawned entity's slot to the draw set. Forces a resort. */
  addMember(entity: Entity, slot: Slot, key: K): void {
    const existing = this.byEntity.get(entity);
    if (existing !== undefined) {
      this.liveInstances -= existing.slot.len;
      this.liveInstances += slot.len;
      existing.key = key;
      this.needsResort = true;
      return;
    }
    const member: Member<K> = { entity, slot, key, orderedFirst: 0 };
    this.members.push(member);
    this.byEntity.set(entity, member);
    this.liveInstances += slot.len;
    this.needsResort = true;
  }

  /** Drop a despawned / newly-invisible entity from the draw set. Forces a resort. */
  removeMember(entity: Entity): void {
    const member = this.byEntity.get(entity);
    if (member === undefined) return;
    this.byEntity.delete(entity);
    const idx = this.members.indexOf(member);
    if (idx !== -1) this.members.splice(idx, 1);
    this.liveInstances -= member.slot.len;
    this.needsResort = true;
  }

  /**
   * Record that an entity's instance data changed, with its (possibly new) key.
   * A sort-affecting key change forces a resort; otherwise the changed bytes are
   * copied straight from `source` into the member's fixed ordered position.
   */
  updateMember(entity: Entity, key: K, source: GrowableInstanceStore): void {
    const member = this.byEntity.get(entity);
    if (member === undefined) return;
    const keyChanged = this.compare(member.key, key) !== 0;
    member.key = key;
    if (keyChanged) {
      this.needsResort = true;
    } else if (!this.needsResort) {
      this.ordered.copyFrom(source, member.slot.first, member.orderedFirst, member.slot.len);
    }
  }

  /** Force a full re-sort + rebuild next {@link prepare} (e.g. after slot compaction). */
  invalidate(): void {
    this.needsResort = true;
  }

  /**
   * Rewrite every member's key in place (e.g. recomputing camera-space depth
   * after the camera moved) and force a re-sort. Cheaper than re-adding: the
   * subsequent rebuild reorders bytes by memcpy, never re-packing them.
   */
  recomputeKeys(update: (key: K, entity: Entity) => K): void {
    for (const m of this.members) m.key = update(m.key, m.entity);
    this.needsResort = true;
  }

  /**
   * Bring the ordered buffer up to date: re-sort + rebuild it (memcpy from
   * `source` in sorted order, re-emitting batches) when the order is invalidated,
   * otherwise upload the in-place data changes accumulated since the last call.
   */
  prepare(source: GrowableInstanceStore, renderer: Renderer): void {
    if (this.needsResort) {
      this.rebuild(source, renderer);
      this.needsResort = false;
    } else {
      this.ordered.flush(renderer);
    }
  }

  private rebuild(source: GrowableInstanceStore, renderer: Renderer): void {
    this.members.sort((a, b) => this.compare(a.key, b.key));
    this.ordered.ensureCapacity(renderer, this.liveInstances);
    this.batches.length = 0;
    let cursor = 0;
    let current: OrderedBatch<K> | undefined;
    for (const m of this.members) {
      m.orderedFirst = cursor;
      this.ordered.copyFrom(source, m.slot.first, cursor, m.slot.len);
      if (current === undefined || !this.sameBatch(current.key, m.key)) {
        current = { firstInstance: cursor, count: 0, key: m.key };
        this.batches.push(current);
      }
      current.count += m.slot.len;
      cursor += m.slot.len;
    }
    this.ordered.markFullUpload();
    this.ordered.flush(renderer);
  }

  /** Drop the ordered buffer and all members. */
  dispose(): void {
    this.ordered.dispose();
    this.members.length = 0;
    this.byEntity.clear();
    this.liveInstances = 0;
    this.batches.length = 0;
    this.needsResort = false;
  }
}
