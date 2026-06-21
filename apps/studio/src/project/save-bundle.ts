import { type AssetSink, generateAssetGuid } from '@retro-engine/assets';
import { BUNDLE_ASSET_EXTENSION, BUNDLE_ASSET_KIND, type BundleDefinition, serializeBundle } from '@retro-engine/engine';

/** On-disk `.meta` sidecar version (matches the engine's asset-meta format). */
const META_VERSION = 1;

/** The identity a saved bundle asset settled on. */
export interface SaveBundleResult {
  readonly guid: string;
  readonly location: string;
}

const sanitize = (name: string): string => name.replace(/[^a-zA-Z0-9_-]+/g, '_') || 'bundle';

/**
 * Write a bundle definition to a `.rebundle` asset (plus its `.meta` sidecar)
 * through the project sink. A new bundle (no `location`) lands at
 * `assets/<name>.rebundle` with a fresh GUID; editing an existing one reuses its
 * `guid` + `location` so references stay fixed. Returns the settled identity.
 */
export const saveBundleAsset = async (
  sink: AssetSink,
  def: BundleDefinition,
  guid: string | null,
  location: string | null,
): Promise<SaveBundleResult> => {
  const resolvedGuid = guid ?? (generateAssetGuid() as string);
  const resolvedLocation = location ?? `assets/${sanitize(def.name)}.${BUNDLE_ASSET_EXTENSION}`;
  await sink.write(resolvedLocation, serializeBundle(def));
  const meta = { version: META_VERSION, guid: resolvedGuid, kind: BUNDLE_ASSET_KIND };
  await sink.write(`${resolvedLocation}.meta`, new TextEncoder().encode(`${JSON.stringify(meta, null, 2)}\n`));
  return { guid: resolvedGuid, location: resolvedLocation };
};
