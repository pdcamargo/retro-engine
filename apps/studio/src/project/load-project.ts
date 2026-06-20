import type { AddSystemOptions, App, PluginObject, RunCondition } from '@retro-engine/engine';
import type { ProjectDefinition } from '@retro-engine/project';
import { isRunInEditor } from '@retro-engine/project';
import type { EditorExtension } from '@retro-engine/project/editor';

import type { ProjectBuilder } from './project-builder';

// A project's plugins are user code: default their systems to the 'user' origin
// bucket (the studio's App defaults to 'editor' for its own scaffolding). A plugin
// that declares its own category keeps it.
const asUserPlugin = (p: PluginObject): PluginObject => ({
  name: () => p.name(),
  category: () => p.category?.() ?? 'user',
  build: (app: App) => p.build(app),
  ...(p.isUnique ? { isUnique: () => p.isUnique!() } : {}),
  ...(p.ready ? { ready: (app: App) => p.ready!(app) } : {}),
  ...(p.finish ? { finish: (app: App) => p.finish!(app) } : {}),
  ...(p.cleanup ? { cleanup: (app: App) => p.cleanup!(app) } : {}),
});

/**
 * Dynamically import a built project module and validate its default export is a
 * {@link ProjectDefinition}. The module's `@retro-engine/*` imports resolve to the
 * studio's live instances via the host bridge.
 */
export const loadProjectModule = async (entryUrl: string): Promise<ProjectDefinition> => {
  const mod = (await import(entryUrl)) as { default?: ProjectDefinition };
  const def = mod.default;
  if (def === undefined || !Array.isArray(def.plugins)) {
    throw new Error('project entry must default-export defineProject({ plugins })');
  }
  return def;
};

/** Build a project directory and load its default-exported {@link ProjectDefinition}. */
export const buildProjectModule = async (
  builder: ProjectBuilder,
  projectDir: string,
): Promise<ProjectDefinition> => {
  const { entryUrl } = await builder.build(projectDir);
  return loadProjectModule(entryUrl);
};

/**
 * Add a loaded project's plugins to a fresh, still-building `App`. Must run while
 * the App is in its `Building` phase — loading a project is an App-rebuild, wired
 * by the studio boot (a running App rejects `addPlugins`).
 */
/**
 * Add a loaded project's plugins to a fresh, still-building `App` (project load is
 * an App-rebuild, ADR-0091). When `playGate` is given (e.g. `inState(SimState.Play)`),
 * every system the project registers is gated behind it — so user gameplay runs only
 * in Play, not while editing — except one-shot `startup` and engine `render` systems.
 */
export const applyProject = (
  app: App,
  project: ProjectDefinition,
  playGate?: RunCondition,
  opts: { readonly hot?: boolean } = {},
): void => {
  const plugins = project.plugins.map(asUserPlugin);
  // On a hot reload the App is already running, so plugins go in through
  // addPluginsHot (which bypasses addPlugin's Building-only guard, ADR-0102).
  const add = opts.hot === true ? (p: PluginObject[]) => app.addPluginsHot(p) : (p: PluginObject[]) => app.addPlugins(p);
  if (playGate === undefined) {
    add(plugins);
    return;
  }

  // Inject the play gate as a runIf on the project's per-frame systems by
  // intercepting addSystem for the duration of the build (only user plugins run
  // here, so no engine system is gated). Restored in `finally`.
  const original = app.addSystem.bind(app) as (...args: unknown[]) => unknown;
  const patched = app as unknown as {
    addSystem: (stage: string, params: unknown, fn: unknown, options?: AddSystemOptions) => unknown;
  };
  patched.addSystem = (stage, params, fn, options) => {
    // runInEditor (tool) systems and one-shot startup / engine render run ungated.
    if (stage === 'startup' || stage === 'render' || isRunInEditor(fn)) {
      return original(stage, params, fn, options);
    }
    const runIf = options?.runIf ? options.runIf.and(playGate) : playGate;
    return original(stage, params, fn, { ...options, runIf });
  };
  try {
    add(plugins);
  } finally {
    delete (app as unknown as { addSystem?: unknown }).addSystem;
  }
};

/**
 * Dynamically import a built editor-extensions module and validate its default
 * export. Editor extensions run only in the studio (never a game build) and
 * register against the studio-lifetime inspector registry, so they survive
 * project/world reloads.
 */
export const loadEditorExtensions = async (entryUrl: string): Promise<EditorExtension> => {
  const mod = (await import(entryUrl)) as { default?: EditorExtension };
  const ext = mod.default;
  if (ext === undefined || typeof ext.setup !== 'function') {
    throw new Error('editor entry must default-export defineEditorExtensions({ setup })');
  }
  return ext;
};

/** Build a project's editor-extensions entry (a second artifact) and load it. */
export const buildEditorExtensions = async (
  builder: ProjectBuilder,
  projectDir: string,
  entry: string,
): Promise<EditorExtension> => {
  const { entryUrl } = await builder.build(projectDir, entry);
  return loadEditorExtensions(entryUrl);
};
