import type { AssetSink, AssetSource } from '@retro-engine/assets';
import type { PlatformHost } from '@retro-engine/editor-platform';
import { FetchAssetSource, HttpPostAssetSink } from '@retro-engine/engine';

import { TauriProjectAssetSource, TauriProjectAssetSink, TauriProjectFileOps } from './tauri-project-io';

/**
 * Move / remove a project's files. The write-only {@link AssetSink} covers creation
 * (write bytes); renaming and deleting an asset — file plus its `.meta` sidecar —
 * go through here so those multi-file, non-write operations stay out of the minimal
 * engine sink contract.
 */
export interface ProjectFileOps {
  /** Rename/move `from` to `to` (both project-relative). */
  rename(from: string, to: string): Promise<void>;
  /** Delete the file at `location` (project-relative). */
  remove(location: string): Promise<void>;
}

/** The read + write pair the studio uses for a project's files on disk. */
export interface ProjectIo {
  readonly source: AssetSource;
  readonly sink: AssetSink;
  readonly ops: ProjectFileOps;
}

/** Browser fallback file ops: the dev server's `DELETE /project/*` + `POST /project-rename`. */
class HttpProjectFileOps implements ProjectFileOps {
  async rename(from: string, to: string): Promise<void> {
    const res = await fetch('/project-rename', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from, to }),
    });
    if (!res.ok) throw new Error(`project rename failed: ${from} → ${to} (${res.status})`);
  }

  async remove(location: string): Promise<void> {
    const res = await fetch(`/project/${location}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`project delete failed: ${location} (${res.status})`);
  }
}

/**
 * Build the project I/O for the current host: native root-scoped commands + asset
 * protocol under Tauri, or the dev server's `/project/*` routes in a plain browser
 * (reusing the engine's fetch source + HTTP sink). The engine load/save path
 * consumes {@link ProjectIo.source} / {@link ProjectIo.sink} unchanged; the studio
 * uses {@link ProjectIo.ops} for rename/delete.
 */
export const createProjectIo = (host: PlatformHost, root: string): ProjectIo => {
  if (host.kind === 'tauri' && host.capabilities.filesystem) {
    return {
      source: new TauriProjectAssetSource(root),
      sink: new TauriProjectAssetSink(),
      ops: new TauriProjectFileOps(),
    };
  }
  return {
    source: new FetchAssetSource({ baseUrl: '/project/' }),
    sink: new HttpPostAssetSink({ baseUrl: '/project/', method: 'PUT' }),
    ops: new HttpProjectFileOps(),
  };
};
