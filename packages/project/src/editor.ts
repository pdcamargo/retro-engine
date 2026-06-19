import type { InspectorRegistry } from '@retro-engine/editor-sdk';

/**
 * The shape a project's optional editor-extensions entry point default-exports.
 * Editor extensions run only inside the studio, never in a shipped game build —
 * they customize how the editor presents the project's components (custom
 * inspectors, field renderers, amendments).
 */
export interface EditorExtension {
  /**
   * Register the project's editor customizations against the studio's inspector
   * registry. Called once, after the studio builds its inspector and before the
   * first frame; the registrations persist across project/world reloads.
   */
  setup(registry: InspectorRegistry): void;
}

/**
 * Declares a project's studio-only editor extensions. Default-export the result
 * from the project's editor entry module:
 *
 * ```ts
 * import { defineEditorExtensions } from '@retro-engine/project/editor';
 * import { HealthBarEditor } from './editors/health-bar';
 *
 * export default defineEditorExtensions({
 *   setup(registry) {
 *     registry.registerComponentEditor('Health', HealthBarEditor);
 *   },
 * });
 * ```
 *
 * The function is an identity helper — it exists for type inference and a single
 * entry-point convention, and performs no work at call time.
 */
export const defineEditorExtensions = (extension: EditorExtension): EditorExtension => extension;
