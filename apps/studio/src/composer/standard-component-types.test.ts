// Proves the standard authoring component types (UI, physics, audio, input,
// sprites, 2D lights, text) land in the composer catalog, categorized, once the
// studio registers them — and that the default bundles that depend on them
// resolve. This is the headless proof of the "components missing from the entity
// composer" fix; the studio GUI reads the same catalog.
import { describe, expect, it } from 'bun:test';
import { App, AppBundleRegistry, Light3dPlugin } from '@retro-engine/engine';
import { createWebGPURenderer } from '@retro-engine/renderer-webgpu';

import { buildComposerCatalog } from './composer-catalog';
import { registerDefaultBundles } from './default-bundles';
import { registerStandardComponentTypes } from './standard-component-types';

// Mirror the studio's edit App: CorePlugin (auto) + the 3D-light plugin (added by
// scene-bootstrap, and the owner of PointLight3d / DirectionalLight3d / SpotLight3d)
// + the standard authoring types this module registers.
const newApp = (): App => {
  const app = new App({ renderer: createWebGPURenderer({} as HTMLCanvasElement) });
  app.addPlugin(new Light3dPlugin());
  registerStandardComponentTypes(app);
  registerDefaultBundles(app);
  return app;
};

describe('registerStandardComponentTypes', () => {
  it('surfaces the feature-package components in the composer catalog', () => {
    const catalog = buildComposerCatalog(newApp());
    const expected = [
      'UiNode',
      'UiButton',
      'UiTextInput',
      'RigidBody2d',
      'RigidBody3d',
      'Collider3d',
      'CharacterController3d',
      'Joint3d',
      'AudioSource',
      'AudioListener',
      'ActionMap',
      'Sprite',
      'PointLight2d',
      'Text2d',
      'UiCamera',
    ];
    for (const name of expected) {
      expect(catalog.byName.has(name)).toBe(true);
    }
  });

  it('categorizes every registered component (nothing lands in Uncategorized)', () => {
    const catalog = buildComposerCatalog(newApp());
    const uncategorized = catalog.components.filter((c) => c.category === 'Uncategorized');
    expect(uncategorized.map((c) => c.name)).toEqual([]);
  });

  it('assigns the expected categories', () => {
    const catalog = buildComposerCatalog(newApp());
    const categoryOf = (name: string): string | undefined => catalog.byName.get(name)?.category;
    expect(categoryOf('UiButton')).toBe('UI');
    expect(categoryOf('RigidBody2d')).toBe('Physics');
    expect(categoryOf('AudioSource')).toBe('Audio');
    expect(categoryOf('ActionMap')).toBe('Input');
    expect(categoryOf('Sprite')).toBe('2D');
    expect(categoryOf('PointLight2d')).toBe('2D');
  });

  it('registers the 3D lights under their real (dimension-suffixed) names', () => {
    const catalog = buildComposerCatalog(newApp());
    // Regression: the catalog previously keyed metadata on stale names
    // (PointLight / DirectionalLight / SpotLight), leaving the real components
    // uncategorized.
    expect(catalog.byName.has('PointLight3d')).toBe(true);
    expect(catalog.byName.has('PointLight')).toBe(false);
    expect(catalog.byName.get('DirectionalLight3d')?.category).toBe('Rendering');
  });

  it('makes the feature bundles available with resolvable components', () => {
    const app = newApp();
    const bundles = app.getResource(AppBundleRegistry)!.all();
    const byName = new Map(bundles.map((b) => [b.name, b]));
    for (const name of ['UI Button', 'Rigid Body 2D', 'Sprite', 'Audio Source', 'Point Light']) {
      expect(byName.has(name)).toBe(true);
    }
    // Every bundle component references a type that is actually registered.
    const catalog = buildComposerCatalog(app);
    for (const bundle of bundles) {
      for (const comp of bundle.components) {
        expect(catalog.byName.has(comp.type)).toBe(true);
      }
    }
  });
});
