import type {
  CommandEncoder,
  Renderer,
  RenderPassEncoder,
  Surface,
  TextureView,
} from '@retro-engine/renderer-core';
import { World } from '@retro-engine/ecs';
import type { ComponentType } from '@retro-engine/ecs';
import type { Handle } from '@retro-engine/assets';
import type { RegisteredType, RegisterOptions, Schema } from '@retro-engine/reflect';

import { AppBundleRegistry } from './bundle/bundle-registry';
import type { BundleDefinition, BundleRegisterOptions } from './bundle/bundle-definition';
import { encodeBundleComponents } from './bundle/bundle-codec';
import { AppTypeRegistry } from './scene/app-type-registry';
import type { Scene } from './scene/scene-asset';
import { registerSceneState } from './scene/scene-state';
import type { AddSceneOptions } from './scene/scene-state';

import type { CameraView } from './camera/camera';
import { ClearColor } from './camera/clear-color';
import { SortedCameras } from './camera/sorted-cameras';
import type { CommandOp } from './commands';
import { applyCommandOp } from './commands';
import { ComponentHookRegistry } from './component-hooks';
import type { HookCtx, HookKind } from './component-hooks';
import { CorePlugin } from './core-plugin';
import type { Logger } from './log';
import { engineLogger } from './log';
import { runFixedMainLoop } from './fixed-time';
import { MessageRegistry } from './messages';
import type { ObserverHandler } from './observer-binding/handler';
import { ObserverHandlerRegistry } from './observer-binding/handler-registry';
import { ObserverRegistry } from './observers';
import type { Plugin, PluginObject, PluginsState } from './plugin';
import { wrapFunctionPlugin } from './plugin';
import type { PluginGroup } from './plugin-group';
import { PluginGroupBuilder } from './plugin-group';
import type { ParamSchema, Template } from './prefab/template';
import { TemplateRegistry } from './prefab/template-registry';
import { EMPTY_SLOT_VALUES } from './render-graph/slot';
import { RenderGraph } from './render-graph/render-graph';
import type { RegisteredSystem, SystemOrigin } from './schedule';
import { runStage, StageSystems } from './schedule';
import type { SystemInfo, StageGroup } from './schedule-info';
import { SystemProfiler } from './system-profiler';
import type { RenderSetName } from './render-set';
import { RenderSet } from './render-set';
import {
  initStateImpl,
  registerOnEnter,
  registerOnExit,
  registerOnTransition,
  registerStateScopedResource,
  runStateTransition,
  StateRegistry,
} from './state';
import type { Param, ParamValues, ResolveCtx, SystemId } from './system-param';
import { RunCondition } from './system-param';
import { Time } from './time';

export type { Logger } from './log';
export { createConsoleLogger, engineLogger } from './log';
export type { CameraView, ComputedCamera, Viewport } from './camera/camera';
export { Camera, CameraDepthTarget, CameraRenderTarget, ClearColorConfig } from './camera/camera';
export { ClearColor } from './camera/clear-color';
export type { Camera2dOptions, Camera3dOptions } from './camera/camera-bundles';
export { Camera2d, Camera3d } from './camera/camera-bundles';
export {
  buildOrthographicMatrix,
  buildPerspectiveMatrix,
  OrthographicProjection,
  PerspectiveProjection,
  ScalingMode,
  updateOrthographicArea,
} from './camera/projection';
export { MainCamera } from './camera/main-camera';
export { RenderLayers, renderLayersIntersect } from './camera/render-layers';
export { SortedCameras } from './camera/sorted-cameras';
export {
  HDR_TARGET_FORMAT,
  VIEW_UNIFORM_BYTE_SIZE,
  VIEW_UNIFORM_FLOAT_COUNT,
  VIEW_UNIFORM_WGSL,
  ViewBindGroupCache,
  ViewDepthCache,
  ViewHdrTargets,
  ViewPreviousFrame,
} from './camera/extracted';
export { CurrentHdrView } from './camera/current-hdr-view';
export type { JitterOffset } from './camera/jitter';
export { jitterProjection, ViewJitter } from './camera/jitter';
export { CameraPlugin } from './camera/camera-plugin';
export type { CommandsHandle, EntityCommands } from './commands';
export { Commands } from './commands';
export type { HookCtx, HookKind, LifecycleEvent } from './component-hooks';
export { Lifecycle } from './component-hooks';
export type { MessageEntry, MessageWriterHandle } from './messages';
export { MessageReader, MessageWriter } from './messages';
export type { TriggerHandle } from './observers';
export { Trigger } from './observers';
export type { Plugin, PluginFn, PluginObject, PluginsState } from './plugin';
export type { PluginGroup } from './plugin-group';
export { PluginGroupBuilder } from './plugin-group';
export type { Param, ParamValues, ResolveCtx, SystemId } from './system-param';
export { ChangedRes, Extract, Query, RenderCtx, Res, ResAdded, ResMut, RunCondition } from './system-param';
export type { SystemOrigin } from './schedule';
export type { StageGroup, SystemInfo } from './schedule-info';
export type { SystemTiming } from './system-profiler';
export { SystemProfiler } from './system-profiler';
export type { RenderSetName } from './render-set';
export { RenderSet } from './render-set';
export { RemovedComponents } from './change-detection';
export { anyWithComponent, inState, resourceChanged, resourceExists } from './run-conditions';
export type { NextStateInstance, StateInstance } from './state';
export { NextState, State } from './state';
export type { FixedClock, RealClock, VirtualClock } from './time';
export { Time } from './time';
export { DiagnosticsPlugin, DiagnosticsStore, updateDiagnostics } from './diagnostics';
export { composeTransformInto, decomposeTransformInto, GlobalTransform, Transform } from './transform';
export type { ChildBuilder } from './hierarchy';
export { Children, Parent } from './hierarchy';
export {
  checkVisibilitySystem,
  CheckVisibilityState,
  InheritedVisibility,
  NoFrustumCulling,
  updateFrustaSystem,
  ViewVisibility,
  Visibility,
  VisibilityPlugin,
  visibilityPropagateSystem,
} from './visibility';
export {
  Skeleton,
  SkinnedMeshPalette,
  computeSkinningPalette,
  SkinnedPalettes,
  SkinnedPaletteGpu,
  SKINNED_PALETTE_GROUP,
  SKINNED_INSTANCE_BYTE_SIZE,
  SKINNED_INSTANCE_FLOAT_COUNT,
  SKINNED_INSTANCE_LAYOUT,
  SKINNED_JOINT_OFFSET_LOCATION,
  packSkinnedInstance,
  SkinningPlugin,
} from './skinning';
export type { MorphTarget, MorphedDrawPayload } from './morph';
export {
  MorphTargets,
  MorphWeights,
  MorphGpu,
  MORPH_GROUP,
  MorphInstanceBuffer,
  makeMorphedDraw,
  MorphPlugin,
  SparseMorphTarget,
  parseSparseMorphTarget,
  SPARSE_MORPH_TARGET_ASSET_KIND,
  SparseMorphTargets,
  createSparseMorphTargetImporter,
  parseObjBaseMesh,
  OBJ_MESH_ASSET_KIND,
  createObjMeshImporter,
  composeMorphedPositions,
  bakeMorphedMesh,
} from './morph';
export type { WeightedMorphTarget } from './morph';
export type { ProxyFitting, ProxyAxisScale } from './proxy';
export {
  parseMhclo,
  fitProxy,
  PROXY_FITTING_ASSET_KIND,
  ProxyFittings,
  createProxyFittingImporter,
  ProxyPlugin,
} from './proxy';
export type { RigBone, MakeHumanRig, SkinWeights, RigPose, SpawnedRig, SpawnRigOptions } from './rig';
export {
  parseMakeHumanRig,
  parseMakeHumanWeights,
  buildRigPose,
  applySkinWeights,
  spawnRig,
} from './rig';
export {
  AnimationClip,
  clipDuration,
  ANIMATION_CLIP_ASSET_KIND,
  ANIMATION_CLIP_FORMAT_VERSION,
  AnimationClips,
  createAnimationClipImporter,
  createAnimationClipSerializer,
  AnimationPlayer,
  AnimationTarget,
  EffectiveClips,
  effectiveClip,
  sampleInto,
  addAnimationSampling,
  advancePlayerTime,
  AnimationPlugin,
  Pose,
  AnimationPoses,
  accumulateRotation,
  accumulateScale,
  accumulateTranslation,
  boneTrackField,
  commitPoseToTransforms,
  finalizePose,
  samplePoseFromClip,
  weights1d,
  weights2d,
  AnimationController,
  MotionScratch,
  evaluateMotion,
  motionDuration,
  ANIMATION_CONTROLLER_ASSET_KIND,
  ANIMATION_CONTROLLER_FORMAT_VERSION,
  AnimationControllers,
  createAnimationControllerImporter,
  createAnimationControllerSerializer,
  AnimationControllerPlayer,
  AnimationLayers,
  AvatarMask,
  AvatarMasks,
  AVATAR_MASK_ASSET_KIND,
  AnimationControllerRuntimes,
  createControllerRuntime,
  stateWeights,
  stepController,
  TwoBoneIK,
  IkChain,
  LookAtConstraint,
  IkPlugin,
  addIkSolve,
  solveTwoBone,
  solveCcd,
  solveAim,
  HUMANOID_BODY_PARTS,
  HUMANOID_SLOTS,
  slotForBoneName,
  buildHumanoidRetargetRig,
  RetargetRig,
  RETARGET_RIG_ASSET_KIND,
  RETARGET_RIG_FORMAT_VERSION,
  RetargetRigs,
  createRetargetRigImporter,
  createRetargetRigSerializer,
  proportionRatio,
  scaleRootTranslation,
  transferRotation,
  computeReferencePose,
  frameFromAxes,
  retargetClip,
  humanoidBodyPartMask,
  bindRetargetRig,
  RetargetPlugin,
} from './animation';
export type {
  AnimationTrack,
  Interpolation,
  KeyframeSampler,
  TrackTarget,
  RepeatMode,
  Blend2dMode,
  ConditionOp,
  ControllerLayer,
  ControllerParameter,
  ControllerState,
  LayerBlendMode,
  LayerSource,
  Motion,
  MotionInput,
  ParameterType,
  Transition,
  TransitionCondition,
  PlayerParameter,
  ControllerRuntime,
  ParameterAccess,
  TwoBoneSolveInput,
  TwoBoneSolveOutput,
  CcdSolveInput,
  AimSolveInput,
  HumanoidBodyPart,
  HumanoidSlot,
  RetargetSlot,
  BuildRetargetRigOptions,
  AuthoredReferencePose,
  ReferencePoseBone,
  ReferencePoseEntry,
  RootTranslationMode,
  RetargetClipOptions,
  EffectiveClipsView,
} from './animation';
export { Name } from './name';
export { AppBundleRegistry } from './bundle/bundle-registry';
export type { BundleDefinition, BundleRegisterOptions } from './bundle/bundle-definition';
export { instantiateBundle } from './bundle/instantiate';
export { bundleDecodeEnv, bundleEncodeEnv, encodeBundleComponents } from './bundle/bundle-codec';
export {
  BUNDLE_ASSET_EXTENSION,
  BUNDLE_ASSET_KIND,
  BUNDLE_FORMAT_VERSION,
  createBundleSerializer,
  deserializeBundle,
  serializeBundle,
} from './bundle/bundle-asset';
export { BundlePlugin } from './bundle/bundle-plugin';
export { AppTypeRegistry } from './scene/app-type-registry';
export {
  CompositionBaseline,
  CompositionRegistry,
  CompositionResolverRegistry,
  PendingAttachment,
  PendingCompositionOverrides,
} from './scene/composition';
export type {
  CompositionAnchor,
  CompositionBaselineEntry,
  CompositionProvider,
  CompositionResolver,
} from './scene/composition';
export type {
  SceneData,
  SerializedAttachment,
  SerializedComponent,
  SerializedDerivedOverride,
  SerializedEntity,
  SerializedObserverBinding,
  SerializedOverride,
  SerializedSceneRef,
  SerializedTemplateRef,
} from './scene/scene-data';
export { SCENE_FORMAT_VERSION } from './scene/scene-data';
export type { SerializeOptions } from './scene/serialize';
export {
  hasCompositionOverrides,
  serializePrefab,
  serializeScene,
  serializeWorld,
} from './scene/serialize';
export type { DeserializeOptions } from './scene/deserialize';
export { deserializeScene } from './scene/deserialize';
export type { SpawnSceneOptions } from './scene/spawn';
export { spawnScene } from './scene/spawn';
export { Scene, Scenes } from './scene/scene-asset';
export { createSceneImporter, createSceneSerializer } from './scene/scene-importer';
export { SceneInstance, SceneRoot } from './scene/scene-root';
export { addSceneInstantiation } from './scene/scene-reactor';
export { collectSceneHandleRefs, unloadUnusedAssets } from './scene/scene-streaming';
export {
  PREFAB_ASSET_EXTENSION,
  PREFAB_ASSET_KIND,
  ScenePlugin,
} from './scene/scene-plugin';
export { SceneStateRoots } from './scene/scene-state';
export type { AddSceneOptions } from './scene/scene-state';
export type { ParamSchema, ResolvedParams, Template, TemplateDefinition } from './prefab/template';
export { defineTemplate, expandTemplate } from './prefab/template';
export { TemplateRegistry } from './prefab/template-registry';
export { applyTemplate, spawnTemplate } from './prefab/template-commands';
export type { ObserverHandler, ObserverHandlerDefinition } from './observer-binding/handler';
export { defineObserverHandler } from './observer-binding/handler';
export { ObserverHandlerRegistry } from './observer-binding/handler-registry';
export type { PreprocessOptions, SpecializeFn } from './shader';
export {
  PipelineCache,
  preprocessWgsl,
  Shader,
  ShaderPlugin,
  ShaderRegistry,
  SpecializedRenderPipelines,
} from './shader';
export type {
  AllocatorSlice,
  Indices,
  MeshAttributeData,
  MeshVertexAttribute,
  MeshVertexAttributeId,
  MeshVertexBufferLayoutRef,
  RenderMesh,
  RenderMeshBufferInfo,
} from './mesh';
export type {
  AlphaMode,
  BindGroupEntry,
  BindGroupSamplerType,
  BindGroupSchema,
  BindGroupTextureSampleType,
  BindGroupTextureViewDimension,
  BindingVisibility,
  ImageFallback,
  Material,
  MaterialCtor,
  MaterialPipelineKey,
  MaterialPluginOptions,
  MaterialReflectSource,
  MaterialTypeDescriptor,
  PreparedMaterial,
  ShaderRef,
  UniformField,
  UniformFieldPack,
} from './material';
export type {
  DecodedHdr,
  DecodedRgba,
  HdrPreview,
  ImageDimension,
  RenderImage,
  RgbaImageDecoder,
} from './image';
export {
  bytesPerTexel,
  createHdrImporter,
  createImageBitmapRgbaDecoder,
  createImageImporter,
  decodeRadianceHdr,
  decodeRadianceHdrPreview,
  ExtractedImageAssetEvents,
  Image,
  ImagePlugin,
  Images,
  RenderImages,
} from './image';
export {
  asAssetIndex,
  Assets,
  handleEq,
  makeHandle,
  subAssetGuid,
  parseSubAssetGuid,
} from '@retro-engine/assets';
export type {
  AssetEvent,
  AssetImporter,
  AssetIndex,
  AssetSerializer,
  AssetSerializerRegistry,
  AssetSink,
  AssetSource,
  Handle,
  LoadContext,
} from '@retro-engine/assets';
export { AssetPlugin } from './asset/asset-plugin';
export { AssetServer } from './asset/asset-server';
export type { AssetLoadFailure, CompletedLoad } from './asset/asset-server';
export { AssetSerializers, registerAssetSerializer } from './asset/asset-serializers';
export { AssetKinds, registerAssetKind } from './asset/asset-kinds';
export type { AssetKindDescriptor } from './asset/asset-kinds';
export { ASSET_TYPE, AssetStores, registerAssetStore } from './asset/asset-stores';
export { FetchAssetSource } from './asset/fetch-source';
export { HttpPostAssetSink } from './asset/post-sink';
export { MemoryAssetSink, MemoryAssetSource } from './asset/memory-sink';
export { ProjectSaveSink } from './asset/project-save-sink';
export { applyCompletedLoads } from './asset/load-drain';
export * from './save';
export {
  alphaModeKey,
  createMaterialImporter,
  createMaterialSerializer,
  ExtendedMaterial,
  forExtendedMaterial,
  INSTANCE_LAYOUT,
  MATERIAL_ASSET_EXTENSION,
  MATERIAL_FORMAT_VERSION,
  materialReflectionSchema,
  MaterialPlugin,
  Materials,
  MaterialSchema,
  materialTypeName,
  MaterialTypes,
  MESH_INSTANCE_BYTE_SIZE,
  MESH_INSTANCE_FLOAT_COUNT,
  MeshMaterial3d,
  MeshPreviousInstanceBuffer,
  packInstanceTransform,
  packPreviousInstanceTransform,
  PBR_WGSL,
  prepareBindGroup,
  PREVIOUS_INSTANCE_BYTE_SIZE,
  PREVIOUS_INSTANCE_FLOAT_COUNT,
  PREVIOUS_INSTANCE_LAYOUT,
  PREVIOUS_INSTANCE_TRANSFORM_BASE_LOCATION,
  registerMaterialLoaders,
  RenderMaterials,
  schemaToBindGroupLayout,
  ShaderRefs,
  StandardMaterial,
  StandardMaterialPlugin,
  UNLIT_WGSL,
  UnlitMaterial,
  UnlitMaterialPlugin,
  uniformFieldAlignment,
  uniformFieldByteSize,
  uniformFieldOffsets,
  uniformSlotByteSize,
  visibilityToFlags,
} from './material';
export type {
  Material2d,
  Material2dCtor,
  Material2dPluginOptions,
  MaterialPipelineKey2d,
  Materials2d,
  RenderMaterials2d,
} from './material2d';
export {
  alphaBucketKey,
  COLOR_MATERIAL_2D_DEFAULT_MASK_CUTOFF,
  COLOR_MATERIAL_2D_WGSL,
  ColorMaterial2d,
  ColorMaterial2dPlugin,
  Material2dPlugin,
  MeshMaterial2d,
} from './material2d';
export {
  Aabb,
  Annulus,
  AnnulusMeshBuilder,
  calculateBoundsSystem,
  Capsule3d,
  Capsule3dMeshBuilder,
  Circle,
  CircleMeshBuilder,
  Cone,
  ConeMeshBuilder,
  ConicalFrustum,
  ConicalFrustumMeshBuilder,
  Cuboid,
  CuboidMeshBuilder,
  Cylinder,
  CylinderMeshBuilder,
  Ellipse,
  EllipseMeshBuilder,
  ExtractedMeshAssetEvents,
  indexByteSize,
  indexCount,
  indicesFormat,
  interMeshVertexBufferLayout,
  Mesh,
  Mesh2d,
  Mesh3d,
  MeshAllocator,
  MeshAllocatorSettings,
  MeshAttribute,
  Meshes,
  MeshPlugin,
  meshVertexAttribute,
  meshVertexAttributeId,
  Plane3d,
  Plane3dMeshBuilder,
  Rectangle,
  RectangleMeshBuilder,
  RegularPolygon,
  RegularPolygonMeshBuilder,
  RenderMeshes,
  Sphere,
  SphereMeshBuilder,
  Tetrahedron,
  TetrahedronMeshBuilder,
  Torus,
  TorusMeshBuilder,
  Triangle,
  TriangleMeshBuilder,
  u16Indices,
  u32Indices,
} from './mesh';
export type { Meshable, MeshBuilder, SphereKind } from './mesh';
export { MESH_FORMAT_VERSION, createMeshImporter, createMeshSerializer } from './mesh';
export type {
  Node as RenderNode,
  NodeRunContext as RenderNodeRunContext,
  PhaseItem2d,
  PhaseItem3d,
  RenderLabel,
  SlotInfo,
  SlotValue,
  SlotValues,
  ViewNode,
} from './render-graph';
export {
  buildCore2dSubGraph,
  buildCore3dSubGraph,
  CameraDriverLabel,
  CameraDriverNode,
  Core2dLabel,
  Core3dLabel,
  createLabel,
  EMPTY_SLOT_VALUES,
  isViewNode,
  Light2dAccumulationPass2dLabel,
  Light2dAccumulationPass2dNode,
  Light2dCompositePass2dLabel,
  Light2dCompositePass2dNode,
  Light2dNormalPrepass2dLabel,
  Light2dNormalPrepass2dNode,
  Light2dShadowPass2dLabel,
  Light2dShadowPass2dNode,
  MainPassLabel,
  MainPassNode,
  OpaquePass2dLabel,
  OpaquePass2dNode,
  OpaquePass3dLabel,
  OpaquePass3dNode,
  RenderGraph,
  RenderGraphPlugin,
  RenderSubGraph,
  Shadow3dPass3dLabel,
  Shadow3dPass3dNode,
  SlotType,
  TransparentPass2dLabel,
  TransparentPass2dNode,
  TransparentPass3dLabel,
  TransparentPass3dNode,
  ViewPhases2d,
  ViewPhases3d,
} from './render-graph';
export type {
  AtlasAnimationMode,
  AtlasAnimationOptions,
  SliceScaleMode,
  SpriteAlphaBucket,
  SpriteAnchor,
  SpriteBatch,
  SpriteImageMode,
  SpriteKey,
  SpriteOptions,
  SpriteSpecializeContext,
  TextureAtlasFromGridOptions,
  TextureSlicerOptions,
} from './sprite';
export {
  AtlasAnimation,
  atlasAnimationSystem,
  atlasSyncSystem,
  BorderRect,
  calculateSpriteBoundsSystem,
  packSpriteInstance,
  Rect,
  resolveAnchor,
  RetainedSpriteBuffer,
  SPRITE_INSTANCE_BYTE_SIZE,
  SPRITE_INSTANCE_FLOAT_COUNT,
  SPRITE_WGSL,
  Sprite,
  SpriteInstanceBuffer,
  SpritePipeline,
  SpritePlugin,
  SpritePreparedBatches,
  TextureAtlas,
  TextureAtlasLayout,
  TextureAtlasLayouts,
  TextureSlicer,
} from './sprite';
export type {
  AtlasYOrigin,
  FontMetrics,
  GlyphBlock,
  GlyphMetrics,
  GlyphRect,
  MsdfFontJson,
  PositionedGlyph,
  SdfFontOptions,
  StrokeGlyph,
  StrokeSegment,
  Text2dOptions,
  Text3dBatch,
  Text3dKey,
  Text3dQuery,
  TextAlign,
  TextBatch,
  TextKey,
  TextLayout,
  TextLayoutOptions,
  TextMeasure,
  TextOptions,
} from './text';
export {
  createFontImporter,
  DEFAULT_FONT_OPTIONS,
  Font,
  Fonts,
  generateDefaultFontAtlas,
  generateSdfFont,
  installDefaultFont,
  kerningKey,
  layoutText,
  measureText,
  MsdfFont,
  packColor,
  packGlyphInstance,
  packGlyphInstance3d,
  parseMsdfFont,
  prepareText3d,
  queueText3d,
  TEXT_INSTANCE_BYTE_SIZE,
  TEXT_INSTANCE_FLOAT_COUNT,
  TEXT3D_INSTANCE_BYTE_SIZE,
  TEXT3D_INSTANCE_FLOAT_COUNT,
  TEXT_WGSL,
  TEXT3D_WGSL,
  Text,
  Text2d,
  Text3dInstanceBuffer,
  Text3dPipeline,
  Text3dPreparedBatches,
  TextInstanceBuffer,
  TextPipeline,
  TextPlugin,
  TextPreparedBatches,
} from './text';
export type {
  AmbientLight2dOptions,
  DirectionalLight2dOptions,
  Light2dBatch,
  Light2dCameraTargets,
  Light2dCompositeKey,
  Light2dCompositeMode,
  LightOccluder2dOptions,
  OccluderSegment,
  PointLight2dOptions,
  SpotLight2dOptions,
} from './light2d';
export {
  AmbientLight2d,
  DirectionalLight2d,
  LIGHT2D_ACCUM_FORMAT,
  LIGHT2D_ACCUMULATION_WGSL,
  LIGHT2D_COMPOSITE_WGSL,
  LIGHT2D_DEFAULT_LIGHT_HEIGHT,
  LIGHT2D_INSTANCE_BYTE_SIZE,
  LIGHT2D_INSTANCE_FLOAT_COUNT,
  LIGHT2D_MAX_OCCLUDER_SEGMENTS,
  LIGHT2D_MAX_SHADOW_CASTERS,
  LIGHT2D_NORMAL_FORMAT,
  LIGHT2D_SHADOW_ATLAS_FORMAT,
  LIGHT2D_SHADOW_ATLAS_WIDTH,
  LIGHT2D_SHADOW_WGSL,
  Light2dInstanceBuffer,
  Light2dKind,
  Light2dNormalState,
  Light2dPipeline,
  Light2dPlugin,
  Light2dPreparedBatches,
  Light2dSettings,
  Light2dShadowState,
  LightOccluder2d,
  packAmbientLightInstance,
  packDirectionalLightInstance,
  packLightInstance,
  packSpotLightInstance,
  PointLight2d,
  prepareLight2dTargets,
  SpotLight2d,
  ViewLight2dTargets,
} from './light2d';
export type { PrepassFlags } from './prepass/components';
export {
  DepthPrepass,
  intersectPrepassFlags,
  MotionVectorPrepass,
  NormalPrepass,
  PREPASS_FLAGS_NONE,
  prepassFlagsAny,
} from './prepass/components';
export { PreviousGlobalTransform } from './prepass/previous-global-transform';
export {
  PrepassNode3d,
  PrepassNode3dLabel,
} from './prepass/prepass-3d-node';
export { PrepassFlagsByCamera, PrepassPlugin } from './prepass/prepass-plugin';
export { PREPASS_WGSL } from './prepass/prepass.wgsl';
export type {
  ViewPrepassCacheEntry,
  ViewPrepassCameraTargets,
} from './prepass/view-prepass-targets';
export {
  PREPASS_DEPTH_FORMAT,
  PREPASS_MOTION_VECTOR_FORMAT,
  PREPASS_NORMAL_FORMAT,
  ViewPrepassTargets,
} from './prepass/view-prepass-targets';

export type { TonemappingMethod } from './tonemapping/tonemapping';
export { DEFAULT_TONEMAPPING_METHOD, TONEMAPPING_METHODS, Tonemapping } from './tonemapping/tonemapping';
export { TONEMAPPING_WGSL } from './tonemapping/tonemapping.wgsl';
export type { TonemappingKey } from './tonemapping/tonemapping-pipeline';
export { TonemappingPipeline } from './tonemapping/tonemapping-pipeline';
export {
  makeTonemappingNode,
  TonemappingPass2dLabel,
  TonemappingPass3dLabel,
} from './tonemapping/tonemapping-node';
export { TonemappingPlugin } from './tonemapping/tonemapping-plugin';
export { ViewTonemapping } from './tonemapping/view-tonemapping';

export { Gizmos, type GizmoDrawOptions } from './gizmos/gizmos';
export {
  DEFAULT_GIZMO_MASK,
  EDITOR_GIZMO_LAYER,
  EDITOR_GIZMO_MASK,
  GIZMO_VERTEX_FLOATS,
  GIZMO_VERTEX_STRIDE,
} from './gizmos/gizmo-layers';
export { GizmoMesh, type GizmoDrawRange, type GizmoPipelineKey } from './gizmos/gizmo-mesh';
export { GizmoPass2dLabel, GizmoPass3dLabel } from './gizmos/gizmo-pass-node';
export { GizmoPlugin } from './gizmos/gizmo-plugin';

export { EditorGrid, type GridPlane } from './grid/grid-config';
export { GridRenderState, type GridPipelineKey } from './grid/grid-render-state';
export { GridPass3dLabel } from './grid/grid-pass-node';
export { GridPlugin } from './grid/grid-plugin';

export { Skybox } from './skybox/skybox';
export { SKYBOX_WGSL } from './skybox/skybox.wgsl';
export type { ExtractedSkybox } from './skybox/view-skybox';
export { ViewSkybox } from './skybox/view-skybox';
export type { SkyboxPipelineKey } from './skybox/skybox-pipeline';
export { SkyboxPipeline } from './skybox/skybox-pipeline';
export { makeSkyboxNode, SkyboxPass3dLabel } from './skybox/skybox-node';
export { SkyboxPlugin } from './skybox/skybox-plugin';

export { EnvironmentMapLight } from './environment/environment-map-light';
export { ENVIRONMENT_PREFILTER_WGSL } from './environment/environment.wgsl';
export { ActiveEnvironment } from './environment/active-environment';
export type { PrefilteredEnvironment } from './environment/environment-prefilter';
export { EnvironmentPrefilter, RenderEnvironmentMaps } from './environment/environment-prefilter';
export { EQUIRECT_TO_CUBE_WGSL } from './environment/equirect-to-cube.wgsl';
export type { ResolvedEnvironmentCube } from './environment/environment-cube';
export {
  EnvironmentCubeConverter,
  ensureEnvironmentCubeResources,
  RenderEnvironmentCubes,
  resolveEnvironmentCubeView,
} from './environment/environment-cube';
export { EnvironmentMapPlugin } from './environment/environment-plugin';

export { DEFAULT_MOTION_BLUR, MotionBlur } from './motion-blur/motion-blur';
export { MOTION_BLUR_WGSL } from './motion-blur/motion-blur.wgsl';
export type { MotionBlurKey } from './motion-blur/motion-blur-pipeline';
export { MotionBlurPipeline } from './motion-blur/motion-blur-pipeline';
export { makeMotionBlurNode, MotionBlurPass3dLabel } from './motion-blur/motion-blur-node';
export { MotionBlurPlugin } from './motion-blur/motion-blur-plugin';
export type { MotionBlurParams } from './motion-blur/view-motion-blur';
export { ViewMotionBlur } from './motion-blur/view-motion-blur';
export type { MotionBlurCacheEntry } from './motion-blur/view-motion-blur-targets';
export {
  MOTION_BLUR_PARAMS_BYTE_SIZE,
  MOTION_BLUR_TARGET_FORMAT,
  ViewMotionBlurTargets,
} from './motion-blur/view-motion-blur-targets';
export { DEFAULT_TAA, Taa } from './taa/taa';
export { haltonJitter, TAA_JITTER_SAMPLE_COUNT } from './taa/halton';
export { TAA_WGSL } from './taa/taa.wgsl';
export type { TaaKey } from './taa/taa-pipeline';
export { TaaPipeline } from './taa/taa-pipeline';
export { makeTaaNode, TaaPass3dLabel } from './taa/taa-node';
export { TaaPlugin } from './taa/taa-plugin';
export type { TaaParams } from './taa/view-taa';
export { ViewTaa } from './taa/view-taa';
export type { TaaCacheEntry } from './taa/view-taa-targets';
export {
  evictTaaTargets,
  resolveTaaTargets,
  TAA_PARAMS_BYTE_SIZE,
  TAA_TARGET_FORMAT,
  ViewTaaTargets,
} from './taa/view-taa-targets';

export { DEFAULT_AO, ScreenSpaceAo } from './ao/ao';
export { AO_BLUR_WGSL, AO_GTAO_WGSL, AO_TEMPORAL_WGSL } from './ao/ao.wgsl';
export type { AoKey } from './ao/ao-pipeline';
export { AoPipeline } from './ao/ao-pipeline';
export type { AoBlurKey } from './ao/ao-blur-pipeline';
export { AoBlurPipeline } from './ao/ao-blur-pipeline';
export type { AoTemporalKey } from './ao/ao-temporal-pipeline';
export { AoTemporalPipeline } from './ao/ao-temporal-pipeline';
export { AoBindGroupCache } from './ao/ao-bind-group-cache';
export {
  makeAoBlurNode,
  makeAoGtaoNode,
  makeAoTemporalNode,
  AoBlurPass3dLabel,
  AoGtaoPass3dLabel,
  AoTemporalPass3dLabel,
} from './ao/ao-node';
export { AoPlugin } from './ao/ao-plugin';
export type { AoParams } from './ao/view-ao';
export { ViewAo } from './ao/view-ao';
export type { AoCacheEntry } from './ao/view-ao-targets';
export {
  AO_HISTORY_FORMAT,
  AO_PARAMS_BYTE_SIZE,
  AO_TARGET_FORMAT,
  evictAoTargets,
  resolveAoTargets,
  ViewAoTargets,
} from './ao/view-ao-targets';
export type {
  AmbientLightOptions,
  CascadeFitParams,
  CascadeShadowConfigOptions,
  DirectionalLight3dOptions,
  PointLight3dOptions,
  Shadow3dSettingsOptions,
  ShadowCasterBatch,
  SpotLight3dOptions,
} from './light3d';
export {
  AmbientLight,
  assignCasterLayer,
  cascadeLightViewProj,
  CascadeShadowConfig,
  computeCascadeSplits,
  directionalLightViewProj,
  DirectionalLight3d,
  ENVIRONMENT_PARAMS_BYTE_SIZE,
  ENVIRONMENT_PARAMS_FLOAT_COUNT,
  forwardFromMatrix,
  GPU_LIGHTS_BYTE_SIZE,
  GPU_LIGHTS_FLOAT_COUNT,
  GpuLights,
  LIGHT3D_WGSL,
  Light3dPlugin,
  MAX_CASCADES,
  MAX_DIRECTIONAL_LIGHTS,
  MAX_POINT_LIGHTS,
  MAX_SHADOW_CASTERS,
  MAX_SPOT_LIGHTS,
  NO_SHADOW_CASTER,
  NotShadowCaster,
  packAmbient,
  packCascadeSplits,
  packCounts,
  packDirectionalCascadeBase,
  packDirectionalCasterIndex,
  packDirectionalLight,
  packPointLight,
  packShadowFlags,
  packShadowViewProj,
  packSpotCasterIndex,
  packSpotLight,
  PointLight3d,
  reserveCasterLayers,
  SHADOW3D_DEPTH_WGSL,
  SHADOW3D_WGSL,
  SHADOW_ATLAS_FORMAT,
  SHADOW_MAP_SIZE,
  Shadow3dSettings,
  Shadow3dState,
  ShadowFilteringMethod,
  spotLightViewProj,
  SpotLight3d,
} from './light3d';

/**
 * Named stage in the schedule — when a system runs within a frame.
 *
 * **Main schedule (per frame, in order):** `'first'` → `'startup'` (first
 * frame only) → `'preUpdate'` → *internal* `StateTransition` →
 * *internal* `RunFixedMainLoop` → `'update'` → `'postUpdate'` → `'last'` →
 * `'render'`.
 *
 * **FixedMain sub-schedule (zero or more times per frame, driven by the fixed
 * accumulator):** `'fixedFirst'` → `'fixedPreUpdate'` → `'fixedUpdate'` →
 * `'fixedPostUpdate'` → `'fixedLast'`.
 *
 * `'first'` is reserved for engine bookkeeping that must precede everything
 * else — most notably the engine's internal `Time` tick. User systems may
 * register on `'first'` to run "before everything"; they run after the
 * engine's internal systems in registration order.
 *
 * `'last'` is the symmetric stage at the bottom of `Main`, for cleanup that
 * must run after every gameplay system in the frame.
 *
 * State-transition schedules (`OnExit` / `OnTransition` / `OnEnter`) are not
 * stages — register against them through `App.onExit` / `onTransition` /
 * `onEnter`. The fixed-loop driver runs internally; users register against
 * the `'fixed*'` sub-stages above.
 */
export type Stage =
  | 'startup'
  | 'first'
  | 'preUpdate'
  | 'update'
  | 'postUpdate'
  | 'last'
  | 'render'
  | 'fixedFirst'
  | 'fixedPreUpdate'
  | 'fixedUpdate'
  | 'fixedPostUpdate'
  | 'fixedLast';

/**
 * Stages in canonical per-frame execution order, used by
 * {@link App.describeSchedule} to present the schedule the way it actually
 * runs. The fixed-timestep stages appear before `update` because the fixed
 * main loop runs between `preUpdate` and `update`.
 */
const SCHEDULE_STAGE_ORDER: readonly Stage[] = [
  'first',
  'startup',
  'preUpdate',
  'fixedFirst',
  'fixedPreUpdate',
  'fixedUpdate',
  'fixedPostUpdate',
  'fixedLast',
  'update',
  'postUpdate',
  'last',
  'render',
];

/**
 * Per-frame, per-camera context handed to render-stage systems via the
 * `RenderCtx` param. The encoder and pass are scoped to the current camera's
 * render pass and become invalid as soon as the engine closes the pass — do
 * not retain them across systems, across cameras, or across frames.
 *
 * `camera` exposes the {@link CameraView} for the camera the engine is
 * currently dispatching against; render systems read view matrices, the
 * resolved target, the viewport, and the per-camera view bind group through
 * this field. Render-set systems fire once per active camera per frame
 * (per ADR-0020), so a render system body sees a different `camera` each
 * invocation when multiple cameras are active.
 *
 * `surfaceView` is kept for backwards compatibility with code written
 * against ADR-0019; for cameras targeting the App's primary surface, it
 * equals `camera.target.view`, and for off-screen-target cameras it is also
 * set to that camera's target view (i.e. `camera.target.view` is always the
 * better source — `surfaceView` is the original field name).
 */
export interface RenderContext {
  readonly encoder: CommandEncoder;
  readonly pass: RenderPassEncoder;
  readonly surfaceView: TextureView;
  readonly camera: CameraView;
}

export interface AppOptions {
  readonly renderer: Renderer;
  /**
   * Canvas to present to. Optional — omitting it produces a headless `App`
   * whose render stage is skipped (useful for tests and server-side worlds).
   */
  readonly canvas?: HTMLCanvasElement;
  /**
   * Color used to clear the swapchain at the start of each render pass.
   * Defaults to opaque black.
   */
  readonly clearColor?: { r: number; g: number; b: number; a: number };
  /**
   * Override the App's diagnostic sink. Defaults to the shared `engineLogger`,
   * which writes to `console.*`. Pass a custom `Logger` to route engine and
   * plugin output to a studio panel, telemetry pipeline, or test buffer.
   */
  readonly logger?: Logger;
  /**
   * When `true`, the App measures each system's per-run wall-clock time into a
   * {@link SystemProfiler} resource, surfaced through
   * {@link App.describeSchedule}. Off by default — a shipped game pays nothing.
   * Editors and profiling tools opt in.
   */
  readonly profileSystems?: boolean;
  /**
   * Origin bucket for systems registered directly on the App (outside any
   * plugin) when they don't set their own `origin`. Defaults to `'user'`. An
   * editor host sets this to `'editor'` so its scaffolding systems bucket
   * correctly, leaving `'user'` for actual application code. Systems registered
   * by a plugin take the plugin's category and ignore this.
   */
  readonly defaultSystemOrigin?: SystemOrigin;
}

/** Options that gate or order a registered system. */
export interface AddSystemOptions {
  /** Composable predicate. If present and `test(app)` returns false, the system is skipped on that tick. */
  readonly runIf?: RunCondition;
  /**
   * Human-readable display name for tooling. Falls back to `label`, then the
   * function's name, then a generated `system #<id>` when omitted.
   */
  readonly name?: string;
  /**
   * Override the system's origin bucket. When omitted, the bucket is taken
   * from the registering plugin's {@link PluginObject.category}, defaulting to
   * `'user'`. Set this on systems registered directly on the App (outside any
   * plugin) to classify them.
   */
  readonly origin?: SystemOrigin;
  /**
   * Free-form label for this system within its stage. Other systems in the
   * same stage can reference the label via `before` / `after`. Labels do
   * **not** cross stages — `before: 'input'` only matches `input`-labelled
   * systems in the same stage.
   *
   * Labels need not be unique; `after: 'physics'` means "after every system
   * in this stage whose label is `'physics'`".
   */
  readonly label?: string;
  /**
   * Run this system before every same-stage system whose `label` matches one
   * of these. Forward references are allowed — the constraint activates as
   * soon as a matching label registers. Labels with no match are silently
   * ignored.
   */
  readonly before?: readonly string[];
  /**
   * Run this system after every same-stage system whose `label` matches one
   * of these. Forward references and unmatched labels behave like `before`.
   */
  readonly after?: readonly string[];
  /**
   * Render sub-set this system belongs to. Valid only when registering
   * against the `'render'` stage; passing it for any other stage throws at
   * registration. Omitting it on a render-stage system defaults to
   * {@link RenderSet.Render}, which preserves the single-pass shape that
   * predates ADR-0019.
   */
  readonly set?: RenderSetName;
}

/**
 * Holds a `World`, accepts plugins, and runs a stop-able frame loop.
 *
 * Systems register through a single signature — a stage name, a tuple of param
 * tokens declaring what the system reads or writes, the function itself, and
 * optional run conditions / ordering. The function receives one value per
 * param, in order; no implicit world argument.
 *
 * When a canvas is provided, the render stage drives a single main render pass
 * per frame: the engine acquires the swapchain view, begins a pass that clears
 * to {@link AppOptions.clearColor}, invokes each registered render system with
 * the `RenderCtx`-resolved frame context, ends the pass, and submits. A future
 * render-graph layer supersedes this one-pass-per-frame model once multiple
 * passes exist.
 */
export class App {
  readonly world = new World();
  /**
   * Per-frame render world. Render-stage systems run against this world by
   * default; main-world data is read through the {@link Extract} param
   * wrapper. Cleared at the start of every {@link App.renderFrame} call —
   * persistent render-side state lives in *resources* (which {@link App}
   * owns globally) rather than entities. See ADR-0019.
   */
  readonly renderWorld = new World();
  /** Backend renderer the app drives. Plugins use this to build shader modules, pipelines, and other GPU resources. */
  readonly renderer: Renderer;
  /**
   * Diagnostic sink for this App. Plugins and engine subsystems emit through
   * this logger (typically capturing a child view via `logger.child('name')`
   * at plugin-build time). Defaults to the shared `engineLogger`; override
   * via {@link AppOptions.logger}.
   */
  readonly logger: Logger;
  private readonly stages: Readonly<Record<Stage, StageSystems>> = {
    startup: new StageSystems(),
    first: new StageSystems(),
    preUpdate: new StageSystems(),
    update: new StageSystems(),
    postUpdate: new StageSystems(),
    last: new StageSystems(),
    render: new StageSystems(),
    fixedFirst: new StageSystems(),
    fixedPreUpdate: new StageSystems(),
    fixedUpdate: new StageSystems(),
    fixedPostUpdate: new StageSystems(),
    fixedLast: new StageSystems(),
  };
  private readonly resources = new Map<object, object>();
  private readonly resourceChangeFrames = new Map<object, number>();
  private readonly resourceAddedFrames = new Map<object, number>();
  /**
   * Callbacks queued by {@link App.whenResource} for resource types not yet
   * present, keyed by constructor. Fired (and the list dropped) the first time
   * `insertResource` registers a matching type.
   */
  private readonly resourceWaiters = new Map<object, Array<(value: object) => void>>();
  private readonly commandsBuffers = new Map<SystemId, CommandOp[]>();
  private readonly lastSeenTickMap = new Map<SystemId, number>();
  private readonly lastSeenFrameMap = new Map<SystemId, number>();
  private readonly stateRegistry = new StateRegistry();
  /** @internal Frame-buffered message channels. Drained at the end of `advanceFrame`. */
  readonly messageRegistry: MessageRegistry = new MessageRegistry();
  /** @internal Observer registry — global + entity-targeted, keyed by event class. */
  readonly observerRegistry: ObserverRegistry = new ObserverRegistry();
  /** @internal Component-lifecycle hook registry (plugin-side; class-static hooks are reflection-discovered). */
  readonly componentHookRegistry: ComponentHookRegistry = new ComponentHookRegistry();
  /**
   * @internal Re-entrant trigger depth tracker. Set by the observer dispatch
   * to the current op's depth; read by `CommandsHandle.trigger` to stamp
   * newly-enqueued trigger ops. Reset between command flushes.
   */
  currentTriggerDepth = 0;
  /**
   * @internal Stage of the system currently being flushed. Threaded into
   * observer dispatch's ResolveCtx so observer-body params resolving inside
   * the flush see the same stage as the triggering system.
   */
  currentFlushStage: Stage = 'update';
  private readonly canvas: HTMLCanvasElement | undefined;
  private readonly clearColor: { r: number; g: number; b: number; a: number };
  private surface: Surface | undefined;
  private resizeObserver: ResizeObserver | undefined;
  private running = false;
  private rafHandle: number | undefined;
  private nextSystemId = 1;
  private currentFrameTimestampMs = 0;
  private hasRunStartup = false;

  private readonly pluginRegistry: PluginObject[] = [];
  private readonly pluginNameIndex = new Map<string, PluginObject>();
  private readonly pluginsReadyFlags: boolean[] = [];
  private _pluginsState: PluginsState = 'Building';
  /**
   * Stack of plugins whose `build()` is currently executing. A stack, not a
   * single slot, because a plugin's `build()` may add sub-plugins (e.g.
   * `CorePlugin` adds the renderer plugins). The top entry attributes any
   * `addSystem` call to its immediate registering plugin.
   */
  private readonly pluginBuildStack: PluginObject[] = [];
  private readonly disabledSystems = new Set<SystemId>();
  /** Whether per-system timing is measured this run. Read on the hot path, so a plain field. */
  readonly systemProfilingEnabled: boolean;
  private readonly systemProfiler: SystemProfiler | undefined;
  private readonly defaultSystemOrigin: SystemOrigin;

  constructor(options: AppOptions) {
    this.renderer = options.renderer;
    this.canvas = options.canvas;
    this.clearColor = options.clearColor ?? { r: 0, g: 0, b: 0, a: 1 };
    this.logger = options.logger ?? engineLogger;
    this.systemProfilingEnabled = options.profileSystems ?? false;
    this.defaultSystemOrigin = options.defaultSystemOrigin ?? 'user';
    if (this.systemProfilingEnabled) {
      this.systemProfiler = new SystemProfiler();
      this.insertResource(this.systemProfiler);
    }
    // The reflection registry must exist before any plugin's build() runs, so
    // plugins can register their component schemas (via registerComponent) as
    // they wire themselves up. CorePlugin — added below — is the first to do so.
    this.insertResource(new AppTypeRegistry());
    // Bundles are App-scoped like the type registry, so a plugin can register a
    // reusable component group (via registerBundle) from its build().
    this.insertResource(new AppBundleRegistry());
    // Templates are App-scoped like the type registry, so a scene can resolve a
    // prefab by name and `spawnTemplate(app, 'Name', ...)` works after `build()`.
    this.insertResource(new TemplateRegistry());
    // Observer handlers are App-scoped the same way, so a scene can attach an
    // observer to an entity by referencing a registered handler name.
    this.insertResource(new ObserverHandlerRegistry());
    // ADR-0020: legacy `AppOptions.clearColor` is sugar for inserting a
    // `ClearColor` resource. CameraPlugin only inserts a default if no
    // ClearColor is already present, so user-supplied values win.
    if (options.clearColor !== undefined) {
      this.insertResource(new ClearColor(options.clearColor));
    }
    this.addPlugin(new CorePlugin());
  }

  /**
   * Current phase of the plugin lifecycle state machine. Starts at
   * `'Building'`; the first {@link App.advanceFrame} (or {@link App.run})
   * transitions through `'Ready'` and `'Cleaned'` once every plugin's
   * `ready()` reports true.
   */
  get pluginsState(): PluginsState {
    return this._pluginsState;
  }

  /**
   * Register a plugin. Accepts either an object implementing the
   * {@link PluginObject} interface or a {@link PluginFn} callback — function
   * plugins are auto-wrapped (named functions are unique by `fn.name`;
   * anonymous functions are non-unique).
   *
   * Throws if the App is no longer in `'Building'` (i.e. the first
   * `advanceFrame` has already run), or if the plugin's
   * {@link PluginObject.isUnique} reports true and another plugin with the
   * same `name()` is already registered. Calls `plugin.build(this)`
   * synchronously before returning.
   */
  addPlugin(plugin: Plugin): this {
    if (this._pluginsState !== 'Building') {
      throw new Error(
        `App.addPlugin: plugins must be registered before the first advanceFrame — App is in state '${this._pluginsState}'`,
      );
    }
    const wrapped = wrapFunctionPlugin(plugin);
    const name = wrapped.name();
    const unique = wrapped.isUnique?.() ?? true;
    if (unique && this.pluginNameIndex.has(name)) {
      throw new Error(
        `App.addPlugin: plugin '${name}' is unique and already registered — set isUnique() to false to allow duplicates`,
      );
    }
    this.pluginRegistry.push(wrapped);
    this.pluginsReadyFlags.push(false);
    this.pluginNameIndex.set(name, wrapped);
    this.pluginBuildStack.push(wrapped);
    try {
      wrapped.build(this);
    } finally {
      this.pluginBuildStack.pop();
    }
    return this;
  }

  /**
   * Register a batch of plugins in order. Accepts a `Plugin[]`, a
   * {@link PluginGroup} (its `.build()` builder is materialised), or a
   * {@link PluginGroupBuilder} (its current entry list is flushed). Each
   * resolved plugin is forwarded to {@link App.addPlugin} in order — the
   * same uniqueness and state-machine checks apply.
   */
  addPlugins(input: ReadonlyArray<PluginObject> | PluginGroup | PluginGroupBuilder): this {
    let plugins: ReadonlyArray<PluginObject>;
    if (Array.isArray(input)) {
      plugins = input;
    } else if (input instanceof PluginGroupBuilder) {
      plugins = input.build();
    } else {
      plugins = (input as PluginGroup).build().build();
    }
    for (const p of plugins) this.addPlugin(p);
    return this;
  }

  /**
   * Remove the contributions of the user project's plugins from a **running** App
   * — the teardown half of a code hot reload (ADR-0102). Drops every `'user'`-origin
   * system from every stage (purging its per-system buffers), unregisters the
   * components and resources the project registered beyond `baseline` (the
   * engine + editor set captured before the project first loaded), and removes the
   * project's plugins (`category() === 'user'`) from the registry so their rebuilt
   * versions can re-register under the same names.
   *
   * Does not touch engine/editor systems, types, or the world's entities — the
   * caller serializes the user scene first and respawns it after re-adding the
   * rebuilt plugins. Observer/hook removal is a tracked follow-up; a project that
   * registers global observers or component hooks should not yet rely on hot reload.
   */
  removeUserPlugins(baseline: {
    readonly components: ReadonlySet<string>;
    readonly resources: ReadonlySet<string>;
  }): void {
    const removedIds: SystemId[] = [];
    for (const key of Object.keys(this.stages) as Stage[]) {
      for (const sys of this.stages[key].remove((s) => s.origin === 'user')) removedIds.push(sys.id);
    }
    for (const id of removedIds) {
      this.disabledSystems.delete(id);
      this.commandsBuffers.delete(id);
      this.lastSeenTickMap.delete(id);
      this.lastSeenFrameMap.delete(id);
    }

    const atr = this.getResource(AppTypeRegistry)!;
    // Snapshot before iterating — the loop body unregisters, mutating the source.
    // eslint-disable-next-line unicorn/no-useless-spread
    for (const reg of [...atr.registry.components()]) {
      if (!baseline.components.has(reg.name)) atr.registry.unregister(reg.ctor);
    }
    // eslint-disable-next-line unicorn/no-useless-spread
    for (const [ctor, reg] of [...atr.resources]) {
      if (!baseline.resources.has(reg.name)) {
        atr.resources.delete(ctor);
        atr.registry.unregister(ctor);
        this.removeResource(ctor as unknown as new () => object);
      }
    }

    const keep: PluginObject[] = [];
    const keepFlags: boolean[] = [];
    for (let i = 0; i < this.pluginRegistry.length; i += 1) {
      const plugin = this.pluginRegistry[i]!;
      if (plugin.category?.() === 'user') this.pluginNameIndex.delete(plugin.name());
      else {
        keep.push(plugin);
        keepFlags.push(this.pluginsReadyFlags[i]!);
      }
    }
    this.pluginRegistry.length = 0;
    this.pluginRegistry.push(...keep);
    this.pluginsReadyFlags.length = 0;
    this.pluginsReadyFlags.push(...keepFlags);
  }

  /**
   * Add plugins to a **running** App, bypassing the `'Building'`-only guard of
   * {@link App.addPlugin} — the rebuild half of a code hot reload (ADR-0102). Each
   * plugin's `build()` runs immediately (attributed to it, so its systems bucket
   * correctly), then its `ready`/`finish`/`cleanup` fire once since the App is
   * already past those lifecycle phases. The only legal entry point for adding
   * plugins after the first frame; pair with {@link App.removeUserPlugins}.
   */
  addPluginsHot(plugins: ReadonlyArray<PluginObject>): this {
    for (const plugin of plugins) {
      const wrapped = wrapFunctionPlugin(plugin);
      const name = wrapped.name();
      const unique = wrapped.isUnique?.() ?? true;
      if (unique && this.pluginNameIndex.has(name)) {
        throw new Error(`App.addPluginsHot: plugin '${name}' is unique and already registered`);
      }
      this.pluginRegistry.push(wrapped);
      this.pluginsReadyFlags.push(true);
      this.pluginNameIndex.set(name, wrapped);
      this.pluginBuildStack.push(wrapped);
      try {
        wrapped.build(this);
      } finally {
        this.pluginBuildStack.pop();
      }
      wrapped.ready?.(this);
      wrapped.finish?.(this);
      wrapped.cleanup?.(this);
    }
    return this;
  }

  /**
   * Drive the plugin lifecycle one tick: while `_pluginsState === 'Building'`,
   * poll `ready()` for each not-yet-ready plugin; when every plugin reports
   * true, run `finish()` and `cleanup()` in registration order and advance
   * state to `'Cleaned'`. No-op once cleaned.
   *
   * Called at the very top of {@link App.advanceFrame}, before any system
   * runs. The schedule still runs every frame regardless of state — only
   * the lifecycle hooks are gated.
   */
  private tickPluginLifecycle(): void {
    if (this._pluginsState !== 'Building') return;
    let allReady = true;
    for (let i = 0; i < this.pluginRegistry.length; i += 1) {
      if (this.pluginsReadyFlags[i]) continue;
      const plugin = this.pluginRegistry[i]!;
      const ready = plugin.ready ? plugin.ready(this) : true;
      if (ready) {
        this.pluginsReadyFlags[i] = true;
      } else {
        allReady = false;
      }
    }
    if (!allReady) return;
    for (const plugin of this.pluginRegistry) {
      plugin.finish?.(this);
    }
    this._pluginsState = 'Ready';
    for (const plugin of this.pluginRegistry) {
      plugin.cleanup?.(this);
    }
    this._pluginsState = 'Cleaned';
  }

  /**
   * Latest `performance.now()`-style timestamp recorded by
   * {@link App.advanceFrame}. The engine's internal `Time.tick` system
   * (registered by `CorePlugin`) reads this to advance the clock. Exposed
   * for engine-internal plugins; gameplay code reads time through
   * `Res(Time)` / `ResMut(Time)`.
   *
   * @internal
   */
  currentFrameTimestamp(): number {
    return this.currentFrameTimestampMs;
  }

  /**
   * Mint a fresh {@link SystemId}. Used internally by state-transition
   * registration helpers (`onEnter`/`onExit`/`onTransition`) so their systems
   * carry an identity from the same numbering domain as stage-registered
   * systems. Not part of the public API.
   *
   * @internal
   */
  mintSystemId(): SystemId {
    return this.nextSystemId++ as SystemId;
  }

  /**
   * Lazily fetch or create the command buffer for a system id. Used by the
   * `Commands` param's resolved handle to enqueue ops; not part of the public
   * API.
   *
   * @internal
   */
  getCommandsBuffer(id: SystemId): CommandOp[] {
    let buf = this.commandsBuffers.get(id);
    if (!buf) {
      buf = [];
      this.commandsBuffers.set(id, buf);
    }
    return buf;
  }

  /**
   * Drain one system's command buffer, applying each enqueued op in order.
   * Newly-enqueued ops produced during dispatch (typically from observer
   * bodies or component hooks invoked inside `applyCommandOp`) are appended
   * to the same buffer and fire in the same flush, subject to the
   * re-entrant trigger depth limit. The buffer entry is removed from the
   * map at the end of the flush (in `finally`, so a throw mid-flush still
   * cleans up); a subsequent invocation of the same system therefore starts
   * with an empty buffer.
   *
   * Tracks `currentFlushStage` so observer dispatch inside the flush can
   * thread the triggering system's stage into the observer's ResolveCtx.
   *
   * Called by the stage runners after each system's function returns;
   * no-op when no commands were enqueued.
   *
   * @internal
   */
  flushSystemCommands(id: SystemId, stage: Stage = 'update'): void {
    const buf = this.commandsBuffers.get(id);
    if (!buf || buf.length === 0) return;
    const prevStage = this.currentFlushStage;
    this.currentFlushStage = stage;
    try {
      let i = 0;
      while (i < buf.length) {
        const op = buf[i]!;
        i += 1;
        applyCommandOp(op, this, id);
      }
    } finally {
      this.commandsBuffers.delete(id);
      this.currentFlushStage = prevStage;
      this.currentTriggerDepth = 0;
    }
  }

  /**
   * Discard one system's command buffer without applying any ops. Called by
   * the stage runners when a system's function throws — applying a partial
   * buffer is more error-prone than dropping it, and stale buffers leaking
   * into the next invocation of the same system id is a latent correctness
   * bug.
   *
   * @internal
   */
  discardSystemCommands(id: SystemId): void {
    this.commandsBuffers.delete(id);
  }

  /**
   * Read the pre-run tick snapshot previously recorded for system `id`, or
   * `0` if the system has not run yet. Called by the scheduler immediately
   * before invoking a system to populate `ResolveCtx.lastSeenTick`.
   *
   * @internal
   */
  lastSeenTickOf(id: SystemId): number {
    return this.lastSeenTickMap.get(id) ?? 0;
  }

  /**
   * Store the pre-run tick snapshot for system `id`. Called by the scheduler
   * after a system's body returns and its command buffer flushes. The stored
   * value is `World.changeTick` as observed *before* the system ran — so the
   * system re-observes its own prior-frame mutations on its next invocation
   * (the Bevy-aligned pre-run snapshot model).
   *
   * @internal
   */
  recordSystemLastSeenTick(id: SystemId, tick: number): void {
    this.lastSeenTickMap.set(id, tick);
  }

  /**
   * Read the pre-run frame snapshot previously recorded for system `id`,
   * or `-1` if the system has not run yet (so any frame-stamped change is
   * strictly greater and visible on the first invocation). Called by the
   * scheduler before resolving params to seed `ResolveCtx.lastSeenFrame`.
   *
   * The frame counter is per-frame (driven by {@link Time.frame}) and
   * distinct from `lastSeenTick`, which is per-mutation. The two coexist:
   * components use the tick, resources use the frame.
   *
   * @internal
   */
  lastSeenFrameOf(id: SystemId): number {
    return this.lastSeenFrameMap.get(id) ?? -1;
  }

  /**
   * Store the pre-run frame snapshot for system `id`. Called by the
   * scheduler after a system's body returns and its command buffer
   * flushes. Mirrors {@link recordSystemLastSeenTick} for the resource
   * frame counter — pre-run snapshot semantics so a system that *causes*
   * a resource change can re-observe it on its own next invocation via
   * `ChangedRes(ctor)`.
   *
   * @internal
   */
  recordSystemLastSeenFrame(id: SystemId, frame: number): void {
    this.lastSeenFrameMap.set(id, frame);
  }

  /**
   * Drain every pending command buffer, in system-id registration order.
   * Intended for orchestration code, tests, and plugin lifecycle hooks that
   * need to materialise queued mutations at a known point outside the
   * per-system flush hooks.
   *
   * Calling this from within a system's function while a `Query` iterator
   * over the same world is live is undefined behavior — structural mutations
   * applied here can invalidate the iterator. Split into two systems with
   * `before` / `after` ordering instead.
   */
  flushCommands(): void {
    if (this.commandsBuffers.size === 0) return;
    const ids = Array.from(this.commandsBuffers.keys());
    for (const id of ids) this.flushSystemCommands(id);
  }

  /**
   * Initialise a state type and seed its initial value. The first frame after
   * this call fires `OnEnter(initial)` during `StateTransition`, between
   * `Startup` and `PreUpdate`'s downstream effects. `initState` may be called
   * once per state type — a second call for the same `ctor` throws.
   *
   * Registers two resources keyed off `State(ctor)` and `NextState(ctor)`:
   * the current-value slot and the pending-transition slot.
   *
   * @example
   * ```ts
   * class GameState {
   *   static readonly Boot    = new GameState('Boot');
   *   static readonly Playing = new GameState('Playing');
   *   constructor(public readonly name: string) {}
   * }
   * app.initState(GameState, GameState.Boot);
   * ```
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  initState<S extends object>(ctor: new (...args: any[]) => S, initial: S): this {
    initStateImpl(this, this.stateRegistry, ctor, initial);
    return this;
  }

  /**
   * Register a system to run when the state exits `value`. The system runs
   * during the `StateTransition` phase, **before** state-scoped resources
   * for `value` are removed and before `State.current` updates — so it can
   * still read both.
   */
  onExit<S extends object, const Ps extends readonly Param<unknown>[]>(
    value: S,
    params: Ps,
    fn: (...args: ParamValues<Ps>) => void,
    options?: { runIf?: RunCondition },
  ): this {
    registerOnExit(this, this.stateRegistry, value, params, fn, options);
    return this;
  }

  /**
   * Register a system to run when the state transitions specifically from
   * `from` to `to`. Per-pair only — there is no any-to-any helper in v1.
   * Runs after `State.current` has updated and before `OnEnter(to)`.
   */
  onTransition<S extends object, const Ps extends readonly Param<unknown>[]>(
    from: S,
    to: S,
    params: Ps,
    fn: (...args: ParamValues<Ps>) => void,
    options?: { runIf?: RunCondition },
  ): this {
    registerOnTransition(this, this.stateRegistry, from, to, params, fn, options);
    return this;
  }

  /**
   * Register a system to run when the state enters `value`. The system runs
   * during the `StateTransition` phase, **after** state-scoped resources for
   * `value` are inserted — so `OnEnter` code can read them.
   */
  onEnter<S extends object, const Ps extends readonly Param<unknown>[]>(
    value: S,
    params: Ps,
    fn: (...args: ParamValues<Ps>) => void,
    options?: { runIf?: RunCondition },
  ): this {
    registerOnEnter(this, this.stateRegistry, value, params, fn, options);
    return this;
  }

  /**
   * Register a resource that lives only while the state is `value`. Inserted
   * before `OnEnter(value)` runs and removed after `OnExit(value)` completes
   * — so user `OnExit` code can read the resource one last time.
   *
   * Calling more than once for the same `value` queues additional resources;
   * all are inserted on enter and removed on exit, in registration order.
   */
  insertStateScopedResource<S extends object>(value: S, resource: object): this {
    registerStateScopedResource(this.stateRegistry, value, resource);
    return this;
  }

  /**
   * Bind a scene asset to a state value: spawn the scene on `OnEnter(state)` and
   * tear it down on `OnExit(state)`. A `SceneRoot` is spawned on enter; the scene
   * instantiates under it once the asset is ready, and despawning the root on exit
   * cascades through the subtree with no leaked entities.
   *
   * Add `ScenePlugin` (for the `Scenes` store + reactor) and call `initState` for
   * the state type before this. Teardown runs in `OnExit` registration order, so
   * any `OnExit` systems registered **before** this call run before the scene is
   * despawned; state-scoped resources are removed afterwards.
   *
   * @example
   * ```ts
   * app.initState(SceneId, SceneId.MainMenu);
   * app.addScene(SceneId.Level1, assetServer.load<Scene>('level1.rescene'));
   * ```
   */
  addScene<S extends object>(state: S, handle: Handle<Scene>, opts?: AddSceneOptions): this {
    registerSceneState(this, state, handle, opts);
    return this;
  }

  /**
   * Register a system at `stage`. The function receives one argument per param
   * in `params`, in order; pass `[]` for a zero-param system. The optional
   * `runIf` condition gates execution per tick; `label` / `before` / `after`
   * declare ordering constraints within the stage.
   *
   * Stage-scoped params (e.g. `RenderCtx`) throw at registration if used in
   * the wrong stage. Introducing an ordering cycle via `before` / `after`
   * also throws at registration, naming the systems involved.
   */
  addSystem<const Ps extends readonly Param<unknown>[]>(
    stage: Stage,
    params: Ps,
    fn: (...args: ParamValues<Ps>) => void,
    options?: AddSystemOptions,
  ): this {
    for (const p of params) {
      if (p.scope !== undefined && p.scope !== stage) {
        throw new Error(
          `App.addSystem: param scoped to stage '${p.scope}' cannot be used in stage '${stage}'`,
        );
      }
    }
    if (options?.set !== undefined && stage !== 'render') {
      throw new Error(
        `App.addSystem: the 'set' option is only valid for the 'render' stage — got stage '${stage}'`,
      );
    }
    const id = this.nextSystemId++ as SystemId;
    const buildingPlugin = this.pluginBuildStack[this.pluginBuildStack.length - 1];
    const name =
      options?.name ?? options?.label ?? (fn.name !== '' ? fn.name : undefined) ?? `system #${id}`;
    const origin = options?.origin ?? this.resolveBuildOrigin();
    const originPlugin = buildingPlugin?.name() ?? null;
    const entry: RegisteredSystem = {
      id,
      params,
      fn: fn as (...args: unknown[]) => void,
      name,
      origin,
      originPlugin,
      ...(options?.runIf !== undefined ? { runIf: options.runIf } : {}),
      ...(options?.label !== undefined ? { label: options.label } : {}),
      ...(options?.before !== undefined ? { before: options.before } : {}),
      ...(options?.after !== undefined ? { after: options.after } : {}),
      ...(options?.set !== undefined ? { set: options.set } : {}),
    };
    this.stages[stage].push(entry);
    // A newly added label may resolve a forward-reference constraint in a
    // sibling stage — labels are stage-local, so no cross-stage invalidation
    // is needed.
    return this;
  }

  /**
   * Resolve the origin bucket for a system registered during the current
   * `build()`, walking the plugin build stack from the innermost plugin
   * outward and taking the first declared {@link PluginObject.category}. This
   * lets a parent plugin (e.g. `CorePlugin`) classify every sub-plugin it adds
   * without each one re-declaring its category. Defaults to `'user'`.
   */
  private resolveBuildOrigin(): SystemOrigin {
    for (let i = this.pluginBuildStack.length - 1; i >= 0; i -= 1) {
      const category = this.pluginBuildStack[i]!.category?.();
      if (category !== undefined) return category;
    }
    return this.defaultSystemOrigin;
  }

  /**
   * Enable or disable a registered system by id. A disabled system is skipped
   * by the stage runner every frame — its params are not resolved and its body
   * never runs — until re-enabled. Disabling an engine system can break the
   * App; this is a tooling power tool, not a gameplay gate (use `runIf` for
   * that). Unknown ids are ignored.
   */
  setSystemEnabled(id: SystemId, enabled: boolean): void {
    if (enabled) this.disabledSystems.delete(id);
    else this.disabledSystems.add(id);
  }

  /** Whether the system with this id currently runs (the inverse of {@link App.isSystemDisabled}). */
  isSystemEnabled(id: SystemId): boolean {
    return !this.disabledSystems.has(id);
  }

  /**
   * Whether the system with this id is disabled. Checked by the stage and
   * render-set runners before resolving params.
   *
   * @internal
   */
  isSystemDisabled(id: SystemId): boolean {
    return this.disabledSystems.has(id);
  }

  /**
   * Fold one system run's duration into the profiler. No-op when profiling is
   * off. Called by the runners; not part of the public API.
   *
   * @internal
   */
  recordSystemTime(id: SystemId, ms: number): void {
    this.systemProfiler?.record(id, ms);
  }

  /**
   * Snapshot the schedule for tooling: every registered system, grouped by
   * stage in execution order, each stage's systems in topological run order.
   * Includes display name, origin bucket, registering plugin, enabled state,
   * and — when {@link AppOptions.profileSystems} is on — rolling per-system
   * timings. Allocates a fresh, reference-free snapshot per call.
   */
  describeSchedule(): readonly StageGroup[] {
    return SCHEDULE_STAGE_ORDER.map((stage) => ({
      stage,
      systems: this.stages[stage].ordered().map((sys) => this.toSystemInfo(sys, stage)),
    }));
  }

  private toSystemInfo(sys: RegisteredSystem, stage: Stage): SystemInfo {
    const timing = this.systemProfiler?.get(sys.id);
    return {
      id: sys.id,
      name: sys.name,
      stage,
      origin: sys.origin,
      originPlugin: sys.originPlugin,
      enabled: !this.disabledSystems.has(sys.id),
      hasRunCondition: sys.runIf !== undefined,
      ...(sys.set !== undefined ? { set: sys.set } : {}),
      ...(sys.label !== undefined ? { label: sys.label } : {}),
      ...(timing !== undefined ? { lastMs: timing.lastMs, avgMs: timing.avgMs } : {}),
    };
  }

  /**
   * Register a resource instance, keyed by its constructor. Systems read it
   * through the `Res(ctor)` / `ResMut(ctor)` params. Inserting a second value
   * of the same class replaces the prior instance; a `devWarn` is emitted on
   * replace, silent in production builds.
   *
   * Stamps the resource's change-frame on every call so `resourceChanged`
   * fires for both fresh inserts and replacements. The added-frame slot
   * (read by `ResAdded`) is stamped only on fresh inserts — replacing an
   * already-registered resource bumps "changed" but not "added."
   */
  insertResource<T extends object>(value: T): this {
    const key = value.constructor;
    const wasPresent = this.resources.has(key);
    if (wasPresent) {
      this.logger.devWarn(
        `App.insertResource: replacing existing resource of type ${(key as { name?: string }).name || '<anonymous>'}`,
      );
    }
    this.resources.set(key, value);
    const frame = this.currentFrameNumber();
    this.resourceChangeFrames.set(key, frame);
    if (!wasPresent) {
      this.resourceAddedFrames.set(key, frame);
      const waiters = this.resourceWaiters.get(key);
      if (waiters !== undefined) {
        this.resourceWaiters.delete(key);
        for (const waiter of waiters) waiter(value);
      }
    }
    return this;
  }

  /**
   * Run `callback` with a resource of type `ctor` as soon as one is available:
   * immediately if it is already registered, otherwise once the first
   * {@link App.insertResource} of that type happens. The callback fires at most
   * once per registration and is dropped after firing.
   *
   * This decouples a registration from the plugin order: a plugin whose setup
   * depends on a resource another plugin inserts can wire it up via
   * `whenResource` from its own `build()` without caring whether that other
   * plugin was added before or after it.
   */
  whenResource<T extends object>(ctor: new (...args: any[]) => T, callback: (value: T) => void): void {
    const existing = this.getResource(ctor);
    if (existing !== undefined) {
      callback(existing);
      return;
    }
    let waiters = this.resourceWaiters.get(ctor);
    if (waiters === undefined) {
      waiters = [];
      this.resourceWaiters.set(ctor, waiters);
    }
    waiters.push(callback as (value: object) => void);
  }

  /**
   * Register a component's reflection schema in this App's registry, so the
   * scene serializer can round-trip it. The owning plugin registers its own
   * components from `build()`; a stable `name` (in `opts`) is mandatory — class
   * names are unreliable under minification.
   *
   * Derived or computed components (recomputed every frame by a system) and
   * reciprocal relationship targets (rebuilt from their edge) are deliberately
   * left unregistered — only authored state persists in a scene.
   *
   * @example
   * ```ts
   * app.registerComponent(Transform, {
   *   translation: t.vec3, rotation: t.quat, scale: t.vec3,
   * }, { name: 'Transform' });
   * ```
   */
  registerComponent<T extends object>(
    ctor: ComponentType<T>,
    schema: Schema<T>,
    opts?: RegisterOptions<T>,
  ): RegisteredType<T> {
    return this.getResource(AppTypeRegistry)!.registry.registerComponent(ctor, schema, opts);
  }

  /**
   * Register a value type's reflection schema in this App's registry. Unlike
   * {@link App.registerComponent}, the type is not marked entity-attachable —
   * use this for nested value types referenced by a component's schema (via
   * `t.type(...)`).
   */
  registerType<T extends object>(
    ctor: ComponentType<T>,
    schema: Schema<T>,
    opts?: RegisterOptions<T>,
  ): RegisteredType<T> {
    return this.getResource(AppTypeRegistry)!.registry.registerType(ctor, schema, opts);
  }

  /**
   * Register a named, reusable group of components — a {@link BundleDefinition},
   * the engine's introspectable equivalent of a Bevy bundle. Pass the components
   * as live instances carrying the bundle's default values; their authored field
   * values are captured at registration. Every component's type must already be
   * registered (via {@link App.registerComponent}), so register a bundle after
   * the components it includes — typically from the same plugin's `build()`.
   *
   * Spawning the bundle (e.g. through tooling) stamps fresh, independent
   * instances onto an entity; the entity keeps no link to the definition.
   *
   * @example
   * ```ts
   * app.registerBundle('Player', [
   *   new Transform(),
   *   new Sprite({ color: Color.RED }),
   * ], { category: ['Gameplay'], icon: 'user' });
   * ```
   */
  registerBundle(
    name: string,
    components: readonly object[],
    opts?: BundleRegisterOptions,
  ): BundleDefinition {
    const registry = this.getResource(AppTypeRegistry)!.registry;
    const def: BundleDefinition = {
      name,
      components: encodeBundleComponents(registry, components),
      ...(opts?.icon !== undefined ? { icon: opts.icon } : {}),
      ...(opts?.category !== undefined ? { category: opts.category } : {}),
      ...(opts?.description !== undefined ? { description: opts.description } : {}),
    };
    this.getResource(AppBundleRegistry)!.register(def);
    return def;
  }

  /**
   * Register a resource's reflection schema in this App's registry, so it
   * round-trips into a saved scene and is restored on load. A resource carries
   * no entity identity, so it lives in `SceneData.resources` rather than on an
   * entity; the owning plugin registers it from `build()` next to its components,
   * with a mandatory stable `name` (class names are unreliable under
   * minification).
   *
   * Derived or transient resources — render-world caches, per-frame GPU state,
   * anything a system recomputes at startup — are deliberately left unregistered:
   * only authored world/render settings a saved scene should restore belong here.
   *
   * @example
   * ```ts
   * app.registerResource(AmbientLight, {
   *   color: t.vec3, brightness: t.number,
   * }, { name: 'AmbientLight' });
   * ```
   */
  registerResource<T extends object>(
    ctor: ComponentType<T>,
    schema: Schema<T>,
    opts?: RegisterOptions<T>,
  ): RegisteredType<T> {
    const atr = this.getResource(AppTypeRegistry)!;
    const reg = atr.registry.registerType(ctor, schema, opts);
    atr.resources.set(ctor as ComponentType<object>, reg as RegisteredType);
    return reg;
  }

  /**
   * Register a {@link Template} in this App, keyed by its stable name. The owning
   * plugin registers its templates from `build()`; registration is what lets a
   * scene reference the template by name and `spawnTemplate(app, 'Name', ...)`
   * resolve it. Throws if the name is already taken.
   */
  registerTemplate<P extends ParamSchema>(template: Template<P>): Template<P> {
    return this.getResource(TemplateRegistry)!.register(template);
  }

  /**
   * Register an {@link ObserverHandler} in this App, keyed by its stable name.
   * The owning plugin registers its handlers from `build()`; registration is what
   * lets a scene attach the observer to an entity by referencing the handler name
   * (the handler carries the event it observes and the body to run). Throws if the
   * name is already taken.
   */
  registerObserverHandler<E extends object, const Ps extends readonly Param<unknown>[]>(
    handler: ObserverHandler<E, Ps>,
  ): ObserverHandler<E, Ps> {
    return this.getResource(ObserverHandlerRegistry)!.register(handler);
  }

  /**
   * Remove a resource by constructor key. Returns the removed instance, or
   * `undefined` if no resource of that class was registered. Idempotent — a
   * second call with the same key returns `undefined` without throwing.
   *
   * Clears the resource's added-frame slot so a subsequent re-insertion
   * counts as a fresh "added" again from the next reader's perspective.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  removeResource<T>(ctor: new (...a: any[]) => T): T | undefined {
    const value = this.resources.get(ctor) as T | undefined;
    if (this.resources.delete(ctor)) {
      this.resourceChangeFrames.set(ctor, this.currentFrameNumber());
      this.resourceAddedFrames.delete(ctor);
    }
    return value;
  }

  /**
   * Record that a resource has been mutated in place. Bumps the resource's
   * change-frame so `resourceChanged(ctor)` (run-condition) and
   * `ChangedRes(ctor)` (param) observe the mutation on the current frame.
   *
   * Symmetric writer-side counterpart to `World.markChanged(entity, type)`
   * for components. The added-frame slot is not touched — mark-changed is
   * for in-place mutations, not insertions.
   *
   * Emits a `devWarn` and is otherwise a no-op when no resource of the
   * given class is currently registered; rejecting the call would force
   * callers to guard every mark behind a `resourceExists` check.
   *
   * @example
   * ```ts
   * app.addSystem('update', [ResMut(Counter)], (c) => {
   *   c.value += 1;
   *   app.markResourceChanged(Counter);
   * });
   * ```
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  markResourceChanged<T>(ctor: new (...a: any[]) => T): this {
    if (!this.resources.has(ctor)) {
      this.logger.devWarn(
        `App.markResourceChanged: no resource of type ${(ctor as { name?: string }).name || '<anonymous>'} is registered — call has no effect`,
      );
      return this;
    }
    this.resourceChangeFrames.set(ctor, this.currentFrameNumber());
    return this;
  }

  /**
   * Frame number on which the resource keyed by `ctor` was most recently
   * inserted, replaced, removed, or {@link markResourceChanged}-stamped.
   * Returns `undefined` if no such operation has ever been recorded for
   * this key. Used by the `resourceChanged` run-condition and the
   * `ChangedRes` param.
   *
   * In-place field writes (`resource.value = 1`) do not auto-bump the
   * stamp — call `markResourceChanged` to mark them visible.
   *
   * @internal
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getResourceChangeFrame<T>(ctor: new (...a: any[]) => T): number | undefined {
    return this.resourceChangeFrames.get(ctor);
  }

  /**
   * Frame number on which the resource keyed by `ctor` was most recently
   * **inserted fresh** (i.e. an `insertResource` call against a key that
   * was not currently registered). Re-inserts that replace an existing
   * resource do not bump this stamp. Removing the resource clears the
   * slot, so a future re-insert counts as a fresh add again.
   *
   * Returns `undefined` if the resource has never been inserted, or has
   * been removed and not yet re-inserted. Used by the `ResAdded` param.
   *
   * @internal
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getResourceAddedFrame<T>(ctor: new (...a: any[]) => T): number | undefined {
    return this.resourceAddedFrames.get(ctor);
  }

  /**
   * Current frame counter — `Time.frame` if the {@link Time} resource is
   * registered, otherwise `0`. The engine stamps this onto each resource's
   * change-frame slot on insert/replace/remove/mark, and the scheduler
   * snapshots it pre-system to seed `ResolveCtx.lastSeenFrame`.
   *
   * @internal
   */
  currentFrameNumber(): number {
    return (this.resources.get(Time) as Time | undefined)?.frame ?? 0;
  }

  /**
   * Look up a resource by constructor. Returns `undefined` if no resource of
   * that class was inserted. Most code should use the `Res(ctor)` (read) or
   * `ResMut(ctor)` (write) params instead; this is the escape hatch the param
   * resolvers themselves rely on.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getResource<T>(ctor: new (...a: any[]) => T): T | undefined {
    return this.resources.get(ctor) as T | undefined;
  }

  /**
   * Register a frame-buffered message class. Idempotent — re-registering the
   * same constructor is a silent no-op and does not reset the buffer. After
   * registration, systems with `MessageWriter(ctor)` may write payloads;
   * unregistered writes throw at flush time.
   *
   * Readers (`MessageReader(ctor)`) are silent on missing registration —
   * they yield nothing — so a reader can be wired against a future message
   * type before the source plugin registers it.
   *
   * Buffers drain at the end of `advanceFrame` (after all stages and the
   * removed-buffer drain). A `runIf`-gated reader that skips a frame loses
   * that frame's messages; same hazard pattern as `RemovedComponents`.
   *
   * @example
   * ```ts
   * class Death { constructor(public entity: Entity) {} }
   * app.addMessage(Death);
   * ```
   */
  addMessage<T extends object>(ctor: new (...args: never[]) => T): this {
    this.messageRegistry.register(ctor as unknown as new (...args: never[]) => object);
    return this;
  }

  /**
   * Read the message registry. Internal accessor used by `MessageWriter` /
   * `MessageReader` param resolvers; not part of the public API.
   *
   * @internal
   */
  getMessageRegistry(): MessageRegistry {
    return this.messageRegistry;
  }

  /**
   * Register a global observer against event class `eventCtor`. The observer
   * fires synchronously whenever `commands.trigger(event)` posts an event of
   * that class — globally — or whenever an entity-targeted trigger
   * (`commands.entity(e).trigger(event)`) fires (entity-targeted observers
   * fire first, then globals, in registration order).
   *
   * The observer is a system in disguise: its params resolve the same way
   * `addSystem`'s do (against the triggering system's `ResolveCtx`). The
   * conventional first param is `Trigger(eventCtor)` to access the event
   * payload and the optional target entity.
   *
   * @example
   * ```ts
   * class PlayerDied { constructor(public entity: Entity) {} }
   * app.addObserver([Trigger(PlayerDied), Commands], (trig, cmd) => {
   *   cmd.spawn(new Tombstone(trig.event().entity));
   * });
   * ```
   */
  addObserver<E extends object, const Ps extends readonly Param<unknown>[]>(
    eventCtor: new (...args: never[]) => E,
    params: Ps,
    fn: (...args: ParamValues<Ps>) => void,
  ): this {
    this.observerRegistry.registerGlobal(
      eventCtor as unknown as new (...args: never[]) => object,
      params,
      fn as (...args: unknown[]) => void,
    );
    return this;
  }

  /**
   * Register a plugin-side component hook of `kind` for component class
   * `ctor`. Hooks fire during the commands flush when a structural mutation
   * touches the type:
   *
   * - `onAdd` — first time `ctor` appears on an entity (newly attached).
   * - `onInsert` — every insert pass that touches `ctor`, including
   *   replace-in-place. Superset of `onAdd`.
   * - `onReplace` — only when `ctor` was already present and is being
   *   overwritten. Fires pre-mutation with the OLD value.
   * - `onRemove` — once per removal (including the per-component fan-out
   *   at despawn). Fires pre-mutation with the about-to-be-removed value.
   *
   * The component class may also declare static methods of the same names
   * (`class Sprite { static onAdd(ctx) { … } }`) — those fire first, then
   * registry entries in registration order.
   *
   * Direct `world.spawn` / `world.insertBundle` / `world.removeComponent` /
   * `world.despawn` calls (outside a commands flush) do NOT fire hooks in
   * v1; the dispatch lives at the engine/commands layer. Test code that
   * needs hook coverage routes through `Commands`.
   */
  registerComponentHook<T extends object>(
    ctor: new (...args: never[]) => T,
    kind: HookKind,
    fn: (ctx: HookCtx<T>) => void,
  ): this {
    this.componentHookRegistry.register(
      ctor as unknown as new (...args: never[]) => object,
      kind,
      fn as (ctx: HookCtx<unknown>) => void,
    );
    return this;
  }

  /** Start the frame loop. Resolves once startup is complete; the loop runs until {@link App.stop}. */
  async run(): Promise<void> {
    await this.renderer.init();
    if (this.canvas) this.initSurface(this.canvas);
    this.running = true;
    this.advanceFrame(performance.now());
    if (typeof requestAnimationFrame === 'function') {
      const loop = (t: number): void => {
        if (!this.running) return;
        this.advanceFrame(t);
        this.rafHandle = requestAnimationFrame(loop);
      };
      this.rafHandle = requestAnimationFrame(loop);
    }
  }

  /**
   * Drive a single Main-schedule frame:
   * `'first'` → `'startup'` (first frame only) → `'preUpdate'` →
   * *StateTransition* → *RunFixedMainLoop* → `'update'` → `'postUpdate'` →
   * `'last'` → render.
   *
   * The optional `timestampMs` is a `performance.now()`-style
   * `DOMHighResTimeStamp`; the engine's internal time-tick system reads it
   * via the same pathway `requestAnimationFrame` uses in `run`. Omit it to
   * read `performance.now()` at call time.
   *
   * `run` calls this once on startup and again from each `requestAnimationFrame`
   * callback. Tests step the loop synchronously by calling it directly with
   * explicit timestamps, side-stepping `requestAnimationFrame` entirely.
   */
  advanceFrame(timestampMs?: number): void {
    this.currentFrameTimestampMs = timestampMs ?? performance.now();
    this.tickPluginLifecycle();
    runStage(this.stages.first, this, 'first');
    if (!this.hasRunStartup) {
      runStage(this.stages.startup, this, 'startup');
      this.hasRunStartup = true;
    }
    runStage(this.stages.preUpdate, this, 'preUpdate');
    runStateTransition(this, this.stateRegistry);
    runFixedMainLoop(
      this,
      this.stages.fixedFirst,
      this.stages.fixedPreUpdate,
      this.stages.fixedUpdate,
      this.stages.fixedPostUpdate,
      this.stages.fixedLast,
    );
    runStage(this.stages.update, this, 'update');
    runStage(this.stages.postUpdate, this, 'postUpdate');
    runStage(this.stages.last, this, 'last');
    this.renderFrame();
    this.world.drainRemovedBuffer();
    this.renderWorld.drainRemovedBuffer();
    this.messageRegistry.drainAll();
  }

  stop(): void {
    this.running = false;
    if (this.rafHandle !== undefined && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.rafHandle);
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    this.surface?.destroy();
    this.surface = undefined;
    this.renderer.destroy();
  }

  /** Returns the configured surface, if any. Render systems read this during pipeline construction. */
  getSurface(): Surface | undefined {
    return this.surface;
  }

  private initSurface(canvas: HTMLCanvasElement): void {
    syncCanvasBackingSize(canvas);
    const surface = this.renderer.createSurface(canvas);
    surface.configure({ format: this.renderer.getPreferredSurfaceFormat() });
    this.surface = surface;
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        const { width, height } = syncCanvasBackingSize(canvas);
        surface.resize(width, height);
      });
      this.resizeObserver.observe(canvas);
    }
  }

  private renderFrame(): void {
    // ADR-0019: clear render-world entities at the start of every frame so
    // Extract systems repopulate from main-world state without leakage.
    // Render-world resources persist across frames; entities do not.
    this.renderWorld.clearAllEntities();

    const bySet = this.groupRenderSystemsBySet();

    // Pre-pass sets: Extract → Prepare → Queue → PhaseSort. No encoder yet —
    // these systems prepare data only, no command recording.
    this.runRenderSet(bySet.get(RenderSet.Extract), RenderSet.Extract, undefined);
    this.runRenderSet(bySet.get(RenderSet.Prepare), RenderSet.Prepare, undefined);
    this.runRenderSet(bySet.get(RenderSet.Queue), RenderSet.Queue, undefined);
    this.runRenderSet(bySet.get(RenderSet.PhaseSort), RenderSet.PhaseSort, undefined);

    // ADR-0020 + ADR-0023: the per-camera dispatch loop lives inside
    // `CameraDriverNode` on the `RenderGraph`. The graph owns the per-frame
    // encoder, opens one render pass per camera against the camera's
    // sub-graph (`Core2d` / `Core3d` by default), and submits. If no cameras
    // are active and a surface exists, fall back to a clear-only pass so the
    // swapchain doesn't show stale content; headless apps with no cameras
    // skip GPU work entirely.
    //
    // Freeze only after the plugin lifecycle has reached `Cleaned`. Plugins
    // are allowed to extend the graph in `finish()` (see
    // `RenderGraphPlugin`'s docstring), and `tickPluginLifecycle` only
    // calls `finish()` once every plugin's `ready()` reports true — until
    // then, deferring the freeze keeps the graph mutable so a slow-to-ready
    // plugin doesn't lock another plugin's node registrations out.
    const graph = this.getResource(RenderGraph);
    if (this._pluginsState === 'Cleaned') graph?.freeze();
    const sorted = this.getResource(SortedCameras);
    const views = sorted?.views ?? [];
    if (views.length > 0 && this._pluginsState === 'Cleaned') {
      if (graph !== undefined) {
        graph.run({
          app: this,
          graph,
          encoder: undefined,
          pass: undefined,
          view: undefined,
          renderSetSystems: bySet,
          inputs: EMPTY_SLOT_VALUES,
        });
      }
    } else if (this.surface) {
      const surfaceView = this.surface.getCurrentTextureView();
      const encoder = this.renderer.createCommandEncoder('frame');
      const clearColor = this.getResource(ClearColor)?.color ?? this.clearColor;
      const pass = encoder.beginRenderPass({
        label: 'fallback-clear',
        colorAttachments: [
          {
            view: surfaceView,
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: clearColor,
          },
        ],
      });
      pass.end();
      this.renderer.submit([encoder.finish()]);
    }

    // Post-pass set: Cleanup. The encoder is finished; no RenderCtx here.
    this.runRenderSet(bySet.get(RenderSet.Cleanup), RenderSet.Cleanup, undefined);
  }

  /**
   * Bucket the topologically-ordered render-stage systems by their
   * {@link RenderSet}. Systems without an explicit `set` default to
   * {@link RenderSet.Render} — preserves the pre-ADR-0019 behaviour where
   * `addSystem('render', ...)` registered a draw call inside the active
   * pass.
   */
  private groupRenderSystemsBySet(): ReadonlyMap<RenderSetName, RegisteredSystem[]> {
    const bySet = new Map<RenderSetName, RegisteredSystem[]>();
    for (const sys of this.stages.render.ordered()) {
      const set = sys.set ?? RenderSet.Render;
      const arr = bySet.get(set);
      if (arr) arr.push(sys);
      else bySet.set(set, [sys]);
    }
    return bySet;
  }

  /**
   * Dispatch one render sub-set's systems against the supplied
   * {@link RenderContext} (or `undefined` for pre-/post-pass sets). Exposed
   * so render-graph nodes — primarily `MainPassNode` — can run the
   * `RenderSet.Render` systems for the active camera. Not part of the public
   * engine API; downstream code outside the engine package should not call
   * this directly.
   *
   * @internal
   */
  runRenderSet(
    systems: readonly RegisteredSystem[] | undefined,
    setName: RenderSetName,
    render: RenderContext | undefined,
  ): void {
    if (!systems || systems.length === 0) return;
    const profiling = this.systemProfilingEnabled;
    for (const sys of systems) {
      if (this.disabledSystems.has(sys.id)) continue;
      if (sys.runIf && !sys.runIf.test(this)) continue;
      const lastSeenTick = this.lastSeenTickOf(sys.id);
      const lastSeenFrame = this.lastSeenFrameOf(sys.id);
      const tickAtRunStart = this.renderWorld.changeTick;
      const frameAtRunStart = this.currentFrameNumber();
      const ctx: ResolveCtx = {
        app: this,
        world: this.renderWorld,
        stage: 'render',
        systemId: sys.id,
        lastSeenTick,
        lastSeenFrame,
        renderSet: setName,
        ...(render !== undefined ? { render } : {}),
      };
      const values = sys.params.map((p) => p.resolve(ctx));
      const t0 = profiling ? performance.now() : 0;
      try {
        sys.fn(...values);
      } catch (err) {
        this.discardSystemCommands(sys.id);
        throw err;
      }
      if (profiling) this.recordSystemTime(sys.id, performance.now() - t0);
      // Commands enqueued by render-stage systems flush against the render
      // world via the standard per-system flush path. Cross-world commands
      // are not supported in Phase 1.
      this.flushSystemCommands(sys.id, 'render');
      this.recordSystemLastSeenTick(sys.id, tickAtRunStart);
      this.recordSystemLastSeenFrame(sys.id, frameAtRunStart);
    }
  }
}


const syncCanvasBackingSize = (canvas: HTMLCanvasElement): { width: number; height: number } => {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
  const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  return { width, height };
};
