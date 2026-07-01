/**
 * The global registry of node categories. A category colors a node's header by
 * what it does (input, math, logic, …). Open like {@link DataTypeRegistry} —
 * consumers add categories so custom nodes read as part of the same family.
 */

/** Describes one node category and its accent color. */
export interface CategoryDescriptor {
  /** Unique category name, e.g. `'math'`, `'input'`. */
  readonly name: string;
  /** Accent color as a CSS hex string; drives header stripe / tint / tick. */
  readonly color: string;
}

/** The built-in node categories (the handoff's category accent map). */
export const BUILTIN_CATEGORIES: readonly CategoryDescriptor[] = [
  { name: 'input', color: '#34e07a' },
  { name: 'math', color: '#38d9f0' },
  { name: 'logic', color: '#ffc233' },
  { name: 'event', color: '#ff5c5c' },
  { name: 'output', color: '#ff5cc8' },
  { name: 'flow', color: '#b9a7ff' },
  { name: 'subgraph', color: '#67a6fb' },
];

/** An open registry of {@link CategoryDescriptor}s, keyed by name. */
export class CategoryRegistry {
  private readonly byName = new Map<string, CategoryDescriptor>();

  register(desc: CategoryDescriptor): this {
    this.byName.set(desc.name, desc);
    return this;
  }

  get(name: string): CategoryDescriptor | undefined {
    return this.byName.get(name);
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }

  list(): readonly CategoryDescriptor[] {
    return [...this.byName.values()];
  }
}
