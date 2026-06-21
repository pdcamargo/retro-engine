import type { BundleDefinition } from './bundle-definition';

/**
 * The {@link BundleDefinition}s known to an {@link import('../index').App}, keyed
 * by name, held as an App resource.
 *
 * Mirrors {@link import('../scene/app-type-registry').AppTypeRegistry}: each App
 * owns its own bundle registry. Code-defined bundles are registered from a
 * plugin's `build()` (via `App.registerBundle`); user-authored bundle assets are
 * registered as they load. Tooling reads it to list bundles alongside
 * components.
 */
export class AppBundleRegistry {
  private readonly byName = new Map<string, BundleDefinition>();

  /** Register `def`, replacing any existing bundle with the same name. */
  register(def: BundleDefinition): void {
    this.byName.set(def.name, def);
  }

  /** Look up a bundle by name, or `undefined` if none is registered. */
  get(name: string): BundleDefinition | undefined {
    return this.byName.get(name);
  }

  /** Whether a bundle with `name` is registered. */
  has(name: string): boolean {
    return this.byName.has(name);
  }

  /** Remove the bundle named `name`; returns whether one was present. */
  remove(name: string): boolean {
    return this.byName.delete(name);
  }

  /** Every registered bundle, in insertion order. */
  all(): readonly BundleDefinition[] {
    return [...this.byName.values()];
  }
}
