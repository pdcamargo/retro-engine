import type { AssetManifestEntry, AssetManifestFile } from '@retro-engine/assets';
import { bakeManifest } from '@retro-engine/assets';

import type { RpakInput } from './rpak-writer';

const META_SUFFIX = '.meta';

// Directories never scanned for project assets (build output, deps, caches).
const EXCLUDED_DIRS = new Set(['node_modules', 'dist', '.re', '.git', '.turbo']);

/** A project's scanned assets: the GUID→location manifest + the bytes to pack. */
export interface ScannedAssets {
  /** The baked manifest (GUID → location / kind) ready to serialize as `manifest.json`. */
  readonly manifest: AssetManifestFile;
  /** One packable entry per asset, keyed by GUID, for the `.rpak`. */
  readonly inputs: RpakInput[];
}

/**
 * Parse one `.meta` sidecar into a manifest entry. `metaLocation` is the sidecar
 * path (project-relative, POSIX); the asset's own location is that path with the
 * `.meta` suffix stripped (mirrors the engine's `scanMetaManifest` convention).
 * Throws if the JSON is malformed or missing a string `guid` / `kind`.
 */
export const parseMetaEntry = (metaLocation: string, bytes: Uint8Array): AssetManifestEntry => {
  const raw: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`asset scan: '${metaLocation}' is not a JSON object`);
  }
  const meta = raw as { guid?: unknown; kind?: unknown };
  if (typeof meta.guid !== 'string' || typeof meta.kind !== 'string') {
    throw new Error(`asset scan: '${metaLocation}' is missing a string 'guid' or 'kind'`);
  }
  // Bake the sidecar's import settings (everything beyond the sidecar-metadata
  // keys version/guid/kind) into the manifest so a bundle source can serve them
  // without shipping the loose file.
  const { version: _v, guid: _g, kind: _k, ...extra } = raw as Record<string, unknown>;
  return {
    guid: meta.guid as AssetManifestEntry['guid'],
    location: metaLocation.slice(0, -META_SUFFIX.length),
    kind: meta.kind,
    ...(Object.keys(extra).length > 0 ? { meta: extra } : {}),
  };
};

/**
 * Scan a project directory for asset `.meta` sidecars, building the GUID→location
 * manifest and reading each asset's bytes into a packable {@link RpakInput}. The
 * `.rpak` is keyed by GUID; the manifest maps each GUID to its project-relative
 * location. Sidecars whose asset file is missing are skipped. Build / dependency
 * / cache directories are not scanned.
 *
 * Runs under Bun/Node at build time.
 */
export const scanProjectAssets = async (projectRoot: string): Promise<ScannedAssets> => {
  const { readdir, readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');

  const all = await readdir(projectRoot, { recursive: true });
  const entries: AssetManifestEntry[] = [];
  const inputs: RpakInput[] = [];
  const seen = new Set<string>();

  for (const rawPath of all) {
    if (!rawPath.endsWith(META_SUFFIX)) continue;
    const relMeta = rawPath.split('\\').join('/'); // normalize to POSIX
    if (relMeta.split('/').some((seg) => EXCLUDED_DIRS.has(seg))) continue;

    const entry = parseMetaEntry(relMeta, await readFile(join(projectRoot, relMeta)));
    if (seen.has(entry.guid)) {
      throw new Error(`asset scan: duplicate GUID '${entry.guid}' across sidecars`);
    }
    let data: Uint8Array;
    try {
      data = await readFile(join(projectRoot, entry.location));
    } catch {
      // Orphan sidecar (asset file removed) — skip it rather than fail the build.
      continue;
    }
    seen.add(entry.guid);
    entries.push(entry);
    inputs.push({ guid: entry.guid, data });
  }

  return { manifest: bakeManifest(entries), inputs };
};
