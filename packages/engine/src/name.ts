/**
 * Human-readable name attached to an entity. A plain value component with no
 * required companions and no engine-core reader — it exists purely to be
 * queried by consumer code that needs to identify or look entities up by name
 * (for example, finding a specific node or bone within an imported model
 * hierarchy).
 *
 * @example
 * ```ts
 * import { Name } from '@retro-engine/engine';
 * const e = world.spawn(new Name('eye'));
 * ```
 */
export class Name {
  /** The entity's name. */
  value: string;

  constructor(value: string = '') {
    this.value = value;
  }
}
