export { META_FORMAT_VERSION, bakeMeta, serializeMeta } from './meta';
export type { AssetMetaFile } from './meta';

export { promoteAsset } from './promote';
export type { PromotedAsset, PromoteOptions } from './promote';

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
