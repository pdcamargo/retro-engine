export { META_FORMAT_VERSION, bakeMeta, bakeMetaWithData, parseMeta, serializeMeta } from './meta';
export type { AssetMetaData, AssetMetaFile } from './meta';

export { promoteAsset } from './promote';
export type { PromotedAsset, PromoteOptions } from './promote';

export { generateMissingSidecars } from './generate-sidecars';
export type { GenerateSidecarsResult, MintedSidecar } from './generate-sidecars';

export { SCENE_ASSET_KIND, serializeProject } from './serialize-project';
export type {
  SavedFile,
  SavedProject,
  SavedScene,
  ScenePromotion,
  AssetPromotion,
  SerializeProjectOptions,
} from './serialize-project';

export { scanMetaManifest } from './scan-manifest';
export type { ProjectFile } from './scan-manifest';
