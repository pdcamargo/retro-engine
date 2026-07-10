import { type App, AppTypeRegistry } from '@retro-engine/engine';
import { vec4 } from '@retro-engine/math';
import {
  Focusable,
  Interactable,
  UiButton,
  UiImage,
  UiNode,
  UiSlider,
  UiText,
  UiTextInput,
  UiToggle,
} from '@retro-engine/ui';

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

/** Whether every constructor in `ctors` is registered (so a bundle can encode). */
const allRegistered = (app: App, ctors: readonly (new (...a: never[]) => object)[]): boolean => {
  const registry = app.getResource(AppTypeRegistry)!.registry;
  return ctors.every((c) => registry.getByCtor(c as never) !== undefined);
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
  // Bundle from pre-configured instances (styled defaults), skipped unless every
  // component type is registered. registerBundle captures the authored values.
  const defI = (
    name: string,
    instances: readonly object[],
    opts: { category?: readonly string[]; description?: string; icon?: string },
  ): void => {
    if (allRegistered(app, instances.map((i) => i.constructor as new (...a: never[]) => object))) {
      app.registerBundle(name, instances, opts);
    }
  };
  // Rendering
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
  def('Point Light', ['PointLight3d'], {
    category: ['Rendering'],
    description: 'Omnidirectional light',
    icon: 'lightbulb',
  });
  def('Mesh Renderer', ['Mesh3d'], {
    category: ['Rendering'],
    description: '3D mesh handle',
    icon: 'box',
  });

  // 2D
  def('Sprite', ['Sprite'], { category: ['2D'], description: '2D textured quad', icon: 'image' });
  def('Animated Sprite', ['Sprite', 'TextureAtlas', 'AtlasAnimation'], {
    category: ['2D'],
    description: 'Sprite driven by an atlas animation',
    icon: 'film',
  });
  def('Text 2D', ['Text2d'], { category: ['2D'], description: 'Screen-space 2D text', icon: 'type' });
  def('2D Point Light', ['PointLight2d'], {
    category: ['2D'],
    description: '2D point light',
    icon: 'lightbulb',
  });

  // UI — styled so they render the moment they're added (a bare UiNode has no
  // background and auto (0) size, so it would be invisible).
  defI(
    'UI Panel',
    [
      new UiNode({
        width: 220,
        height: 130,
        padding: 12,
        backgroundColor: vec4.create(0.16, 0.17, 0.21, 1),
        borderWidth: 1,
        borderColor: vec4.create(0.42, 0.46, 0.56, 1),
      }),
    ],
    { category: ['UI'], description: 'A visible panel box (background + border)', icon: 'layout' },
  );
  defI(
    'UI Text',
    [new UiNode({ padding: 6 }), new UiText({ text: 'Text', fontSize: 20 })],
    { category: ['UI'], description: 'A text label (uses the built-in font)', icon: 'type' },
  );
  defI(
    'UI Image',
    [new UiNode({ width: 100, height: 100, backgroundColor: vec4.create(0.2, 0.2, 0.24, 1) }), new UiImage()],
    { category: ['UI'], description: 'An image box (assign an image in the inspector)', icon: 'image' },
  );
  defI(
    'UI Button',
    [
      new UiNode({
        width: 160,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: vec4.create(0.24, 0.28, 0.42, 1),
      }),
      new UiText({ text: 'Button', fontSize: 18 }),
      new Interactable(),
      new UiButton(),
    ],
    { category: ['UI'], description: 'Clickable, styled button with a label', icon: 'mouse-pointer-click' },
  );
  defI(
    'UI Toggle',
    [new UiNode({ width: 28, height: 28, backgroundColor: vec4.create(0.26, 0.28, 0.34, 1) }), new Interactable(), new UiToggle()],
    { category: ['UI'], description: 'On/off toggle', icon: 'toggle-left' },
  );
  defI(
    'UI Slider',
    [new UiNode({ width: 180, height: 18, backgroundColor: vec4.create(0.26, 0.28, 0.34, 1) }), new Interactable(), new UiSlider()],
    { category: ['UI'], description: 'Draggable value slider', icon: 'sliders-horizontal' },
  );
  defI(
    'UI Text Input',
    [
      new UiNode({
        width: 220,
        height: 34,
        padding: 8,
        justifyContent: 'center',
        backgroundColor: vec4.create(0.1, 0.11, 0.14, 1),
        borderWidth: 1,
        borderColor: vec4.create(0.4, 0.44, 0.55, 1),
      }),
      new UiText({ text: '', fontSize: 16 }),
      new Interactable(),
      new Focusable(),
      new UiTextInput({ placeholder: 'Type…' }),
    ],
    { category: ['UI'], description: 'Editable text field', icon: 'text-cursor-input' },
  );

  // Physics
  def('Rigid Body 2D', ['RigidBody2d', 'Collider2d'], {
    category: ['Physics'],
    description: 'Dynamic 2D body with a collider',
    icon: 'weight',
  });
  def('Rigid Body 3D', ['RigidBody3d', 'Collider3d'], {
    category: ['Physics'],
    description: 'Dynamic 3D body with a collider',
    icon: 'weight',
  });
  def('Static Collider 2D', ['Collider2d'], {
    category: ['Physics'],
    description: 'Immovable 2D collision shape',
    icon: 'box-select',
  });
  def('Static Collider 3D', ['Collider3d'], {
    category: ['Physics'],
    description: 'Immovable 3D collision shape',
    icon: 'box-select',
  });
  def('Character Controller 2D', ['CharacterController2d', 'Collider2d'], {
    category: ['Physics'],
    description: 'Kinematic 2D character + collider',
    icon: 'person-standing',
  });
  def('Character Controller 3D', ['CharacterController3d', 'Collider3d'], {
    category: ['Physics'],
    description: 'Kinematic 3D character + collider',
    icon: 'person-standing',
  });

  // Audio
  def('Audio Source', ['AudioSource'], { category: ['Audio'], description: 'Plays a sound', icon: 'volume-2' });
  def('Audio Listener', ['AudioListener'], {
    category: ['Audio'],
    description: 'The ear of the scene',
    icon: 'ear',
  });
};
