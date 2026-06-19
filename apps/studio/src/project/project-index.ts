import type { AssetManifest } from '@retro-engine/assets';
import type { App } from '@retro-engine/engine';
import { AppTypeRegistry, SCENE_ASSET_KIND } from '@retro-engine/engine';
import type { ComponentKey, InspectorRegistry } from '@retro-engine/editor-sdk';
import { parse as parseToml } from 'smol-toml';

/** The parsed `project.retroengine` descriptor (its human-authored fields). */
export interface ProjectDescriptor {
  readonly formatVersion: number;
  readonly projectId: string;
  readonly name: string;
  readonly version: string;
  readonly engine: string;
  readonly buildEntry: string;
  readonly editorEntry: string | null;
  readonly startupScene: string | null;
}

/** Parse a `project.retroengine` TOML document into a {@link ProjectDescriptor}. */
export const parseProjectDescriptor = (toml: string): ProjectDescriptor => {
  const doc = parseToml(toml) as Record<string, unknown>;
  const table = (key: string): Record<string, unknown> =>
    (doc[key] as Record<string, unknown> | undefined) ?? {};
  const project = table('project');
  const build = table('build');
  const run = table('run');
  const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
  const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

  return {
    formatVersion: typeof doc.formatVersion === 'number' ? doc.formatVersion : 0,
    projectId: str(doc.projectId),
    name: str(project.name),
    version: str(project.version, '0.0.0'),
    engine: str(project.engine),
    buildEntry: str(build.entry, 'src/game.ts'),
    editorEntry: strOrNull(build.editorEntry),
    startupScene: strOrNull(run.startupScene),
  };
};

/** A scene or prefab document in the project, by GUID. */
export interface SceneEntry {
  readonly guid: string;
  readonly location: string;
}

/** The half of the index knowable from files alone (no built App). */
export interface FileIndex {
  /** Every asset GUID → location/kind, from the scanned `.meta` sidecars. */
  readonly assets: AssetManifest;
  /** Scene documents (manifest `kind: Scene`). */
  readonly scenes: readonly SceneEntry[];
  /** Prefab documents (manifest `kind: Prefab`). */
  readonly prefabs: readonly SceneEntry[];
}

/** Build the file-derived index from a scanned manifest (no App needed). */
export const buildFileIndex = (assets: AssetManifest): FileIndex => {
  const scenes: SceneEntry[] = [];
  const prefabs: SceneEntry[] = [];
  for (const entry of assets.entries.values()) {
    if (entry.kind === SCENE_ASSET_KIND) scenes.push({ guid: entry.guid, location: entry.location });
    else if (entry.kind === 'Prefab') prefabs.push({ guid: entry.guid, location: entry.location });
  }
  return { assets, scenes, prefabs };
};

/** One system in the schedule, attributed to its origin and plugin. */
export interface SystemEntry {
  readonly name: string;
  readonly stage: string;
  readonly plugin: string | undefined;
}

/** The half of the index knowable only after the project's code is built + applied. */
export interface CodeIndex {
  /** User gameplay systems (schedule entries with origin `'user'`). */
  readonly systems: readonly SystemEntry[];
  /** Reflection names of components the project registered (beyond the engine baseline). */
  readonly components: readonly string[];
  /** Reflection names of resources the project registered (beyond the baseline). */
  readonly resources: readonly string[];
  /** Components the project's editor extensions customize. */
  readonly editors: readonly ComponentKey[];
}

/**
 * Build the code-derived index by introspecting the live App after its project
 * plugins were applied. `baseline` is the set of component/resource names present
 * before the project loaded (engine + editor scaffolding), so only the project's
 * own registrations are reported.
 */
export const buildCodeIndex = (
  app: App,
  inspector: InspectorRegistry,
  baseline: { readonly components: ReadonlySet<string>; readonly resources: ReadonlySet<string> },
): CodeIndex => {
  const systems: SystemEntry[] = [];
  for (const group of app.describeSchedule()) {
    for (const sys of group.systems) {
      if (sys.origin === 'user') {
        systems.push({ name: sys.name, stage: group.stage, plugin: sys.originPlugin ?? undefined });
      }
    }
  }

  const atr = app.getResource(AppTypeRegistry)!;
  const components: string[] = [];
  for (const reg of atr.registry.components()) {
    if (!baseline.components.has(reg.name)) components.push(reg.name);
  }
  const resources: string[] = [];
  for (const reg of atr.resources.values()) {
    if (!baseline.resources.has(reg.name)) resources.push(reg.name);
  }

  const editors = inspector.describe().map((c) => c.component);
  return { systems, components, resources, editors };
};

/** Snapshot the engine/editor baseline names, before a project is applied. */
export const captureBaseline = (
  app: App,
): { components: ReadonlySet<string>; resources: ReadonlySet<string> } => {
  const atr = app.getResource(AppTypeRegistry)!;
  return {
    components: new Set([...atr.registry.components()].map((r) => r.name)),
    resources: new Set([...atr.resources.values()].map((r) => r.name)),
  };
};

/** The full project index: file-derived + code-derived halves. */
export interface ProjectIndex {
  readonly descriptor: ProjectDescriptor;
  readonly files: FileIndex;
  readonly code: CodeIndex;
}
