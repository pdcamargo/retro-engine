import type { AssetSink, AssetSource } from '@retro-engine/assets';

// Large binary assets stream over the asset protocol (native, ranged, no IPC
// copy); small structured docs read as bytes over a command.
const LARGE_BINARY = /\.(png|jpe?g|webp|ktx2|basis|glb|bin|ogg|mp3|wav|mp4|webm)$/i;

const joinRoot = (root: string, location: string): string =>
  `${root.replace(/[/\\]$/, '')}/${location}`;

/**
 * Reads a project's files, scoped to its root in the Rust host. Routes by use
 * case: large binaries via `convertFileSrc` + `fetch` (the webview streams them
 * natively); everything else via the `project_read_file` command. Satisfies the
 * engine's {@link AssetSource} so the existing load path is unchanged.
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
    const bytes = await invoke<number[]>('project_read_file', { relative: location });
    return Uint8Array.from(bytes);
  }
}

/** Writes a project's files through the `project_write_file` command (root-scoped in Rust). */
export class TauriProjectAssetSink implements AssetSink {
  async write(location: string, bytes: Uint8Array): Promise<void> {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('project_write_file', { relative: location, contents: Array.from(bytes) });
  }
}
