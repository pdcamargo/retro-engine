import type { PlatformHost } from '@retro-engine/editor-platform';

/**
 * Path segments that never hold authored project assets — dependency trees, VCS
 * metadata, and build/cache output. Filtered out so the asset indexer never
 * treats a linked package's files (reached through a `node_modules` symlink) as
 * project assets. Mirrors the native walk's skip list; applied here too so the
 * browser/dev-server path is covered without a second source of truth on the wire.
 */
const IGNORED_SEGMENT = /(?:^|\/)(?:node_modules|\.git|dist|\.re|target)\//;

/**
 * List every file in the open project, as project-relative `/`-separated paths.
 * Native: the root-scoped `project_read_dir` command (recursive). Browser: the
 * dev server's listing route (scoped to `RETRO_PROJECT_DIR`). Non-authored
 * directories (see {@link IGNORED_SEGMENT}) are excluded.
 */
export const listProjectFiles = async (host: PlatformHost): Promise<readonly string[]> => {
  const files =
    host.kind === 'tauri'
      ? await (await import('@tauri-apps/api/core')).invoke<string[]>('project_read_dir', { relative: '' })
      : await fetch('/project-files').then((res) => (res.ok ? (res.json() as Promise<string[]>) : []));
  return files.filter((f) => !IGNORED_SEGMENT.test(f));
};
