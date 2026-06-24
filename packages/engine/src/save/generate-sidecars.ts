import { generateAssetGuid } from '@retro-engine/assets';

import type { AssetKinds } from '../asset/asset-kinds';

import { bakeMeta, bakeMetaWithData, serializeMeta } from './meta';
import type { SavedFile } from './serialize-project';

/** A sidecar minted by {@link generateMissingSidecars}: the asset's new identity. */
export interface MintedSidecar {
  readonly guid: string;
  readonly location: string;
  readonly kind: string;
}

/** The result of {@link generateMissingSidecars}: the sidecar files to write and the identities minted. */
export interface GenerateSidecarsResult {
  /** The `.meta` sidecar files to write through an `AssetSink`. */
  readonly writes: readonly SavedFile[];
  /** The identities minted, in `writes` order — for splicing into an in-memory manifest. */
  readonly minted: readonly MintedSidecar[];
}

const META_SUFFIX = '.meta';

/** The trailing extension of `path`, lowercased and dot-free, or `undefined` if none. */
const extensionOf = (path: string): string | undefined => {
  const slash = path.lastIndexOf('/');
  const dot = path.lastIndexOf('.');
  if (dot <= slash + 1) return undefined;
  return path.slice(dot + 1).toLowerCase();
};

/**
 * Compute the `.meta` sidecars missing for discoverable loose assets. For every
 * project file whose extension is owned by a {@link AssetKinds} descriptor marked
 * discoverable and that has **no sibling `<file>.meta`** present in `files`, mint
 * a fresh GUID and a default sidecar (the descriptor's `defaultMeta()` body when
 * present, else the identity-only shape).
 *
 * Performs **no I/O** — it returns the files for a caller to write through an
 * `AssetSink`. Idempotent: a file that already has a sibling `.meta` is skipped,
 * so re-running it (e.g. on every project scan or file-watch reindex) only ever
 * writes sidecars for newly added assets.
 *
 * @param files Every project file as a relative path (e.g. the studio's file listing).
 * @param kinds The asset-kind catalog; files whose extension is unknown or not discoverable are ignored.
 */
export const generateMissingSidecars = (
  files: Iterable<string>,
  kinds: AssetKinds,
): GenerateSidecarsResult => {
  const present = new Set(files);
  const writes: SavedFile[] = [];
  const minted: MintedSidecar[] = [];
  const encoder = new TextEncoder();

  for (const path of present) {
    if (path.endsWith(META_SUFFIX)) continue;
    if (present.has(`${path}${META_SUFFIX}`)) continue;
    const ext = extensionOf(path);
    if (ext === undefined) continue;
    const descriptor = kinds.forExtension(ext);
    if (descriptor === undefined || !descriptor.discoverable) continue;

    const guid = generateAssetGuid();
    const meta = descriptor.defaultMeta
      ? bakeMetaWithData(guid, descriptor.kind, descriptor.defaultMeta())
      : bakeMeta(guid, descriptor.kind);
    writes.push({ location: `${path}${META_SUFFIX}`, bytes: encoder.encode(serializeMeta(meta)) });
    minted.push({ guid, location: path, kind: descriptor.kind });
  }

  return { writes, minted };
};
