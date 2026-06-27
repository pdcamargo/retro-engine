export { AnimationClip, clipDuration } from './animation-clip';
export type {
  AnimationTrack,
  Interpolation,
  KeyframeSampler,
  TrackTarget,
} from './animation-clip';

export {
  ANIMATION_CLIP_ASSET_KIND,
  ANIMATION_CLIP_FORMAT_VERSION,
  AnimationClips,
  createAnimationClipImporter,
  createAnimationClipSerializer,
} from './animation-clip-asset';

export { AnimationPlayer, AnimationTarget } from './animation-player';
export type { RepeatMode } from './animation-player';

export { EffectiveClips, effectiveClip } from './effective-clips';
export type { EffectiveClipsView } from './effective-clips';

export { sampleInto } from './sampler';

export { addAnimationSampling, advancePlayerTime } from './animation-system';

export { AnimationPlugin } from './animation-plugin';

export { Pose, AnimationPoses } from './pose';
export {
  accumulateRotation,
  accumulateScale,
  accumulateTranslation,
  boneTrackField,
  commitPoseToTransforms,
  finalizePose,
  samplePoseFromClip,
} from './pose-blend';

export { weights1d, weights2d } from './blend-tree';
export type { Blend2dMode } from './blend-tree';

export {
  AnimationController,
  evaluateMotion,
  motionDuration,
} from './animation-controller';
export type {
  ConditionOp,
  ControllerParameter,
  ControllerState,
  Motion,
  MotionInput,
  ParameterType,
  Transition,
  TransitionCondition,
} from './animation-controller';

export {
  ANIMATION_CONTROLLER_ASSET_KIND,
  ANIMATION_CONTROLLER_FORMAT_VERSION,
  AnimationControllers,
  createAnimationControllerImporter,
  createAnimationControllerSerializer,
} from './animation-controller-asset';

export { AnimationControllerPlayer } from './animation-controller-player';
export type { PlayerParameter } from './animation-controller-player';

export { AvatarMask } from './avatar-mask';
export {
  AVATAR_MASK_ASSET_KIND,
  AVATAR_MASK_FORMAT_VERSION,
  AvatarMasks,
  createAvatarMaskImporter,
  createAvatarMaskSerializer,
} from './avatar-mask-asset';

export {
  AnimationLayers,
  AnimationLayerRuntimes,
  ReferencePoses,
} from './animation-layers';
export type { AnimationLayer, LayerBlendMode, LayerRuntime, LayerSource } from './animation-layers';

export { composeLayerAdditive, composeLayerOverride } from './layer-blend';
export type { LayerMask } from './layer-blend';

export {
  AnimationControllerRuntimes,
  createControllerRuntime,
  stateWeights,
  stepController,
} from './state-machine';
export type { ControllerRuntime, ParameterAccess } from './state-machine';

export {
  TwoBoneIK,
  IkChain,
  LookAtConstraint,
  IkPlugin,
  addIkSolve,
  solveTwoBone,
  solveCcd,
  solveAim,
} from './ik';
export type {
  TwoBoneSolveInput,
  TwoBoneSolveOutput,
  CcdSolveInput,
  AimSolveInput,
} from './ik';

export {
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
} from './retarget';
export type {
  HumanoidBodyPart,
  HumanoidSlot,
  RetargetSlot,
  BuildRetargetRigOptions,
  AuthoredReferencePose,
  ReferencePoseBone,
  ReferencePoseEntry,
  RootTranslationMode,
  RetargetClipOptions,
} from './retarget';
