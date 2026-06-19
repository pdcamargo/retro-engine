import type { PluginObject } from '@retro-engine/engine';

/**
 * Human-facing metadata describing a game project. Surfaced by tooling (the
 * studio title bar, build output) and otherwise inert at runtime.
 */
export interface ProjectMeta {
  /** Display name of the game, e.g. `"My Game"`. */
  readonly name?: string;
  /** Semantic version of the game build, e.g. `"0.1.0"`. */
  readonly version?: string;
}

/**
 * The shape a project's game-runtime entry point default-exports. It lists the
 * plugins that compose the game; a host (the studio, or a standalone runtime)
 * adds every plugin to a fresh `App` in order, then runs it.
 */
export interface ProjectDefinition {
  /**
   * Game-runtime plugins, added to the `App` in array order. Each plugin
   * registers its components, systems, resources, and templates in `build`.
   */
  readonly plugins: readonly PluginObject[];
  /** Optional human-facing metadata. */
  readonly meta?: ProjectMeta;
}

/**
 * Declares a game project's runtime composition. Default-export the result
 * from the project's entry module:
 *
 * ```ts
 * import { defineProject } from '@retro-engine/project';
 * import { PlayerPlugin } from './player';
 *
 * export default defineProject({
 *   plugins: [new PlayerPlugin()],
 *   meta: { name: 'My Game' },
 * });
 * ```
 *
 * The function is an identity helper — it exists for type inference and a
 * single, discoverable entry-point convention, and performs no work at call
 * time.
 */
export const defineProject = (definition: ProjectDefinition): ProjectDefinition => definition;

export { isEditorHint, isRunInEditor, runInEditor } from './editor-hint';
