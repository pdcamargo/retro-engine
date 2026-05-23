import type { PluginObject } from './plugin';

/**
 * A bundle of plugins surfaced as a single composable unit. Implementations
 * return a fresh {@link PluginGroupBuilder} from `build()`; callers may
 * tweak the builder (`.disable(SomePlugin)`, `.set(SomePlugin, replacement)`)
 * before flushing it into an App via `app.addPlugins(...)`.
 *
 * @example
 * ```ts
 * class DefaultPlugins implements PluginGroup {
 *   build(): PluginGroupBuilder {
 *     return new PluginGroupBuilder()
 *       .add(new LogPlugin())
 *       .add(new TimePlugin())
 *       .add(new InputPlugin());
 *   }
 * }
 *
 * app.addPlugins(new DefaultPlugins());
 * app.addPlugins(new DefaultPlugins().build().disable(LogPlugin));
 * ```
 */
export interface PluginGroup {
  build(): PluginGroupBuilder;
}

/**
 * Ordered plugin list under construction. Built up via `.add(plugin)`,
 * mutated through `.disable<P>(ctor)` and `.set<P>(ctor, replacement)`,
 * then materialised into the final ordered `PluginObject[]` via `.build()`.
 *
 * `.disable` and `.set` match by **class identity** (`new () => P`) — they
 * compare against each entry's `constructor`. This means plugins inside a
 * group must be class instances; function-callback plugins can still be
 * passed directly to `app.addPlugin`, but the group API does not accept
 * them.
 */
export class PluginGroupBuilder {
  private readonly entries: PluginObject[] = [];

  /** Append a plugin to the group, preserving prior order. */
  add(plugin: PluginObject): this {
    this.entries.push(plugin);
    return this;
  }

  /**
   * Remove every plugin in the group whose constructor matches `ctor`.
   * No-op if no entry matches. Matching is by identity (`===`) against
   * each entry's `.constructor`, so subclasses are not removed by a parent
   * `ctor`.
   */
  disable<P extends PluginObject>(ctor: new () => P): this {
    for (let i = this.entries.length - 1; i >= 0; i -= 1) {
      if (this.entries[i]!.constructor === ctor) {
        this.entries.splice(i, 1);
      }
    }
    return this;
  }

  /**
   * Replace every plugin in the group whose constructor matches `ctor`
   * with `replacement`, preserving the original position of the first
   * match. Subsequent matches are removed (a group with two `LogPlugin`
   * instances becomes one `replacement` at the position of the first).
   * Throws if no entry matches — `.set` is for overriding a known plugin,
   * not for adding a new one.
   */
  set<P extends PluginObject>(ctor: new () => P, replacement: P): this {
    let firstMatch = -1;
    for (let i = 0; i < this.entries.length; i += 1) {
      if (this.entries[i]!.constructor === ctor) {
        firstMatch = i;
        break;
      }
    }
    if (firstMatch === -1) {
      throw new Error(
        `PluginGroupBuilder.set: no plugin of type '${ctor.name}' in this group — use .add(...) to insert one`,
      );
    }
    this.entries[firstMatch] = replacement;
    for (let i = this.entries.length - 1; i > firstMatch; i -= 1) {
      if (this.entries[i]!.constructor === ctor) {
        this.entries.splice(i, 1);
      }
    }
    return this;
  }

  /** Materialise the group's ordered plugin list. */
  build(): PluginObject[] {
    return this.entries.slice();
  }
}
