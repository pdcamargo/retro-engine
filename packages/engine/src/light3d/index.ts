export type { PointLight3dOptions } from './point-light-3d';
export { PointLight3d } from './point-light-3d';
export type { SpotLight3dOptions } from './spot-light-3d';
export { SpotLight3d } from './spot-light-3d';
export type { DirectionalLight3dOptions } from './directional-light-3d';
export { DirectionalLight3d } from './directional-light-3d';
export type { AmbientLightOptions } from './ambient-light';
export { AmbientLight } from './ambient-light';
export type { CascadeShadowConfigOptions } from './cascade-shadow-config';
export { CascadeShadowConfig, MAX_CASCADES } from './cascade-shadow-config';
export type { CascadeFitParams } from './cascade-shadow';
export { cascadeLightViewProj, computeCascadeSplits, reserveCasterLayers } from './cascade-shadow';
export {
  forwardFromMatrix,
  GPU_LIGHTS_BYTE_SIZE,
  GPU_LIGHTS_FLOAT_COUNT,
  GpuLights,
  MAX_DIRECTIONAL_LIGHTS,
  MAX_POINT_LIGHTS,
  MAX_SHADOW_CASTERS,
  MAX_SPOT_LIGHTS,
  NO_SHADOW_CASTER,
  packAmbient,
  packCascadeSplits,
  packCounts,
  packDirectionalCascadeBase,
  packDirectionalCasterIndex,
  packDirectionalLight,
  packPointLight,
  packShadowViewProj,
  packSpotCasterIndex,
  packSpotLight,
} from './gpu-lights';
export { LIGHT3D_WGSL } from './light-3d.wgsl';
export { NotShadowCaster } from './not-shadow-caster';
export type { ShadowCasterBatch } from './shadow-3d';
export { SHADOW_ATLAS_FORMAT, SHADOW_MAP_SIZE, Shadow3dState } from './shadow-3d';
export {
  assignCasterLayer,
  directionalLightViewProj,
  spotLightViewProj,
} from './shadow-3d-matrices';
export type { Shadow3dSettingsOptions } from './shadow-3d-settings';
export { Shadow3dSettings } from './shadow-3d-settings';
export { SHADOW3D_DEPTH_WGSL, SHADOW3D_WGSL } from './shadow-3d.wgsl';
export { Light3dPlugin } from './light-3d-plugin';
