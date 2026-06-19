import type { AssetSink, AssetSource } from '@retro-engine/assets';

// Large binary assets stream over the asset protocol (native, ranged, no IPC
// copy); small structured docs read as raw bytes over a command.
const LARGE_BINARY = /\.(png|jpe?g|webp|ktx2|basis|glb|bin|ogg|mp3|wav|mp4|webm)$/i;

const joinRoot = (root: string, location: string): string =>
  `${root.replace(/[/\\]$/, '')}/${location}`;

/**
 * Record the opened project's root in the Rust host and tighten the asset-protocol
 * + fs-watch scopes to it. Must run before the first project read on every boot —
 * a persisted (reopened) project has no native dialog to set it. Idempotent.
 */
export const setNativeProjectRoot = async (root: string): Promise<void> => {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('set_project_root', { path: root });
};

/**
 * Reads a project's files, scoped to its root in the Rust host. Routes by use
 * case: large binaries via `convertFileSrc` + `fetch` (the webview streams them
 * natively); everything else as raw bytes over the `project_read_file` command
 * (an octet-stream IPC response, no JSON marshalling). Satisfies the engine's
 * {@link AssetSource} so the existing load path is unchanged.
 */
export class TauriProjectAssetSource implements AssetSource {
  constructor(private readonly root: string) {}

  async read(location: string): Promise<Uint8Array> {
    if (LARGE_BINARY.test(location)) {
      const { convertFileSrc } = await import('@tauri-apps/api/core');
      const res = await fetch(convertFileSrc(joinRoot(this.root, location)));
      if (!res.ok) throw new Error(`project asset read failed: ${location} (${res.status})`);
      return new Uint8Array(await res.arrayBuffer());
    }
    const { invoke } = await import('@tauri-apps/api/core');
    const buffer = await invoke<ArrayBuffer>('project_read_file', { relative: location });
    return new Uint8Array(buffer);
  }
}

/**
 * Writes a project's files through the `project_write_file` command (root-scoped
 * in Rust). The bytes travel as the raw IPC request body; the project-relative
 * location rides in the percent-encoded `x-path` header.
 */
export class TauriProjectAssetSink implements AssetSink {
  async write(location: string, bytes: Uint8Array): Promise<void> {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('project_write_file', bytes, { headers: { 'x-path': encodeURIComponent(location) } });
  }
}
