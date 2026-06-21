import { type App, AppTypeRegistry } from '@retro-engine/engine';

/**
 * Construct default instances for `names` via the type registry, or `null` if any
 * is not registered (so a bundle silently skips when its plugin isn't present).
 */
const build = (app: App, names: readonly string[]): object[] | null => {
  const registry = app.getResource(AppTypeRegistry)!.registry;
  const out: object[] = [];
  for (const name of names) {
    const reg = registry.get(name);
    if (reg === undefined) return null;
    out.push(reg.make());
  }
  return out;
};

/**
 * Register the editor's built-in bundles — convenience presets (a working
 * camera, a light, a mesh renderer) that appear in the composer's Bundles tab.
 * Code-defined via {@link App.registerBundle}; each is skipped if the components
 * it needs aren't registered in this session. Call after all plugins have built.
 */
export const registerDefaultBundles = (app: App): void => {
  const def = (
    name: string,
    names: readonly string[],
    opts: { category?: readonly string[]; description?: string; icon?: string },
  ): void => {
    const components = build(app, names);
    if (components !== null) app.registerBundle(name, components, opts);
  };
  def('Camera 3D', ['Camera', 'PerspectiveProjection'], {
    category: ['Rendering'],
    description: 'Perspective 3D camera',
    icon: 'video',
  });
  def('Camera 2D', ['Camera', 'OrthographicProjection'], {
    category: ['Rendering'],
    description: 'Orthographic 2D camera',
    icon: 'video',
  });
  def('Directional Light', ['DirectionalLight3d'], {
    category: ['Rendering'],
    description: 'Sun-style parallel light',
    icon: 'sun',
  });
  def('Point Light', ['PointLight'], {
    category: ['Rendering'],
    description: 'Omnidirectional light',
    icon: 'lightbulb',
  });
  def('Mesh Renderer', ['Mesh3d'], {
    category: ['Rendering'],
    description: '3D mesh + transform',
    icon: 'box',
  });
};
