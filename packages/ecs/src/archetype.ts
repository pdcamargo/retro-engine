import type { ComponentType, Entity } from './types';
import { componentId } from './types';

interface RequiresMeta {
  readonly requires?: readonly ComponentType[];
}

/** @internal */
export const archetypeKeyOf = (set: Iterable<ComponentType>): string => {
  const ids: number[] = [];
  for (const c of set) ids.push(componentId(c));
  ids.sort((a, b) => a - b);
  return ids.join(',');
};

/**
 * One row's worth of per-component storage data: the component value and the
 * pair of mutation ticks (when this `(entity, type)` pair was added to its
 * current archetype, when it was last marked changed).
 *
 * `addedTick === changedTick` immediately after add. They diverge when the
 * component is mutated in place (`World.markChanged`) or re-inserted by value
 * without a structural change.
 *
 * @internal
 */
export interface ColumnEntry {
  readonly value: unknown;
  readonly addedTick: number;
  readonly changedTick: number;
}

/**
 * Storage bucket for entities sharing the same component set. Each component
 * type has three parallel columns: the value column, a `changedTick` column
 * (bumped on every mutation through the World surface, including in-place
 * `markChanged`), and an `addedTick` column (bumped only when the component
 * is newly attached to the entity, preserved across archetype transitions).
 *
 * `Added<T>` ⟹ `Changed<T>` by construction: every operation that writes
 * `addedTick` also writes `changedTick` to the same value.
 *
 * @internal
 */
export class Archetype {
  readonly types: readonly ComponentType[];
  readonly typeSet: ReadonlySet<ComponentType>;
  readonly columns: Map<ComponentType, unknown[]>;
  readonly changedTickColumns: Map<ComponentType, number[]>;
  readonly addedTickColumns: Map<ComponentType, number[]>;
  readonly entities: Entity[] = [];

  constructor(types: ReadonlySet<ComponentType>) {
    this.typeSet = types;
    this.types = [...types];
    this.columns = new Map();
    this.changedTickColumns = new Map();
    this.addedTickColumns = new Map();
    for (const t of types) {
      this.columns.set(t, []);
      this.changedTickColumns.set(t, []);
      this.addedTickColumns.set(t, []);
    }
  }

  /**
   * Append a row carrying one {@link ColumnEntry} per type in this archetype.
   * The caller is responsible for supplying an entry for every type — missing
   * entries are a programmer error.
   */
  push(entity: Entity, entries: ReadonlyMap<ComponentType, ColumnEntry>): number {
    const row = this.entities.length;
    this.entities.push(entity);
    for (const t of this.types) {
      const entry = entries.get(t)!;
      this.columns.get(t)!.push(entry.value);
      this.changedTickColumns.get(t)!.push(entry.changedTick);
      this.addedTickColumns.get(t)!.push(entry.addedTick);
    }
    return row;
  }

  /**
   * Swap-remove the row at `row`. Returns the entity that was moved into
   * `row` (or `undefined` if `row` was the last row). The caller must update
   * the moved entity's index entry.
   */
  swapRemove(row: number): Entity | undefined {
    const last = this.entities.length - 1;
    if (row === last) {
      this.entities.pop();
      for (const col of this.columns.values()) col.pop();
      for (const col of this.changedTickColumns.values()) col.pop();
      for (const col of this.addedTickColumns.values()) col.pop();
      return undefined;
    }
    const moved = this.entities[last]!;
    this.entities[row] = moved;
    this.entities.pop();
    for (const col of this.columns.values()) {
      col[row] = col[last]!;
      col.pop();
    }
    for (const col of this.changedTickColumns.values()) {
      col[row] = col[last]!;
      col.pop();
    }
    for (const col of this.addedTickColumns.values()) {
      col[row] = col[last]!;
      col.pop();
    }
    return moved;
  }
}

/**
 * Resolve a bundle of user-provided component instances into the full archetype
 * value map after walking `static requires` transitively. Required dependencies
 * already present in `existing` are not auto-inserted; user-provided values
 * always win when they overlap with Required dependencies.
 *
 * Throws on cycles in the Required graph and on Required targets that cannot
 * be default-constructed.
 *
 * @internal
 */
export const resolveBundle = (
  components: readonly object[],
  existing?: ReadonlySet<ComponentType>,
): Map<ComponentType, unknown> => {
  const userProvided = new Map<ComponentType, object>();
  for (const c of components) {
    userProvided.set(c.constructor as ComponentType, c);
  }

  const out = new Map<ComponentType, unknown>();
  const visiting = new Set<ComponentType>();

  const visit = (ctor: ComponentType): void => {
    if (visiting.has(ctor)) {
      throw new Error(
        `ecs: cycle detected in static \`requires\` graph at component ${ctor.name || '<anonymous>'}`,
      );
    }
    visiting.add(ctor);
    try {
      const requires = (ctor as unknown as RequiresMeta).requires;
      if (!requires) return;
      for (const dep of requires) {
        if (out.has(dep)) continue;
        if (userProvided.has(dep)) {
          visit(dep);
          out.set(dep, userProvided.get(dep)!);
          continue;
        }
        if (existing?.has(dep)) continue;
        let depInstance: object;
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          depInstance = new (dep as any)();
        } catch (err) {
          throw new Error(
            `ecs: required component ${dep.name || '<anonymous>'} (needed by ${ctor.name || '<anonymous>'}) is not default-constructible — ${(err as Error).message}`,
          );
        }
        visit(dep);
        out.set(dep, depInstance);
      }
    } finally {
      visiting.delete(ctor);
    }
  };

  for (const [ctor, value] of userProvided) {
    visit(ctor);
    out.set(ctor, value);
  }

  return out;
};
