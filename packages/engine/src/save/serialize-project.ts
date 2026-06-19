import type { AssetGuid, AssetManifestEntry, AssetManifestFile, Handle } from '@retro-engine/assets';
import { bakeManifest, generateAssetGuid } from '@retro-engine/assets';
import { stringify as stringifyYaml } from 'yaml';

import { AssetSerializers } from '../asset/asset-serializers';
import { AssetStores } from '../asset/asset-stores';
import type { App } from '../index';
import type { SceneData } from '../scene/scene-data';

import { bakeMeta, serializeMeta } from './meta';
import { promoteAsset } from './promote';

/** The manifest `kind` tag used for scene documents. */
export const SCENE_ASSET_KIND = 'Scene';

/** One file to write, by location, through an `AssetSink`. */
export interface SavedFile {
  readonly location: string;
  readonly bytes: Uint8Array;
}

/** A scene's persistent identity within a saved project: its file location and GUID. */
export interface SavedScene {
  readonly location: string;
  readonly guid: AssetGuid;
}

/** A scene to write into the project: where its file goes, its identity, and its data. */
export interface ScenePromotion {
  /** Location of the scene file (e.g. `'scenes/main.rescene'`). */
  readonly location: string;
  /** Stable identity for the scene asset. Defaults to a fresh v4 GUID. */
  readonly guid?: AssetGuid;
  /** The scene data, already produced by `serializeScene` (it carries any resources). */
  readonly data: SceneData;
}

/** A referenced in-memory asset to persist as a GUID-backed project asset. */
export interface AssetPromotion {
  /** The live handle whose GUID becomes the asset's persistent identity. */
  readonly handle: Handle<unknown>;
  /** The asset-kind tag: keys both the serializer and the asset store (e.g. `ASSET_TYPE.mesh`). */
  readonly kind: string;
  /** File extension for the written bytes; MUST have a registered importer for reload. */
  readonly extension: string;
}

/** Options for {@link serializeProject}. */
export interface SerializeProjectOptions {
  /** The scenes to write. */
  readonly scenes: readonly ScenePromotion[];
  /** Referenced assets to promote alongside the scenes. */
  readonly promotions?: readonly AssetPromotion[];
}

/** The pure-data artifacts of a saved project — written file-by-file through an `AssetSink`. */
export interface SavedProject {
  /** Every file to write, by location: scene/asset bytes and their `.meta` sidecars. */
  readonly files: readonly SavedFile[];
  /** The scenes written, with their persistent GUIDs (the project's entry points). */
  readonly scenes: readonly SavedScene[];
  /**
   * The manifest derived from the written assets, for tooling/tests. It is **not**
   * written to disk — a project ships `.meta` sidecars, and the manifest is
   * rebuilt from them on load (`scanMetaManifest`).
   */
  readonly manifest: AssetManifestFile;
}

const encodeText = (text: string): Uint8Array => new TextEncoder().encode(text);

/**
 * Serialize an App into the pure-data artifacts of a project: the scene documents
 * (each a GUID-addressable asset, carrying its resources from `serializeScene`),
 * the promoted referenced assets' bytes, and a `.meta` sidecar per asset pinning
 * its GUID + kind. No committed manifest and no project index are written — the
 * `.meta` sidecars are the identity source of truth, and a loader rebuilds the
 * manifest from them with `scanMetaManifest`.
 *
 * Performs **no I/O** — it returns `files` for a caller to write through an
 * `AssetSink`, then read back through an `AssetSource` against the same project
 * root. Promotion reads each asset's value from the App's stores and serializes
 * it through the kind's registered serializer.
 *
 * @example
 * ```ts
 * const project = serializeProject(app, {
 *   scenes: [{ location: 'scenes/main.rescene', data: serializeScene(app) }],
 *   promotions: [{ handle: meshHandle, kind: ASSET_TYPE.mesh, extension: 'rmesh' }],
 * });
 * for (const file of project.files) await sink.write(file.location, file.bytes);
 * // load: server.setManifest(scanMetaManifest(writtenFiles)); server.loadByGuid(...)
 * ```
 */
export const serializeProject = (app: App, opts: SerializeProjectOptions): SavedProject => {
  const files: SavedFile[] = [];
  const entries: AssetManifestEntry[] = [];

  // Promote referenced binary assets (meshes, …) through their serializers.
  const promotions = opts.promotions ?? [];
  if (promotions.length > 0) {
    const serializers = app.getResource(AssetSerializers);
    const stores = app.getResource(AssetStores);
    if (serializers === undefined) {
      throw new Error('serializeProject: no AssetSerializers — no asset kind is registered as persistable.');
    }
    if (stores === undefined) {
      throw new Error('serializeProject: no AssetStores — cannot resolve assets to promote.');
    }
    for (const promotion of promotions) {
      const serializer = serializers.get(promotion.kind);
      if (serializer === undefined) {
        throw new Error(`serializeProject: no serializer registered for kind '${promotion.kind}'.`);
      }
      const store = stores.storeFor(promotion.kind);
      if (store === undefined) {
        throw new Error(`serializeProject: no asset store registered for kind '${promotion.kind}'.`);
      }
      const value = store.get(promotion.handle);
      if (value === undefined) {
        throw new Error(
          `serializeProject: asset for kind '${promotion.kind}' is not present in its store.`,
        );
      }
      const promoted = promoteAsset(promotion.handle, value, promotion.kind, serializer, {
        extension: promotion.extension,
      });
      entries.push(promoted.entry);
      files.push({ location: promoted.location, bytes: promoted.bytes });
      files.push({ location: promoted.metaLocation, bytes: promoted.meta });
    }
  }

  // Scenes: the YAML document IS the bytes; each is a GUID-addressable asset
  // loaded by extension on reload (`.rescene` → the scene importer). A `.meta`
  // sidecar pins the GUID + kind so the manifest can be rebuilt from disk.
  const scenes: SavedScene[] = [];
  for (const scene of opts.scenes) {
    const guid = scene.guid ?? generateAssetGuid();
    scenes.push({ location: scene.location, guid });
    entries.push({ guid, location: scene.location, kind: SCENE_ASSET_KIND });
    files.push({ location: scene.location, bytes: encodeText(stringifyYaml(scene.data)) });
    files.push({
      location: `${scene.location}.meta`,
      bytes: encodeText(serializeMeta(bakeMeta(guid, SCENE_ASSET_KIND))),
    });
  }

  return {
    files,
    scenes,
    manifest: bakeManifest(entries),
  };
};
