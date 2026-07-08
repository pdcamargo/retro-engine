/** Options for {@link emitWebBoot}. */
export interface WebBootOptions {
  /**
   * Import specifier for the user's project entry module — the module that
   * default-exports a `ProjectDefinition` (`@retro-engine/project`). A path
   * (relative to where the emitted entry is written, or absolute) or a package
   * specifier.
   */
  readonly userEntry: string;
  /** Id of the canvas element in the generated `index.html`. Default `'game'`. */
  readonly canvasId?: string;
  /** Optional swapchain clear color, forwarded to `bootWebGame`. */
  readonly clearColor?: { r: number; g: number; b: number; a: number };
  /** Packed-asset delivery URLs, forwarded to `bootWebGame` when the export packs a `.rpak`. */
  readonly assets?: { rpakUrl: string; manifestUrl: string };
  /**
   * GUID of the project's startup scene, forwarded to `bootWebGame` so a
   * scene-driven project boots with its authored world (ADR-0173).
   */
  readonly startupScene?: string;
}

/**
 * Emit the source of a web-export boot entry module: a tiny ESM module that
 * imports the user's `ProjectDefinition` and hands it to
 * `bootWebGame(@retro-engine/runtime-web)`.
 *
 * The web export bundles *this* module (not the user entry directly), so the
 * produced `main.js` actually boots the game. Pure and deterministic — no I/O.
 */
export const emitWebBoot = (options: WebBootOptions): string => {
  const canvasId = options.canvasId ?? 'game';
  const bootOptions: Record<string, unknown> = { canvas: canvasId };
  if (options.clearColor !== undefined) bootOptions.clearColor = options.clearColor;
  if (options.assets !== undefined) bootOptions.assets = options.assets;
  if (options.startupScene !== undefined && options.startupScene.length > 0) {
    bootOptions.startupScene = options.startupScene;
  }
  return `import definition from ${JSON.stringify(options.userEntry)};
import { bootWebGame } from '@retro-engine/runtime-web';

bootWebGame(definition, ${JSON.stringify(bootOptions)}).catch((error) => {
  console.error('[retro] failed to boot game', error);
});
`;
};
