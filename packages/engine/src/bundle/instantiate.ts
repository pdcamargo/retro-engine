import { decodeComponent } from '@retro-engine/reflect';

import { AppTypeRegistry } from '../scene/app-type-registry';
import type { App } from '../index';

import { bundleDecodeEnv } from './bundle-codec';
import type { BundleDefinition } from './bundle-definition';

/**
 * Build fresh component instances from a {@link BundleDefinition}, ready to insert
 * onto an entity (e.g. via `world.insertBundle`). Each call decodes independent
 * instances — no aliasing between two spawns of the same bundle — with the
 * bundle's authored default values applied.
 *
 * A component type the bundle references but the App has not registered is
 * skipped (matching scene deserialization), so a bundle authored against a
 * plugin that is not loaded still yields the components that *are* known.
 */
export const instantiateBundle = (app: App, def: BundleDefinition): object[] => {
  const registry = app.getResource(AppTypeRegistry)!.registry;
  const env = bundleDecodeEnv(app, registry);
  const out: object[] = [];
  for (const value of def.components) {
    const reg = registry.get(value.type);
    if (reg === undefined) continue;
    out.push(decodeComponent(reg, value, env));
  }
  return out;
};
