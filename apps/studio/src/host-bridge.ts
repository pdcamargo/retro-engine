import * as assets from '@retro-engine/assets';
import * as ecs from '@retro-engine/ecs';
import * as editorSdk from '@retro-engine/editor-sdk';
import * as engine from '@retro-engine/engine';
import * as math from '@retro-engine/math';
import * as project from '@retro-engine/project';
import * as projectEditor from '@retro-engine/project/editor';
import * as reflect from '@retro-engine/reflect';
import * as rendererCore from '@retro-engine/renderer-core';

/** The studio's loaded engine packages, keyed by import specifier. */
export type RetroHost = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

const PACKAGES: RetroHost = {
  '@retro-engine/assets': assets,
  '@retro-engine/ecs': ecs,
  '@retro-engine/editor-sdk': editorSdk,
  '@retro-engine/engine': engine,
  '@retro-engine/math': math,
  '@retro-engine/project': project,
  '@retro-engine/project/editor': projectEditor,
  '@retro-engine/reflect': reflect,
  '@retro-engine/renderer-core': rendererCore,
};

/**
 * Publish the studio's loaded `@retro-engine/*` packages onto `globalThis` so
 * built user code resolves its imports to these live instances (the shim emitted
 * by {@link import('./project/host-externals-plugin')} reads them). Call once at
 * boot, before any project is loaded.
 */
export const publishHost = (): void => {
  (globalThis as unknown as { __retroHost?: RetroHost }).__retroHost = PACKAGES;
};
