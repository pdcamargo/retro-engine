import { type App, AppTypeRegistry, type BundleDefinition, instantiateBundle } from '@retro-engine/engine';
import type { Entity } from '@retro-engine/ecs';
import type { RegisteredType } from '@retro-engine/reflect';

import type { CatalogComponent, ComposerCatalog } from './composer-catalog';
import { CATEGORY_ORDER } from './composer-catalog';

/** Which job the composer is doing this session. */
export type ComposerMode = 'create' | 'add' | 'bundle';

/** Favorites/recent are keyed across the two namespaces so a component and a bundle never collide. */
export const componentKey = (name: string): string => `c:${name}`;
export const bundleKey = (name: string): string => `b:${name}`;

/**
 * The composer's live state while the modal is open. Selection sets, per-type
 * draft instances (the editable starting values), and the disclosure/UI bits.
 * Favorites and recents persist across sessions; everything else resets per open.
 */
export interface ComposerState {
  open: boolean;
  mode: ComposerMode;
  tab: 'components' | 'bundles';
  search: string;

  /** Create mode: the new entity's name. */
  entityName: string;
  /** Add mode: the entity being modified. */
  targetEntity: Entity | null;
  /** Bundle mode: the bundle's name and (when editing an existing asset) its identity. */
  bundleName: string;
  bundleAssetGuid: string | null;
  bundleAssetLocation: string | null;

  /** À-la-carte component names the user ticked. */
  readonly selected: Set<string>;
  /** Bundle names toggled on. */
  readonly activeBundles: Set<string>;
  /** Per-component-type draft instance holding its starting values (shared across origins). */
  readonly drafts: Map<string, object>;
  /** Component rows whose override form is expanded. */
  readonly expanded: Set<string>;
  /** Bundle groups collapsed in the composition pane. */
  readonly bundleCollapsed: Set<string>;

  /** Pinned rail entries, keyed `c:<name>` / `b:<name>`. */
  readonly favorites: Set<string>;
  /** Recently added rail entries, most-recent first, keyed like favorites. */
  recent: string[];
}

/** A fresh composer state (closed, create mode, empty selection). */
export const createComposerState = (): ComposerState => ({
  open: false,
  mode: 'create',
  tab: 'components',
  search: '',
  entityName: 'New Entity',
  targetEntity: null,
  bundleName: 'New Bundle',
  bundleAssetGuid: null,
  bundleAssetLocation: null,
  selected: new Set(),
  activeBundles: new Set(),
  drafts: new Map(),
  expanded: new Set(),
  bundleCollapsed: new Set(),
  favorites: new Set(),
  recent: [],
});

/** Options for {@link openComposer}. */
export interface OpenComposerOptions {
  /** Add mode: the entity to modify. */
  readonly target?: Entity | null;
  /** Create mode: seed the name field. */
  readonly entityName?: string;
  /** Bundle mode: the bundle's name and (when editing) asset identity. */
  readonly bundleName?: string;
  readonly bundleGuid?: string | null;
  readonly bundleLocation?: string | null;
}

/**
 * Open the composer in `mode`, clearing the per-session selection/drafts while
 * preserving persisted favorites and recents.
 */
export const openComposer = (composer: ComposerState, mode: ComposerMode, opts: OpenComposerOptions = {}): void => {
  composer.open = true;
  composer.mode = mode;
  composer.tab = 'components';
  composer.search = '';
  composer.selected.clear();
  composer.activeBundles.clear();
  composer.drafts.clear();
  composer.expanded.clear();
  composer.bundleCollapsed.clear();
  composer.targetEntity = opts.target ?? null;
  composer.entityName = opts.entityName ?? 'New Entity';
  composer.bundleName = opts.bundleName ?? 'New Bundle';
  composer.bundleAssetGuid = opts.bundleGuid ?? null;
  composer.bundleAssetLocation = opts.bundleLocation ?? null;
};

/**
 * Open the composer in bundle mode pre-loaded from an existing bundle: its
 * components become the selection and its stored values seed their drafts, so
 * the user edits the bundle in place and saves back to the same asset.
 */
export const loadBundleIntoComposer = (
  app: App,
  composer: ComposerState,
  def: BundleDefinition,
  opts: { guid?: string | null; location?: string | null } = {},
): void => {
  openComposer(composer, 'bundle', {
    bundleName: def.name,
    bundleGuid: opts.guid ?? null,
    bundleLocation: opts.location ?? null,
  });
  const registry = app.getResource(AppTypeRegistry)!.registry;
  for (const inst of instantiateBundle(app, def)) {
    const reg = registry.getByCtor((inst as { constructor: never }).constructor);
    if (reg === undefined) continue;
    composer.selected.add(reg.name);
    composer.drafts.set(reg.name, inst);
  }
};

const FAV_KEY = 'retro-studio.composer.favorites';
const REC_KEY = 'retro-studio.composer.recent';

/** Load persisted favorites + recents into `composer` (no-op without `localStorage`). */
export const loadComposerPrefs = (composer: ComposerState): void => {
  try {
    const store = (globalThis as { localStorage?: Storage }).localStorage;
    if (store === undefined) return;
    const favs = store.getItem(FAV_KEY);
    if (favs !== null) for (const k of JSON.parse(favs) as string[]) composer.favorites.add(k);
    const recents = store.getItem(REC_KEY);
    if (recents !== null) composer.recent = JSON.parse(recents) as string[];
  } catch {
    /* prefs are best-effort */
  }
};

/** Persist favorites + recents (no-op without `localStorage`). */
export const saveComposerPrefs = (composer: ComposerState): void => {
  try {
    const store = (globalThis as { localStorage?: Storage }).localStorage;
    if (store === undefined) return;
    store.setItem(FAV_KEY, JSON.stringify([...composer.favorites]));
    store.setItem(REC_KEY, JSON.stringify(composer.recent));
  } catch {
    /* prefs are best-effort */
  }
};

/** One row in the composition pane: a component to add, tagged with where it came from. */
export interface CompositionEntry {
  readonly name: string;
  readonly reg: RegisteredType;
  readonly origin: 'selected' | 'bundle' | 'auto';
  /** Bundle that delivered this component (origin `bundle`). */
  readonly bundleName?: string;
  /** The component that pulled this one in (origin `auto`). */
  readonly requiredBy?: string;
  /** Already on the target entity (add mode) — shown dimmed, not re-added. */
  readonly onEntity: boolean;
}

/** One collapsible bundle card in the composition pane. */
export interface BundleGroup {
  readonly bundleName: string;
  readonly members: readonly CompositionEntry[];
}

/** The resolved result of the current selection — what the commit will actually do. */
export interface Composition {
  /** Existing components on the target (add mode), dimmed + read-only. */
  readonly onEntity: readonly string[];
  /** One card per active bundle, listing its members. */
  readonly bundleGroups: readonly BundleGroup[];
  /** Individually-selected components not delivered by a bundle and not on the entity. */
  readonly loose: readonly CompositionEntry[];
  /** Auto-required components not delivered by a bundle and not on the entity. */
  readonly auto: readonly CompositionEntry[];
  /** Conflict messages for groups with >1 member present. */
  readonly conflicts: readonly string[];
  /** Every NEW component name (bundle ∪ loose ∪ auto), in catalog order — the commit set. */
  readonly newNames: readonly string[];
}

/**
 * Transitively expand `static requires`: every component pulled in (directly,
 * via a bundle, or by another requirer) that is neither already chosen nor on
 * the entity is auto-added. Returns each auto name → the label that required it.
 */
export const expandAutoRequired = (
  coreNames: Iterable<string>,
  existing: ReadonlySet<string>,
  catalog: ComposerCatalog,
): Map<string, string> => {
  const have = new Set<string>([...coreNames, ...existing]);
  const auto = new Map<string, string>();
  const queue = [...coreNames];
  while (queue.length > 0) {
    const name = queue.shift()!;
    const item = catalog.byName.get(name);
    if (item === undefined) continue;
    for (const req of item.requires) {
      if (have.has(req)) continue;
      have.add(req);
      auto.set(req, name);
      queue.push(req);
    }
  }
  return auto;
};

const categoryRank = (cat: string): number => {
  const i = CATEGORY_ORDER.indexOf(cat);
  return i === -1 ? CATEGORY_ORDER.length : i;
};

/** Resolve the full composition from the current selection against the catalog. */
export const deriveComposition = (
  state: ComposerState,
  catalog: ComposerCatalog,
  existingOnEntity: ReadonlySet<string>,
): Composition => {
  // The first active bundle to include a component owns its group placement.
  const bundleOf = new Map<string, string>();
  const activeBundleDefs = catalog.bundles.filter((b) => state.activeBundles.has(b.name));
  for (const b of activeBundleDefs) {
    for (const comp of b.comps) if (!bundleOf.has(comp)) bundleOf.set(comp, b.name);
  }

  const core = new Set<string>();
  for (const name of state.selected) if (!existingOnEntity.has(name)) core.add(name);
  for (const name of bundleOf.keys()) if (!existingOnEntity.has(name)) core.add(name);

  const auto = expandAutoRequired(core, existingOnEntity, catalog);

  const newNames = [...core, ...auto.keys()].filter((n) => catalog.byName.has(n));
  newNames.sort((a, b) => {
    const ra = categoryRank(catalog.byName.get(a)!.category);
    const rb = categoryRank(catalog.byName.get(b)!.category);
    return ra !== rb ? ra - rb : a.localeCompare(b);
  });

  const makeEntry = (name: string): CompositionEntry | undefined => {
    const item = catalog.byName.get(name);
    if (item === undefined) return undefined;
    const onEntity = existingOnEntity.has(name);
    if (bundleOf.has(name)) {
      return { name, reg: item.reg, origin: 'bundle', bundleName: bundleOf.get(name)!, onEntity };
    }
    if (state.selected.has(name)) return { name, reg: item.reg, origin: 'selected', onEntity };
    const requiredBy = auto.get(name);
    return {
      name,
      reg: item.reg,
      origin: 'auto',
      onEntity,
      ...(requiredBy !== undefined ? { requiredBy } : {}),
    };
  };

  // Bundle groups list each member, marking on-entity ones. A component shared by
  // two active bundles is listed only under the first that owns it (per `bundleOf`),
  // so there is never a duplicate row for one component type.
  const bundleGroups: BundleGroup[] = activeBundleDefs.map((b) => ({
    bundleName: b.name,
    members: b.comps
      .filter((name) => bundleOf.get(name) === b.name)
      .map((name): CompositionEntry | undefined => {
        const item = catalog.byName.get(name);
        if (item === undefined) return undefined;
        return {
          name,
          reg: item.reg,
          origin: 'bundle',
          bundleName: b.name,
          onEntity: existingOnEntity.has(name),
        };
      })
      .filter((e): e is CompositionEntry => e !== undefined),
  }));

  const loose: CompositionEntry[] = [];
  const autoEntries: CompositionEntry[] = [];
  for (const name of newNames) {
    if (bundleOf.has(name)) continue; // shown under its bundle group
    const entry = makeEntry(name);
    if (entry === undefined) continue;
    if (entry.origin === 'auto') autoEntries.push(entry);
    else loose.push(entry);
  }

  // Conflicts: >1 member of a group in (existing ∪ newSet).
  const present = new Set<string>([...existingOnEntity, ...newNames]);
  const conflicts: string[] = [];
  for (const c of catalog.conflicts) {
    const hits = c.members.filter((m) => present.has(m)).length;
    if (hits > 1) conflicts.push(c.message);
  }

  return { onEntity: [...existingOnEntity], bundleGroups, loose, auto: autoEntries, conflicts, newNames };
};

/**
 * Reconcile `state.drafts` with the resolved composition: create a draft instance
 * for every new component that lacks one (bundle members seeded from the bundle's
 * stored defaults, others from the type's `make()`), and drop drafts for
 * components no longer in the composition. Draft edits therefore persist as the
 * user toggles unrelated items.
 */
export const ensureDrafts = (
  app: App,
  state: ComposerState,
  catalog: ComposerCatalog,
  composition: Composition,
): void => {
  const registry = app.getResource(AppTypeRegistry)!.registry;
  const needed = new Set(composition.newNames);

  for (const name of state.drafts.keys()) {
    if (!needed.has(name)) state.drafts.delete(name);
  }

  // Decode each active bundle once so seeded drafts carry the bundle's defaults.
  const bundleSeeds = new Map<string, object>();
  for (const group of composition.bundleGroups) {
    const bundle = catalog.bundles.find((b) => b.name === group.bundleName);
    if (bundle === undefined) continue;
    for (const inst of instantiateBundle(app, bundle.def)) {
      const reg = registry.getByCtor((inst as { constructor: never }).constructor);
      if (reg !== undefined && !bundleSeeds.has(reg.name)) bundleSeeds.set(reg.name, inst);
    }
  }

  for (const name of needed) {
    if (state.drafts.has(name)) continue;
    const seeded = bundleSeeds.get(name);
    if (seeded !== undefined) {
      state.drafts.set(name, seeded);
      continue;
    }
    const item = catalog.byName.get(name);
    if (item !== undefined) state.drafts.set(name, item.reg.make());
  }
};

/** Push `key` onto the recent list (front, de-duplicated, capped at 6). */
export const pushRecent = (state: ComposerState, key: string): void => {
  state.recent = [key, ...state.recent.filter((k) => k !== key)].slice(0, 6);
};

/**
 * Field kinds whose value can't be meaningfully diffed against a fresh `make()`
 * (a handle / entity ref / nested instance is a new object each construction), so
 * they never count as an override.
 */
const NON_OVERRIDABLE = new Set(['handle', 'entity', 'type', 'mat4']);

/** Whether any field of `instance` differs from the type's default (drives the override dot). */
export const isComponentOverridden = (item: CatalogComponent, instance: object): boolean => {
  const fresh = item.reg.make() as Record<string, unknown>;
  const inst = instance as Record<string, unknown>;
  for (const [field, ft] of item.reg.fields) {
    if (NON_OVERRIDABLE.has(ft.kind)) continue;
    if (!valuesEqual(inst[field], fresh[field])) return true;
  }
  return false;
};

const valuesEqual = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) {
    const av = a as unknown as ArrayLike<number>;
    const bv = b as unknown as ArrayLike<number>;
    if (av.length !== bv.length) return false;
    for (let i = 0; i < av.length; i++) if (!Object.is(av[i], bv[i])) return false;
    return true;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => valuesEqual(v, b[i]));
  }
  // Deep-compare plain objects (structs / tagged-union values) so two freshly
  // constructed defaults read as equal rather than as a phantom override.
  if (isPlainRecord(a) && isPlainRecord(b)) {
    const ak = Object.keys(a);
    const bk = Object.keys(b);
    return ak.length === bk.length && ak.every((k) => valuesEqual(a[k], b[k]));
  }
  return false;
};

const isPlainRecord = (v: unknown): v is Record<string, unknown> => {
  if (v === null || typeof v !== 'object' || Array.isArray(v) || ArrayBuffer.isView(v)) return false;
  const proto = Object.getPrototypeOf(v) as object | null;
  return proto === Object.prototype || proto === null;
};
