import type { PlatformHost } from '@retro-engine/editor-platform';

/**
 * List every file in the open project, as project-relative `/`-separated paths.
 * Native: the root-scoped `project_read_dir` command (recursive). Browser: the
 * dev server's listing route (scoped to `RETRO_PROJECT_DIR`).
 */
export const listProjectFiles = async (host: PlatformHost): Promise<readonly string[]> => {
  if (host.kind === 'tauri') {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<string[]>('project_read_dir', { relative: '' });
  }
  const res = await fetch('/project-files');
  return res.ok ? ((await res.json()) as string[]) : [];
};
