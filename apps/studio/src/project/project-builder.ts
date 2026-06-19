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
 * Select the builder for the current host. The Tauri sidecar builder lands with
 * the native build path; the browser endpoint is the default and the test path.
 */
export const createProjectBuilder = (): ProjectBuilder => endpointProjectBuilder();
