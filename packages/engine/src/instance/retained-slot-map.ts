import type { Entity } from '@retro-engine/ecs';

/**
 * A contiguous run of instance slots owned by one entity within a retained
 * instance buffer.
 *
 * `first` is the run's starting instance index (not a byte offset — multiply by
 * the buffer's per-instance stride to address bytes). `len` is the number of
 * contiguous instances the entity occupies: `1` for a plain renderable, `9` for
 * a 9-sliced sprite.
 *
 * `first` is mutable: {@link RetainedSlotMap.compact} relocates live runs to
 * close holes and rewrites `first` in place, so consumers must read it fresh
 * each frame rather than caching the value. `len` never changes for a given
 * slot — a run whose length changes is freed and re-allocated.
 */
export interface Slot {
  first: number;
  readonly len: number;
}

/**
 * Callback invoked by {@link RetainedSlotMap.compact} for every live run that
 * moves, so the owning buffer can relocate the run's bytes from `oldFirst` to
 * `newFirst` before the old position is reused.
 */
export type SlotMoveVisitor = (
  entity: Entity,
  oldFirst: number,
  newFirst: number,
  len: number,
) => void;

/**
 * Stable per-entity instance-slot allocator with a length-bucketed free list.
 *
 * Persists the mapping from entity to a contiguous run of instance slots across
 * frames so a retained instance buffer can rewrite only the runs whose data
 * changed instead of repacking the whole buffer every frame. Spawns
 * {@link alloc}, despawns {@link free}; freed runs are recycled by exact length
 * so the common single-instance case is O(1) and a 9-instance run is satisfiable
 * without a general best-fit search.
 *
 * The map is storage-only — it knows nothing about GPU buffers, sort order, or
 * cameras. Draw order lives in a separate index built over these slots.
 */
export class RetainedSlotMap {
  private readonly slots = new Map<Entity, Slot>();
  /** Free runs bucketed by exact length: `len` → stack of free `first` positions. */
  private readonly freeRuns = new Map<number, number[]>();
  private high = 0;
  private liveCount = 0;
  private freeCount = 0;
  private gen = 0;

  /**
   * Bumped on every structural change (alloc, free, compact). Draw-order indexes
   * compare against the last value they saw to detect membership changes
   * (spawn / despawn / re-length) that invalidate a cached sort.
   */
  get generation(): number {
    return this.gen;
  }

  /** Live instances across all slots. */
  get liveInstances(): number {
    return this.liveCount;
  }

  /** Instances sitting in freed holes, reusable by a same-length alloc. */
  get freeInstances(): number {
    return this.freeCount;
  }

  /**
   * High-water instance count — the smallest capacity a backing buffer must
   * provide to address every live and freed slot. Grows on a fresh alloc, never
   * shrinks except via {@link compact}.
   */
  capacityInstances(): number {
    return this.high;
  }

  /** Number of entities holding a slot. */
  get size(): number {
    return this.slots.size;
  }

  has(entity: Entity): boolean {
    return this.slots.has(entity);
  }

  get(entity: Entity): Slot | undefined {
    return this.slots.get(entity);
  }

  /**
   * Reserve a run of `len` instances for `entity`. Reuses a freed run of the
   * exact same length when one exists, otherwise bumps the high-water tail.
   *
   * If the entity already owns a run of the same length its existing slot is
   * returned unchanged; if it owns a run of a different length the old run is
   * freed first (a re-length, e.g. a sprite toggling 9-slice on or off).
   */
  alloc(entity: Entity, len: number): Slot {
    const existing = this.slots.get(entity);
    if (existing !== undefined) {
      if (existing.len === len) return existing;
      this.free(entity);
    }
    const pool = this.freeRuns.get(len);
    let first: number;
    if (pool !== undefined && pool.length > 0) {
      first = pool.pop()!;
      this.freeCount -= len;
    } else {
      first = this.high;
      this.high += len;
    }
    const slot: Slot = { first, len };
    this.slots.set(entity, slot);
    this.liveCount += len;
    this.gen += 1;
    return slot;
  }

  /**
   * Release `entity`'s run back to the free list (recycled by a later
   * same-length {@link alloc}). The freed bytes are left stale in the buffer —
   * nothing draws them because no draw list references the run. No-op if the
   * entity holds no slot.
   */
  free(entity: Entity): void {
    const slot = this.slots.get(entity);
    if (slot === undefined) return;
    this.slots.delete(entity);
    let pool = this.freeRuns.get(slot.len);
    if (pool === undefined) {
      pool = [];
      this.freeRuns.set(slot.len, pool);
    }
    pool.push(slot.first);
    this.liveCount -= slot.len;
    this.freeCount += slot.len;
    this.gen += 1;
  }

  /** Freed-instance fraction of capacity, in `[0, 1)`. Drives compaction policy. */
  fragmentation(): number {
    return this.high === 0 ? 0 : this.freeCount / this.high;
  }

  /**
   * Repack every live run contiguously from instance 0 (in entity-insertion
   * order), invoking `visit` for each run that moves so the owner can relocate
   * its bytes. Clears the free list and resets the high-water mark to the live
   * count. Bumps {@link generation}.
   *
   * Touches O(live runs); use sparingly — only when {@link fragmentation}
   * exceeds a threshold worth the full re-upload it implies.
   */
  compact(visit: SlotMoveVisitor): void {
    if (this.freeCount === 0) return;
    let cursor = 0;
    for (const [entity, slot] of this.slots) {
      if (slot.first !== cursor) {
        const oldFirst = slot.first;
        slot.first = cursor;
        visit(entity, oldFirst, cursor, slot.len);
      }
      cursor += slot.len;
    }
    this.freeRuns.clear();
    this.freeCount = 0;
    this.high = cursor;
    this.gen += 1;
  }

  /** Iterate `(entity, slot)` pairs in entity-insertion order. */
  entries(): IterableIterator<[Entity, Slot]> {
    return this.slots.entries();
  }

  /** Drop all slots and reset to empty. Bumps {@link generation}. */
  clear(): void {
    this.slots.clear();
    this.freeRuns.clear();
    this.high = 0;
    this.liveCount = 0;
    this.freeCount = 0;
    this.gen += 1;
  }
}
