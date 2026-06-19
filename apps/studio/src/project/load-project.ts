import type { App } from '@retro-engine/engine';
import type { ProjectDefinition } from '@retro-engine/project';

import type { ProjectBuilder } from './project-builder';

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
export const applyProject = (app: App, project: ProjectDefinition): void => {
  app.addPlugins([...project.plugins]);
};
