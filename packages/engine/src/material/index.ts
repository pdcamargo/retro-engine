export type {
  BindGroupEntry,
  BindGroupSamplerType,
  BindGroupSchema,
  BindGroupTextureSampleType,
  BindGroupTextureViewDimension,
  BindingVisibility,
  ImageFallback,
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

export {
  INSTANCE_LAYOUT,
  MESH_INSTANCE_BYTE_SIZE,
  MESH_INSTANCE_FLOAT_COUNT,
  packInstanceTransform,
  PREVIOUS_INSTANCE_BYTE_SIZE,
  PREVIOUS_INSTANCE_FLOAT_COUNT,
  PREVIOUS_INSTANCE_LAYOUT,
  PREVIOUS_INSTANCE_TRANSFORM_BASE_LOCATION,
  packPreviousInstanceTransform,
} from './instance-layout';
export { MeshPreviousInstanceBuffer } from './mesh-previous-instance-buffer';
