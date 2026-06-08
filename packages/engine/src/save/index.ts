export { META_FORMAT_VERSION, bakeMeta, serializeMeta } from './meta';
export type { AssetMetaFile } from './meta';

export { promoteAsset } from './promote';
export type { PromotedAsset, PromoteOptions } from './promote';

export {
  PROJECT_FORMAT_VERSION,
  SCENE_ASSET_KIND,
  serializeProject,
} from './serialize-project';
export type {
  SavedFile,
  SavedProject,
  ProjectDocFile,
  ScenePromotion,
  AssetPromotion,
  SerializeProjectOptions,
} from './serialize-project';
