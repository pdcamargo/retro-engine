import {
  type App,
  AppBundleRegistry,
  AppTypeRegistry,
  type BundleDefinition,
} from '@retro-engine/engine';
import type { IconName } from '@retro-engine/editor-sdk';
import type { RegisteredType, TypeRegistry } from '@retro-engine/reflect';

/**
 * Editor-side presentation for a component type: which category it lives under,
 * its row icon, and a one-line description. Keyed by the component's stable
 * reflection name. Anything unlisted falls back to the "Uncategorized" bucket —
 * the composer still lists every registered, attachable component.
 */
interface ComponentMeta {
  readonly category?: string;
  readonly icon?: IconName;
  readonly desc?: string;
}

const COMPONENT_META: Readonly<Record<string, ComponentMeta>> = {
  // Spatial
  Transform: { category: 'Spatial', icon: 'move-3d', desc: 'Position, rotation & scale' },
  Name: { category: 'Spatial', icon: 'tag', desc: 'Human-readable entity name' },
  Parent: { category: 'Spatial', icon: 'workflow', desc: 'Attach under a parent entity' },
  Visibility: { category: 'Spatial', icon: 'eye', desc: 'Render toggle + inheritance' },

  // Rendering (3D + shared)
  Camera: { category: 'Rendering', icon: 'video', desc: 'Renders the scene into a target' },
  MainCamera: { category: 'Rendering', icon: 'video', desc: 'Marks the primary game camera' },
  PerspectiveProjection: { category: 'Rendering', icon: 'triangle', desc: 'Vanishing-point projection' },
  OrthographicProjection: { category: 'Rendering', icon: 'square-dashed', desc: 'Flat projection' },
  Mesh3d: { category: 'Rendering', icon: 'box', desc: '3D mesh handle' },
  'MeshMaterial3d<StandardMaterial>': { category: 'Rendering', icon: 'palette', desc: 'Standard PBR material' },
  Skybox: { category: 'Rendering', icon: 'cloud', desc: 'Environment cube background' },
  EnvironmentMapLight: { category: 'Rendering', icon: 'aperture', desc: 'Image-based ambient light' },
  AmbientLight: { category: 'Rendering', icon: 'sun-dim', desc: 'Uniform scene fill light' },
  PointLight3d: { category: 'Rendering', icon: 'lightbulb', desc: 'Omnidirectional light' },
  DirectionalLight3d: { category: 'Rendering', icon: 'sun', desc: 'Sun-style parallel light' },
  SpotLight3d: { category: 'Rendering', icon: 'flashlight', desc: 'Cone light' },
  CascadeShadowConfig: { category: 'Rendering', icon: 'layers', desc: 'Cascaded shadow map tuning' },
  Shadow3dSettings: { category: 'Rendering', icon: 'layers', desc: 'Shadow rendering settings' },
  ClearColor: { category: 'Rendering', icon: 'palette', desc: 'Per-camera background color' },
  RenderLayers: { category: 'Rendering', icon: 'layers', desc: 'Visibility / render layer mask' },
  Tonemapping: { category: 'Rendering', icon: 'contrast', desc: 'HDR → LDR tone mapping' },
  Taa: { category: 'Rendering', icon: 'aperture', desc: 'Temporal anti-aliasing' },
  MotionBlur: { category: 'Rendering', icon: 'wind', desc: 'Per-object motion blur' },
  ScreenSpaceAo: { category: 'Rendering', icon: 'circle-dot', desc: 'Screen-space ambient occlusion' },
  DepthPrepass: { category: 'Rendering', icon: 'layers', desc: 'Write depth before opaque' },
  NormalPrepass: { category: 'Rendering', icon: 'layers', desc: 'Write view normals prepass' },
  MotionVectorPrepass: { category: 'Rendering', icon: 'wind', desc: 'Write motion vectors prepass' },
  NotShadowCaster: { category: 'Rendering', icon: 'eye-off', desc: 'Exclude from shadow casting' },
  NoFrustumCulling: { category: 'Rendering', icon: 'maximize', desc: 'Never frustum-cull this entity' },
  Text: { category: 'Rendering', icon: 'type', desc: 'World-space 3D text' },
  GltfSceneRoot: { category: 'Rendering', icon: 'box', desc: 'Instantiates a glTF scene here' },

  // Animation
  AnimationPlayer: { category: 'Animation', icon: 'film', desc: 'Plays animation clips' },
  AnimationControllerPlayer: { category: 'Animation', icon: 'film', desc: 'Drives an animation graph' },
  AnimationLayers: { category: 'Animation', icon: 'layers', desc: 'Blended animation layers' },
  AnimationTarget: { category: 'Animation', icon: 'bone', desc: 'Animation retarget binding' },
  Skeleton: { category: 'Animation', icon: 'bone', desc: 'Skinned mesh skeleton' },
  MorphWeights: { category: 'Animation', icon: 'sliders-horizontal', desc: 'Morph-target weights' },
  IkChain: { category: 'Animation', icon: 'spline', desc: 'Inverse-kinematics chain' },
  TwoBoneIK: { category: 'Animation', icon: 'spline', desc: 'Two-bone IK solver' },
  LookAtConstraint: { category: 'Animation', icon: 'eye', desc: 'Aim a bone at a target' },

  // 2D
  Mesh2d: { category: '2D', icon: 'box', desc: '2D mesh handle' },
  Sprite: { category: '2D', icon: 'image', desc: '2D textured quad' },
  TextureAtlas: { category: '2D', icon: 'grid-2x2', desc: 'Sprite sheet frame index' },
  AtlasAnimation: { category: '2D', icon: 'film', desc: 'Animate atlas frames over time' },
  Text2d: { category: '2D', icon: 'type', desc: 'Screen-space 2D text' },
  PointLight2d: { category: '2D', icon: 'lightbulb', desc: '2D point light' },
  SpotLight2d: { category: '2D', icon: 'flashlight', desc: '2D spot light' },
  DirectionalLight2d: { category: '2D', icon: 'sun', desc: '2D directional light' },
  AmbientLight2d: { category: '2D', icon: 'sun-dim', desc: '2D ambient light pool' },
  LightOccluder2d: { category: '2D', icon: 'square', desc: 'Casts 2D shadows' },

  // UI
  UiNode: { category: 'UI', icon: 'layout', desc: 'Flex/grid layout box' },
  UiText: { category: 'UI', icon: 'type', desc: 'UI text label' },
  UiImage: { category: 'UI', icon: 'image', desc: 'UI image / sprite' },
  UiClass: { category: 'UI', icon: 'braces', desc: 'Applies .rss style classes' },
  UiButton: { category: 'UI', icon: 'mouse-pointer-click', desc: 'Clickable button styling' },
  UiToggle: { category: 'UI', icon: 'toggle-left', desc: 'On/off toggle' },
  UiSlider: { category: 'UI', icon: 'sliders-horizontal', desc: 'Draggable value slider' },
  UiTextInput: { category: 'UI', icon: 'text-cursor-input', desc: 'Editable text field' },
  Interactable: { category: 'UI', icon: 'pointer', desc: 'Receives pointer interaction' },
  Disabled: { category: 'UI', icon: 'ban', desc: 'Disables interaction' },
  Focusable: { category: 'UI', icon: 'focus', desc: 'Keyboard/gamepad focusable' },
  DiagnosticsText: { category: 'UI', icon: 'activity', desc: 'Live diagnostics overlay text' },
  UiCamera: { category: 'UI', icon: 'panel-top', desc: 'Renders the UI into this camera' },

  // Physics
  RigidBody2d: { category: 'Physics', icon: 'weight', desc: '2D dynamic physics body' },
  RigidBody3d: { category: 'Physics', icon: 'weight', desc: '3D dynamic physics body' },
  Collider2d: { category: 'Physics', icon: 'box-select', desc: '2D collision shape' },
  Collider3d: { category: 'Physics', icon: 'box-select', desc: '3D collision shape' },
  LinearVelocity2d: { category: 'Physics', icon: 'move', desc: '2D linear velocity' },
  LinearVelocity3d: { category: 'Physics', icon: 'move', desc: '3D linear velocity' },
  AngularVelocity2d: { category: 'Physics', icon: 'rotate-cw', desc: '2D angular velocity' },
  AngularVelocity3d: { category: 'Physics', icon: 'rotate-cw', desc: '3D angular velocity' },
  ExternalForce2d: { category: 'Physics', icon: 'wind', desc: '2D applied force' },
  ExternalForce3d: { category: 'Physics', icon: 'wind', desc: '3D applied force' },
  Restitution: { category: 'Physics', icon: 'arrow-up-down', desc: 'Bounciness coefficient' },
  Friction: { category: 'Physics', icon: 'grip-horizontal', desc: 'Surface friction coefficient' },
  GravityScale: { category: 'Physics', icon: 'arrow-down', desc: 'Per-body gravity multiplier' },
  Sensor: { category: 'Physics', icon: 'radar', desc: 'Overlap-only (no collision response)' },
  CharacterController2d: { category: 'Physics', icon: 'person-standing', desc: '2D kinematic character' },
  CharacterController3d: { category: 'Physics', icon: 'person-standing', desc: '3D kinematic character' },
  Joint2d: { category: 'Physics', icon: 'link', desc: '2D physics joint' },
  Joint3d: { category: 'Physics', icon: 'link', desc: '3D physics joint' },

  // Input
  ActionMap: { category: 'Input', icon: 'gamepad-2', desc: 'Named input action bindings' },

  // Audio
  AudioSource: { category: 'Audio', icon: 'volume-2', desc: 'Plays a sound' },
  AudioListener: { category: 'Audio', icon: 'ear', desc: 'The ear of the scene' },
};

/** Icon per category header in the browser. */
export const CATEGORY_ICON: Readonly<Record<string, IconName>> = {
  Spatial: 'move-3d',
  Rendering: 'image',
  Animation: 'film',
  '2D': 'layers',
  UI: 'layout',
  Physics: 'box-select',
  Input: 'gamepad-2',
  Audio: 'volume-2',
  Gameplay: 'joystick',
  Uncategorized: 'blocks',
};

/** Stable display order for category headers; unknown categories sort after these, alphabetically. */
export const CATEGORY_ORDER = [
  'Spatial',
  'Rendering',
  'Animation',
  '2D',
  'UI',
  'Physics',
  'Input',
  'Audio',
  'Gameplay',
  'Uncategorized',
];

/**
 * A conflict group: more than one of `members` (by component name) ending up on
 * one entity raises `message` as a warning (never a hard block). Editor-side
 * metadata — the engine has no conflict concept; a group only ever fires for
 * members that are actually registered.
 */
export interface ConflictDef {
  readonly group: string;
  readonly members: readonly string[];
  readonly message: string;
}

const CONFLICTS: readonly ConflictDef[] = [
  {
    group: 'projection',
    members: ['OrthographicProjection', 'PerspectiveProjection'],
    message: 'One projection per camera - pick orthographic or perspective.',
  },
  {
    group: 'rigid-body-dimension',
    members: ['RigidBody2d', 'RigidBody3d'],
    message: 'Mixing a 2D and 3D rigid body on one entity - pick one dimension.',
  },
  {
    group: 'collider-dimension',
    members: ['Collider2d', 'Collider3d'],
    message: 'Mixing a 2D and 3D collider on one entity - pick one dimension.',
  },
];

/** One addable component, resolved from the live registry plus editor metadata. */
export interface CatalogComponent {
  readonly reg: RegisteredType;
  readonly name: string;
  readonly category: string;
  readonly icon: IconName;
  readonly desc?: string | undefined;
  /** Component names this type pulls in via `static requires` (transitive resolution happens at commit). */
  readonly requires: readonly string[];
  /** Conflict-group key, when this type participates in one. */
  readonly conflict?: string | undefined;
}

/** One addable bundle, resolved from the bundle registry. */
export interface CatalogBundle {
  readonly def: BundleDefinition;
  readonly name: string;
  readonly icon: IconName;
  readonly desc?: string | undefined;
  /** The component type names the bundle contributes, in order. */
  readonly comps: readonly string[];
}

/** The composer's data: addable components + bundles + the conflict table, from live state. */
export interface ComposerCatalog {
  readonly components: readonly CatalogComponent[];
  readonly bundles: readonly CatalogBundle[];
  readonly byName: ReadonlyMap<string, CatalogComponent>;
  readonly conflicts: readonly ConflictDef[];
}

/** The component names in `ctor`'s `static requires`, mapped through the registry to stable names. */
const requiresOf = (reg: RegisteredType, registry: TypeRegistry): string[] => {
  const raw = (reg.ctor as { requires?: readonly (new (...a: never[]) => object)[] }).requires;
  if (raw === undefined) return [];
  const names: string[] = [];
  for (const dep of raw) {
    const depReg = registry.getByCtor(dep as never);
    if (depReg !== undefined) names.push(depReg.name);
  }
  return names;
};

const memberToConflict = (() => {
  const map = new Map<string, string>();
  for (const c of CONFLICTS) for (const m of c.members) map.set(m, c.group);
  return map;
})();

/** Build the composer catalog from the App's component + bundle registries. */
export const buildComposerCatalog = (app: App): ComposerCatalog => {
  const registry = app.getResource(AppTypeRegistry)!.registry;
  const components: CatalogComponent[] = [];
  const byName = new Map<string, CatalogComponent>();
  for (const reg of registry.components()) {
    if (!reg.attachable) continue;
    // The entity name is set through the composer's NAME field, and parenting is
    // done in the hierarchy — neither belongs in the component picker.
    if (reg.name === 'Name' || reg.name === 'Parent') continue;
    const meta = COMPONENT_META[reg.name];
    const item: CatalogComponent = {
      reg,
      name: reg.name,
      category: meta?.category ?? 'Uncategorized',
      icon: meta?.icon ?? 'component',
      desc: meta?.desc,
      requires: requiresOf(reg, registry),
      conflict: memberToConflict.get(reg.name),
    };
    components.push(item);
    byName.set(item.name, item);
  }
  components.sort((a, b) => a.name.localeCompare(b.name));

  const bundles: CatalogBundle[] = [];
  const bundleReg = app.getResource(AppBundleRegistry);
  if (bundleReg !== undefined) {
    for (const def of bundleReg.all()) {
      bundles.push({
        def,
        name: def.name,
        icon: (def.icon ?? 'package') as IconName,
        desc: def.description,
        comps: def.components.map((c) => c.type),
      });
    }
    bundles.sort((a, b) => a.name.localeCompare(b.name));
  }

  return { components, bundles, byName, conflicts: CONFLICTS };
};
