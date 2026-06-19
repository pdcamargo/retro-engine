import { isTauri } from '@retro-engine/editor-platform';

/** The artifact of building a project: a loadable ESM module URL. */
export interface BuildResult {
  /** URL the studio dynamically imports to get the project's default export. */
  readonly entryUrl: string;
}

/**
 * Host-agnostic seam for turning a project directory into a loadable module.
 * Mirrors the platform-host pattern: a browser implementation hits the dev
 * server, a Tauri implementation drives the Bun sidecar (added later).
 */
export interface ProjectBuilder {
  build(projectDir: string): Promise<BuildResult>;
}

/**
 * Browser builder: POST the project dir to the dev server's `/project/build`
 * route, receive the bundled JS, and wrap it in a blob URL to import.
 */
export const endpointProjectBuilder = (baseUrl = ''): ProjectBuilder => ({
  async build(projectDir) {
    const res = await fetch(`${baseUrl}/project/build?dir=${encodeURIComponent(projectDir)}`);
    if (!res.ok) {
      throw new Error(`project build failed (${res.status}): ${await res.text()}`);
    }
    const code = await res.text();
    const blob = new Blob([code], { type: 'text/javascript' });
    return { entryUrl: URL.createObjectURL(blob) };
  },
});

/**
 * Tauri builder: invoke the `project_build` command, which runs the bundled Bun
 * sidecar (`bun install` + the build script) and returns the bundled JS. The
 * Tauri API is lazy-imported so a plain-browser bundle never pulls it onto its
 * boot path (ADR-0078).
 */
export const tauriProjectBuilder = (): ProjectBuilder => ({
  async build(projectDir) {
    const { invoke } = await import('@tauri-apps/api/core');
    const code = await invoke<string>('project_build', { projectDir });
    const blob = new Blob([code], { type: 'text/javascript' });
    return { entryUrl: URL.createObjectURL(blob) };
  },
});

/**
 * Select the builder for the current host: the Tauri sidecar natively, the dev
 * server's `/project/build` endpoint in a plain browser (and the test path).
 */
export const createProjectBuilder = (): ProjectBuilder =>
  isTauri() ? tauriProjectBuilder() : endpointProjectBuilder();
