import type { AssetSink, AssetSource } from '@retro-engine/assets';
import type { PlatformHost } from '@retro-engine/editor-platform';
import { FetchAssetSource, HttpPostAssetSink } from '@retro-engine/engine';

import { TauriProjectAssetSource, TauriProjectAssetSink } from './tauri-project-io';

/** The read + write pair the studio uses for a project's files on disk. */
export interface ProjectIo {
  readonly source: AssetSource;
  readonly sink: AssetSink;
}

/**
 * Build the project I/O pair for the current host: native root-scoped commands +
 * asset protocol under Tauri, or the dev server's `/project/*` GET/PUT routes in
 * a plain browser (reusing the engine's fetch source + HTTP sink). The engine
 * load/save path consumes the result unchanged.
 */
export const createProjectIo = (host: PlatformHost, root: string): ProjectIo => {
  if (host.kind === 'tauri' && host.capabilities.filesystem) {
    return { source: new TauriProjectAssetSource(root), sink: new TauriProjectAssetSink() };
  }
  return {
    source: new FetchAssetSource({ baseUrl: '/project/' }),
    sink: new HttpPostAssetSink({ baseUrl: '/project/', method: 'PUT' }),
  };
};
