import { App } from '@retro-engine/engine';
import type { ProjectDefinition } from '@retro-engine/project';
import type { Renderer } from '@retro-engine/renderer-core';
import { createWebGPURenderer } from '@retro-engine/renderer-webgpu';

import type { CanvasTarget } from './resolve-canvas';
import { resolveCanvas } from './resolve-canvas';

/** An RGBA clear color in the `[0, 1]` range. */
export interface ClearColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/** Options for {@link bootWebGame}. */
export interface BootWebGameOptions {
  /**
   * The canvas to render into — an `HTMLCanvasElement` or the element `id` of
   * one in the document. Defaults to the id `'game'` (the id the web export's
   * generated `index.html` uses).
   */
  readonly canvas?: CanvasTarget;
  /** Swapchain clear color. Defaults to the `App` default (opaque black). */
  readonly clearColor?: ClearColor;
  /**
   * Renderer backend factory. Defaults to `createWebGPURenderer`. Injected so
   * a future WebGL2 backend (or a test double) can be swapped in without
   * touching the boot logic.
   */
  readonly createRenderer?: (canvas: HTMLCanvasElement) => Renderer;
  /**
   * When `true` (default) the returned `App` is started via `App.run`. Pass
   * `false` to build and compose the `App` without starting the frame loop —
   * the caller drives it (e.g. a host that owns the loop, or a test).
   */
  readonly autoRun?: boolean;
}

/**
 * Boot a Retro Engine game in the browser from its {@link ProjectDefinition}.
 *
 * Resolves the render canvas, creates a renderer backend (WebGPU by default),
 * constructs an `App`, adds every plugin the project declares in order, and —
 * unless `autoRun` is `false` — starts the frame loop. Returns the composed
 * `App` so a host can hold or drive it.
 *
 * This is the runtime counterpart to the studio's editor host: the studio owns
 * the `App` while authoring; a shipped web build calls this instead.
 *
 * @example
 * ```ts
 * import definition from './game';
 * await bootWebGame(definition, { canvas: 'game' });
 * ```
 */
export const bootWebGame = async (
  definition: ProjectDefinition,
  options: BootWebGameOptions = {},
): Promise<App> => {
  const canvas = resolveCanvas(options.canvas ?? 'game');
  const createRenderer = options.createRenderer ?? createWebGPURenderer;
  const renderer = createRenderer(canvas);

  const app = new App({
    renderer,
    canvas,
    ...(options.clearColor !== undefined ? { clearColor: options.clearColor } : {}),
  });

  for (const plugin of definition.plugins) app.addPlugin(plugin);

  if (options.autoRun !== false) await app.run();
  return app;
};
