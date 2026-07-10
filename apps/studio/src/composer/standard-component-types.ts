import {
  type App,
  registerLight2dComponents,
  registerSpriteComponents,
  registerTextComponents,
} from '@retro-engine/engine';
import { registerAudioComponents } from '@retro-engine/audio';
import { registerInputComponents } from '@retro-engine/input';
import { registerPhysicsComponents } from '@retro-engine/physics-core';
import { registerUiComponents } from '@retro-engine/ui';

/**
 * Register the reflection schemas for the engine's standard authoring components
 * — UI, physics, audio, input, sprites, 2D lights, and text — against the studio
 * App's type registry, so they always appear in the entity composer and are
 * serializable, regardless of which feature plugins the open project happens to
 * add.
 *
 * This registers the component *types* only; it does not install the feature
 * plugins' systems or render passes. That keeps the editor free of physics
 * simulation, audio playback, and 2D render-graph wiring while authoring, and
 * avoids a conflict with a project that legitimately adds those plugins itself
 * (its plugin `build` re-registers the same constructors, which is idempotent).
 *
 * The 3D rendering components (cameras, meshes, 3D lights, materials, skybox,
 * environment maps, post-processing) are already registered by `CorePlugin` and
 * the studio's viewport plugins, so they are not repeated here.
 */
export const registerStandardComponentTypes = (app: App): void => {
  registerUiComponents(app);
  registerPhysicsComponents(app);
  registerAudioComponents(app);
  registerInputComponents(app);
  registerSpriteComponents(app);
  registerLight2dComponents(app);
  registerTextComponents(app);
};
