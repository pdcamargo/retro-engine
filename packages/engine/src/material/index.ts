export type {
  BindGroupEntry,
  BindGroupSamplerType,
  BindGroupSchema,
  BindGroupTextureSampleType,
  BindGroupTextureViewDimension,
  BindingVisibility,
  UniformField,
  UniformFieldPack,
} from './bind-group-schema';
export {
  MaterialSchema,
  uniformFieldAlignment,
  uniformFieldByteSize,
  visibilityToFlags,
} from './bind-group-schema';

export type {
  AlphaMode,
  Material,
  MaterialPipelineKey,
  ShaderRef,
} from './material';
export { ShaderRefs, alphaModeKey } from './material';

export type { MaterialAssetEvent, MaterialHandle } from './materials';
export { Materials } from './materials';

export { RenderMaterials } from './render-materials';

export type { PreparedMaterial } from './prepare-bind-group';
export {
  prepareBindGroup,
  schemaToBindGroupLayout,
  uniformFieldOffsets,
  uniformSlotByteSize,
} from './prepare-bind-group';

export { MeshMaterial3d } from './mesh-material-3d';

export {
  ENTITY_TRANSFORM_BUFFER_SIZE,
  EntityTransformGpuCache,
  ensureEntityTransform,
  gcEntityTransforms,
} from './mesh-3d-transforms';

export type { MaterialCtor, MaterialPluginOptions } from './material-plugin';
export { MaterialPlugin } from './material-plugin';

export { UnlitMaterial, UnlitMaterialPlugin } from './unlit-material';
export { UNLIT_WGSL } from './unlit.wgsl';

export { StandardMaterial, StandardMaterialPlugin } from './standard-material';
export { PBR_WGSL } from './pbr.wgsl';

export {
  ExtendedMaterial,
  forExtendedMaterial,
  synthExtendedMaterialClass,
} from './extended-material';
