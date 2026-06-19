import type { AssetGuid, AssetManifestEntry, AssetManifestFile, Handle } from '@retro-engine/assets';
import { bakeManifest, generateAssetGuid, serializeAssetManifest } from '@retro-engine/assets';
import { stringify as stringifyYaml } from 'yaml';

import { AssetSerializers } from '../asset/asset-serializers';
import { AssetStores } from '../asset/asset-stores';
import type { App } from '../index';
import type { SceneData } from '../scene/scene-data';

import { bakeMeta, serializeMeta } from './meta';
import { promoteAsset } from './promote';

/** Current `.retro-project` document wire-format version. */
export const PROJECT_FORMAT_VERSION = 1;

/** The manifest `kind` tag used for scene documents. */
export const SCENE_ASSET_KIND = 'Scene';

/** Default location of the manifest within a project. */
const DEFAULT_MANIFEST_LOCATION = 'assets.manifest.json';
/** Default location of the project document within a project. */
const DEFAULT_PROJECT_DOC_LOCATION = 'project.json';

/** One file to write, by location, through an `AssetSink`. */
export interface SavedFile {
  readonly location: string;
  readonly bytes: Uint8Array;
}

/**
 * The `.retro-project` index document: the format version, where the manifest
 * lives, and the GUIDs of the project's scenes (its entry points). A loader
 * reads this, loads the manifest, then `loadByGuid`s each scene.
 */
export interface ProjectDocFile {
  readonly version: number;
  readonly manifestLocation: string;
  readonly scenes: readonly AssetGuid[];
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
  /** Manifest location within the project. Defaults to `'assets.manifest.json'`. */
  readonly manifestLocation?: string;
  /** Project-document location within the project. Defaults to `'project.json'`. */
  readonly projectDocLocation?: string;
}

/** The pure-data artifacts of a saved project — written file-by-file through an `AssetSink`. */
export interface SavedProject {
  /** Every file to write, by location. The project doc and manifest come first for diagnosability. */
  readonly files: readonly SavedFile[];
  /** The baked manifest, for tooling/tests (also serialized into `files`). */
  readonly manifest: AssetManifestFile;
  /** The project index document (also serialized into `files`). */
  readonly projectDoc: ProjectDocFile;
}

const encodeText = (text: string): Uint8Array => new TextEncoder().encode(text);

/**
 * Serialize an App into the pure-data artifacts of a `.retro-project`: a manifest
 * (the exact shape `parseAssetManifest` reads), the scene documents (each a
 * GUID-addressable asset, carrying its resources from `serializeScene`), the
 * promoted referenced assets' bytes, `.meta` sidecars, and the project index.
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
 * ```
 */
export const serializeProject = (app: App, opts: SerializeProjectOptions): SavedProject => {
  const manifestLocation = opts.manifestLocation ?? DEFAULT_MANIFEST_LOCATION;
  const projectDocLocation = opts.projectDocLocation ?? DEFAULT_PROJECT_DOC_LOCATION;

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
  // loaded by extension on reload (`.rescene` → the scene importer).
  const sceneGuids: AssetGuid[] = [];
  for (const scene of opts.scenes) {
    const guid = scene.guid ?? generateAssetGuid();
    sceneGuids.push(guid);
    entries.push({ guid, location: scene.location, kind: SCENE_ASSET_KIND });
    files.push({ location: scene.location, bytes: encodeText(stringifyYaml(scene.data)) });
    files.push({
      location: `${scene.location}.meta`,
      bytes: encodeText(serializeMeta(bakeMeta(guid))),
    });
  }

  const manifest = bakeManifest(entries);
  const projectDoc: ProjectDocFile = {
    version: PROJECT_FORMAT_VERSION,
    manifestLocation,
    scenes: sceneGuids,
  };

  // Project doc + manifest first, so a partial write is diagnosable.
  return {
    files: [
      { location: projectDocLocation, bytes: encodeText(JSON.stringify(projectDoc, null, 2)) },
      { location: manifestLocation, bytes: encodeText(serializeAssetManifest(manifest)) },
      ...files,
    ],
    manifest,
    projectDoc,
  };
};
