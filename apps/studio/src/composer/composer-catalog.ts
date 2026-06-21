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
  Transform: { category: 'Spatial', icon: 'move-3d', desc: 'Position, rotation & scale' },
  Name: { category: 'Spatial', icon: 'tag', desc: 'Human-readable entity name' },
  Parent: { category: 'Spatial', icon: 'workflow', desc: 'Attach under a parent entity' },
  Visibility: { category: 'Spatial', icon: 'eye', desc: 'Render toggle + inheritance' },
  Camera: { category: 'Rendering', icon: 'video', desc: 'Renders the scene into a target' },
  Sprite: { category: 'Rendering', icon: 'image', desc: '2D textured quad' },
  MeshRenderer: { category: 'Rendering', icon: 'box', desc: 'Draws a mesh with a material' },
  Mesh3d: { category: 'Rendering', icon: 'box', desc: '3D mesh handle' },
  Skybox: { category: 'Rendering', icon: 'cloud', desc: 'Environment cube background' },
  EnvironmentMapLight: { category: 'Rendering', icon: 'sun', desc: 'Image-based ambient light' },
  PointLight: { category: 'Rendering', icon: 'lightbulb', desc: 'Omnidirectional light' },
  DirectionalLight: { category: 'Rendering', icon: 'sun', desc: 'Sun-style parallel light' },
  SpotLight: { category: 'Rendering', icon: 'lightbulb', desc: 'Cone light' },
  PerspectiveProjection: { category: 'Rendering', icon: 'triangle', desc: 'Vanishing-point projection' },
  OrthographicProjection: { category: 'Rendering', icon: 'square-dashed', desc: 'Flat projection' },
  RigidBody: { category: 'Physics', icon: 'weight', desc: 'Dynamic physics body' },
  Collider: { category: 'Physics', icon: 'box-select', desc: 'Collision shape' },
  AudioSource: { category: 'Audio', icon: 'volume-2', desc: 'Plays a sound' },
  AudioListener: { category: 'Audio', icon: 'ear', desc: 'The ear of the scene' },
};

/** Icon per category header in the browser. */
export const CATEGORY_ICON: Readonly<Record<string, IconName>> = {
  Spatial: 'move-3d',
  Rendering: 'image',
  Physics: 'box-select',
  Audio: 'volume-2',
  Gameplay: 'gamepad-2',
  Uncategorized: 'blocks',
};

/** Stable display order for category headers; unknown categories sort after these, alphabetically. */
export const CATEGORY_ORDER = ['Spatial', 'Rendering', 'Physics', 'Gameplay', 'Audio', 'Uncategorized'];

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
