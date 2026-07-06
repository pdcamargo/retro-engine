import { parseAssetManifest } from '@retro-engine/assets';
import { RangeRpakReader } from '@retro-engine/build/rpak';
import { App, AssetPlugin, AssetServer } from '@retro-engine/engine';
import type { ProjectDefinition } from '@retro-engine/project';
import type { Renderer } from '@retro-engine/renderer-core';
import { createWebGPURenderer } from '@retro-engine/renderer-webgpu';

import type { CanvasTarget } from './resolve-canvas';
import { resolveCanvas } from './resolve-canvas';
import { httpRangeFetch, RpakAssetSource } from './rpak-asset-source';

/** Where an exported game's packed assets + manifest live, relative to the page. */
export interface WebAssetsConfig {
  /** URL of the `.rpak` archive (e.g. `'assets.rpak'`). */
  readonly rpakUrl: string;
  /** URL of the GUID→location `manifest.json`. */
  readonly manifestUrl: string;
}

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
  /**
   * Packed asset delivery. When set, the game's assets are streamed from a
   * `.rpak` over HTTP Range and resolved through the fetched manifest — wired
   * before the project's plugins so their loaders resolve GUIDs from the archive.
   */
  readonly assets?: WebAssetsConfig;
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

  // Wire packed-asset delivery before the game's plugins so their loaders (added
  // in `build` / via `whenResource(AssetServer)`) resolve GUIDs from the `.rpak`.
  if (options.assets !== undefined) await wireAssets(app, options.assets);

  for (const plugin of definition.plugins) app.addPlugin(plugin);

  if (options.autoRun !== false) await app.run();
  return app;
};

/** Fetch the manifest, open a `.rpak`-backed source, and bind it to the App's `AssetServer`. */
const wireAssets = async (app: App, assets: WebAssetsConfig): Promise<void> => {
  const response = await fetch(assets.manifestUrl);
  if (!response.ok) throw new Error(`bootWebGame: manifest fetch ${assets.manifestUrl} → ${response.status}`);
  const manifest = parseAssetManifest(await response.text());
  const source = new RpakAssetSource(new RangeRpakReader(httpRangeFetch(assets.rpakUrl)), manifest);
  app.addPlugin(new AssetPlugin({ source }));
  app.getResource(AssetServer)?.setManifest(manifest);
  if (typeof window !== 'undefined') {
    (window as unknown as { __retroAssets?: { entries: number } }).__retroAssets = {
      entries: manifest.entries.size,
    };
  }
};
