import type { Handle } from '@retro-engine/assets';
import type { ComponentType, Entity } from '@retro-engine/ecs';
import { type FieldPath, readPath, resolveFieldType, writePathLeaf } from '@retro-engine/reflect';
import type { TypeRegistry } from '@retro-engine/reflect';

import type { App } from '../index';
import { AppTypeRegistry } from '../scene/app-type-registry';
import { Query, Res } from '../system-param';
import { Time } from '../time';
import { Transform } from '../transform';
import type { AnimationClip, AnimationTrack } from './animation-clip';
import { AnimationClips } from './animation-clip-asset';
import {
  type Motion,
  type MotionInput,
  MotionScratch,
  evaluateMotion,
  motionDuration,
} from './animation-controller';
import {
  AnimationLayerRuntimes,
  AnimationLayers,
  type AnimationLayer,
  type LayerRuntime,
  ReferencePoses,
} from './animation-layers';
import type { PlayerParameter } from './animation-controller-player';
import { AnimationControllerPlayer } from './animation-controller-player';
import { AnimationControllers } from './animation-controller-asset';
import { AnimationPlayer, AnimationTarget } from './animation-player';
import { EffectiveClips, effectiveClip, type EffectiveClipsView } from './effective-clips';
import { AvatarMasks } from './avatar-mask-asset';
import { composeLayerAdditive, composeLayerOverride } from './layer-blend';
import { Pose, AnimationPoses } from './pose';
import {
  boneTrackField,
  commitPoseToTransforms,
  finalizePose,
  samplePoseFromClip,
} from './pose-blend';
import { sampleInto } from './sampler';
import {
  AnimationControllerRuntimes,
  type ControllerRuntime,
  type ParameterAccess,
  createControllerRuntime,
  stateWeights,
  stepController,
} from './state-machine';

/**
 * Advance a playback cursor by `deltaSeconds`, wrapping or clamping per `repeat`.
 * Returns the position to sample at and whether the player is still playing —
 * a `once` player stops (and pins to the end) when it reaches `duration`.
 */
export const advancePlayerTime = (
  time: number,
  deltaSeconds: number,
  duration: number,
  repeat: 'loop' | 'once',
): { time: number; playing: boolean } => {
  let next = time + deltaSeconds;
  if (duration <= 0) return { time: 0, playing: repeat === 'loop' };
  if (repeat === 'loop') {
    next %= duration;
    if (next < 0) next += duration;
    return { time: next, playing: true };
  }
  if (next >= duration) return { time: duration, playing: false };
  if (next < 0) return { time: 0, playing: true };
  return { time: next, playing: true };
};

const KINDS_SLERP = 'quat';
const KINDS_VECTOR = new Set(['vec2', 'vec3', 'vec4']);

/**
 * Reused destination for number-array leaves (morph-target weights), grown to
 * the largest target count seen. Kept module-level so the per-frame sample is
 * allocation-free once warm.
 */
let numberArrayScratch = new Float32Array(0);

/**
 * Write one non-bone track's sampled value at `time` into its bound entity's
 * component. Resolves the leaf's reflected `FieldType` to choose interpolation
 * (quaternion → shortest-path slerp; vectors and scalars → linear) and the
 * destination shape, then marks the component changed. Bone `Transform` tracks
 * do not go through here — they are blended into a pose and committed once.
 * `scratch` is reused across calls for scalar/color destinations.
 */
const applyTrack = (
  app: App,
  registry: TypeRegistry,
  entity: Entity,
  track: AnimationTrack,
  time: number,
  scratch: Float32Array,
): void => {
  const registered = registry.get(track.target.component);
  if (registered === undefined) return;
  const instance = app.world.getComponent(entity, registered.ctor as ComponentType<object>);
  if (instance === undefined) return;
  const fieldType = resolveFieldType(registered.schema, track.target.path as FieldPath);
  if (fieldType === undefined) return;
  const kind = fieldType.kind;

  const leaf = readPath(instance, track.target.path as FieldPath);

  if (kind === KINDS_SLERP || KINDS_VECTOR.has(kind)) {
    if (!(leaf instanceof Float32Array)) return;
    sampleInto(track.sampler, time, kind === KINDS_SLERP, leaf);
  } else if (kind === 'number') {
    sampleInto(track.sampler, time, false, scratch);
    writePathLeaf(instance, track.target.path as FieldPath, scratch[0]);
  } else if (kind === 'color') {
    sampleInto(track.sampler, time, false, scratch);
    const color = leaf as { r: number; g: number; b: number; a: number } | undefined;
    if (color === undefined) return;
    color.r = scratch[0]!;
    color.g = scratch[1]!;
    color.b = scratch[2]!;
    color.a = scratch[3]!;
  } else if (kind === 'array') {
    // A number array driven element-wise (morph-target weights): the sampler's
    // componentCount is the array length, one keyframe value per element.
    if (!Array.isArray(leaf)) return;
    const dst = leaf as number[];
    const n = track.sampler.componentCount;
    if (numberArrayScratch.length < n) numberArrayScratch = new Float32Array(n);
    sampleInto(track.sampler, time, false, numberArrayScratch);
    const count = Math.min(n, dst.length);
    for (let i = 0; i < count; i++) dst[i] = numberArrayScratch[i]!;
  } else {
    return; // Unsupported leaf kind for v1; the track is inert.
  }

  app.world.markChanged(entity, registered.ctor as ComponentType);
};

/**
 * Blend a set of weighted clip contributions' whole-field bone `Transform`
 * tracks into `pose` (clearing it first) against an existing slot layout, then
 * finalize it. `slotByTargetId`/`slotEntities` map each bound bone to a slot;
 * the caller owns the layout so it can be shared across passes (e.g. a layer
 * stack evaluating several poses over one layout). Does not commit.
 */
const accumulateInputsIntoPose = (
  inputs: readonly MotionInput[],
  slotByTargetId: ReadonlyMap<string, number>,
  slotEntities: readonly Entity[],
  pose: Pose,
  scratch: Float32Array,
): void => {
  const jointCount = slotEntities.length;
  pose.beginAccumulate(jointCount);
  for (let s = 0; s < jointCount; s++) pose.targets[s] = slotEntities[s]!;
  for (const input of inputs) {
    samplePoseFromClip(input.clip, input.time, input.weight, slotByTargetId, pose, scratch);
  }
  finalizePose(pose);
};

/** Write a set of contributions' non-bone tracks directly (last-writer-wins; bone tracks go through the pose). */
const applyNonBoneTracks = (
  app: App,
  registry: TypeRegistry,
  inputs: readonly MotionInput[],
  ids: ReadonlyMap<string, Entity>,
  scratch: Float32Array,
): void => {
  for (const input of inputs) {
    for (const track of input.clip.tracks) {
      if (boneTrackField(track) !== undefined) continue;
      const entity = ids.get(track.target.targetId);
      if (entity === undefined) continue;
      applyTrack(app, registry, entity, track, input.time, scratch);
    }
  }
};

/**
 * Drive one player's bound entities from a set of weighted clip contributions:
 * blend the whole-field bone `Transform` tracks into `pose` and commit them
 * once, then write the non-bone tracks directly (lowest weight first, so the
 * dominant contribution wins last-writer-wins). `inputs` should list the
 * lower-weight (transitioning-out) contributions before the dominant ones.
 */
const applyBlendInputs = (
  app: App,
  registry: TypeRegistry,
  inputs: readonly MotionInput[],
  ids: ReadonlyMap<string, Entity>,
  pose: Pose,
  slotByTargetId: Map<string, number>,
  slotEntities: Entity[],
  scratch: Float32Array,
): void => {
  // Lay out a pose slot per distinct bound bone the inputs animate.
  slotByTargetId.clear();
  slotEntities.length = 0;
  for (const input of inputs) {
    for (const track of input.clip.tracks) {
      if (boneTrackField(track) === undefined) continue;
      const tid = track.target.targetId;
      if (slotByTargetId.has(tid)) continue;
      const entity = ids.get(tid);
      if (entity === undefined) continue;
      slotByTargetId.set(tid, slotEntities.length);
      slotEntities.push(entity);
    }
  }

  if (slotEntities.length > 0) {
    accumulateInputsIntoPose(inputs, slotByTargetId, slotEntities, pose, scratch);
    commitPoseToTransforms(pose, app.world);
  }

  // Non-bone tracks (light intensity, material color, …) write directly.
  applyNonBoneTracks(app, registry, inputs, ids, scratch);
};

/** Resolve a parameter list against a controller's declared defaults, with trigger consumption. */
const makeParameterAccess = (params: PlayerParameter[]): ParameterAccess => {
  const get = (name: string): number => {
    for (const p of params) if (p.name === name) return p.value;
    return 0;
  };
  const reset = (name: string): void => {
    for (const p of params) {
      if (p.name === name) {
        p.value = 0;
        return;
      }
    }
    params.push({ name, value: 0 });
  };
  return { get, reset };
};

const ensureParameterDefaults = (
  params: PlayerParameter[],
  controller: { parameters: readonly { name: string; default: number }[] },
): void => {
  for (const param of controller.parameters) {
    let present = false;
    for (const p of params) {
      if (p.name === param.name) {
        present = true;
        break;
      }
    }
    if (!present) params.push({ name: param.name, value: param.default });
  }
};

/** Read-only views of the clip / controller stores as the sampling system sees them. */
type ClipStore = Pick<AnimationClips, 'get'>;
type ControllerStore = Pick<AnimationControllers, 'get'>;

/** Append every leaf clip a motion could sample to `out`, recursing through nested blend trees. */
const collectMotionClips = (motion: Motion, clips: ClipStore, out: AnimationClip[]): void => {
  if (motion.kind === 'clip') {
    const clip = clips.get(motion.clip);
    if (clip !== undefined) out.push(clip);
    return;
  }
  for (const child of motion.children) collectMotionClips(child.motion, clips, out);
};

/** Append every clip a layer's source could sample to `out`, for building the shared slot layout. */
const collectLayerClips = (
  layer: AnimationLayer,
  clips: ClipStore,
  controllers: ControllerStore,
  out: AnimationClip[],
): void => {
  const source = layer.source;
  if (source.kind === 'clip') {
    const clip = clips.get(source.clip);
    if (clip !== undefined) out.push(clip);
    return;
  }
  const controller = controllers.get(source.controller);
  if (controller === undefined) return;
  for (const state of controller.states) collectMotionClips(state.motion, clips, out);
};

/**
 * Fill `inputs` with one layer's weighted clip contributions for this frame,
 * advancing its transient {@link LayerRuntime} (clip cursor, or controller state
 * machine). A clip layer yields a single weight-1 input; a controller layer steps
 * its state machine and emits the active (and transitioning-out) states' blended
 * motions, exactly as the standalone controller path does. `scratch` supplies the
 * per-depth blend-weight buffers, reused across layers.
 */
const evaluateLayerInputs = (
  layer: AnimationLayer,
  runtime: LayerRuntime,
  deltaSeconds: number,
  clips: ClipStore,
  controllers: ControllerStore,
  inputs: MotionInput[],
  scratch: MotionScratch,
): void => {
  inputs.length = 0;
  const source = layer.source;

  if (source.kind === 'clip') {
    const clip = clips.get(source.clip);
    if (clip === undefined) return;
    if (source.playing) {
      const advanced = advancePlayerTime(
        runtime.time,
        deltaSeconds * source.speed,
        clip.duration,
        source.repeat,
      );
      runtime.time = advanced.time;
      source.playing = advanced.playing;
    }
    inputs.push({ clip, time: runtime.time, weight: 1 });
    return;
  }

  const controller = controllers.get(source.controller);
  if (controller === undefined || controller.states.length === 0) return;
  if (runtime.controller === undefined || runtime.controller.phase.length !== controller.states.length) {
    runtime.controller = createControllerRuntime(controller.states.length);
  }
  const rt = runtime.controller;
  ensureParameterDefaults(source.parameters, controller);
  const params = makeParameterAccess(source.parameters);
  const resolveClip = (h: Handle<AnimationClip>): AnimationClip | undefined => clips.get(h);
  const durationOf = (stateIndex: number): number =>
    motionDuration(controller.states[stateIndex]!.motion, resolveClip);

  if (source.playing) {
    stepController(controller, rt, params, deltaSeconds * source.speed, durationOf);
  } else if (rt.currentState < 0) {
    stepController(controller, rt, params, 0, durationOf);
  }

  const weights = stateWeights(rt);
  if (rt.fromState >= 0) {
    evaluateMotion(
      controller.states[rt.fromState]!.motion,
      rt.phase[rt.fromState]!,
      weights.from,
      params.get,
      resolveClip,
      scratch,
      inputs,
    );
  }
  evaluateMotion(
    controller.states[rt.currentState]!.motion,
    rt.phase[rt.currentState]!,
    weights.current,
    params.get,
    resolveClip,
    scratch,
    inputs,
  );
};

/**
 * Register the animation evaluation system. Each frame it advances every
 * {@link AnimationPlayer} and {@link AnimationControllerPlayer}, samples their
 * active clips, blends the bone `Transform` tracks into a per-player {@link Pose}
 * (sign-aligned nlerp for rotations, weighted average for translation/scale),
 * and commits each pose to its bound bones' `Transform`s exactly once; non-bone
 * tracks are written directly, preserving the general property-animation path.
 *
 * Runs in `update`, which the fixed stage order places before `postUpdate`
 * transform propagation — a stronger guarantee than a label constraint and one
 * that leaves the propagation/visibility/skinning order in `postUpdate`
 * untouched. So a clip (or blended controller pose) driving bone `Transform`s
 * deforms the skinned mesh the same frame: sample → blend → commit (update) →
 * propagate `GlobalTransform` (postUpdate) → skinning palette (postUpdate).
 */
export const addAnimationSampling = (app: App): void => {
  const scratch = new Float32Array(16);
  // Reused per frame: (player entity, targetId) → bound entity, rebuilt from the
  // AnimationTarget query so a freshly instantiated rig binds without a cache flush.
  const byPlayer = new Map<Entity, Map<string, Entity>>();
  // Reused per player: pose-slot layout and the flat blend-input list.
  const slotByTargetId = new Map<string, number>();
  const slotEntities: Entity[] = [];
  const inputs: MotionInput[] = [];
  const motionScratch = new MotionScratch();
  // Reused by the layered driver: shared slot layout, scratch poses, mask bits.
  const slotTargetIds: string[] = [];
  const layoutClips: AnimationClip[] = [];
  const layerPose = new Pose();
  const refPose = new Pose();
  let maskScratch = new Uint8Array(64);

  // Player-scoped clip resolver: maps an authored handle through EffectiveClips
  // (so a foreign clip samples its retargeted form), reused across players to
  // avoid a per-frame allocation. `null` from the indirection means "foreign,
  // not ready" — surfaced as `undefined` so the existing skip paths drop it.
  let resolverPlayer: Entity = 0 as Entity;
  let effectiveClips: EffectiveClipsView | undefined;
  let rawClips: ClipStore = new AnimationClips();
  const playerClips: ClipStore = {
    get: (handle) => {
      const eff = effectiveClip(effectiveClips, resolverPlayer, handle);
      return eff === null ? undefined : rawClips.get(eff);
    },
  };

  app.addSystem(
    'update',
    [
      Res(Time),
      Res(AnimationClips),
      Res(AnimationControllers),
      Res(AvatarMasks),
      Query([AnimationPlayer]),
      Query([AnimationControllerPlayer]),
      Query([AnimationLayers]),
      Query([AnimationTarget]),
    ],
    (time, clips, controllers, masks, players, controllerPlayers, layered, targets) => {
      effectiveClips = app.getResource(EffectiveClips);
      rawClips = clips;
      byPlayer.clear();
      for (const [entity, target] of targets.entries()) {
        let ids = byPlayer.get(target.player);
        if (ids === undefined) {
          ids = new Map<string, Entity>();
          byPlayer.set(target.player, ids);
        }
        ids.set(target.id, entity);
      }

      const registry = app.getResource(AppTypeRegistry)!.registry;
      const poses = app.getResource(AnimationPoses)!;
      const runtimes = app.getResource(AnimationControllerRuntimes)!;
      const layerRuntimes = app.getResource(AnimationLayerRuntimes)!;
      const references = app.getResource(ReferencePoses)!;

      const poseFor = (playerEntity: Entity): Pose => {
        let pose = poses.byPlayer.get(playerEntity);
        if (pose === undefined) {
          pose = new Pose();
          poses.byPlayer.set(playerEntity, pose);
        }
        return pose;
      };

      // Drive one layer stack bottom-up (override/additive, masked per layer) into
      // a single accumulated pose and commit it once. Shared by standalone
      // `AnimationLayers` and by a controller player whose controller declares
      // `layers` (its base machine is prepended as layer 0).
      const driveStack = (playerEntity: Entity, layers: AnimationLayer[]): void => {
        if (layers.length === 0) return;
        resolverPlayer = playerEntity;
        const ids = byPlayer.get(playerEntity);
        if (ids === undefined) return;

        let layerRts = layerRuntimes.byPlayer.get(playerEntity);
        if (layerRts === undefined || layerRts.length !== layers.length) {
          layerRts = layers.map((): LayerRuntime => ({ time: 0 }));
          layerRuntimes.byPlayer.set(playerEntity, layerRts);
        }

        // Shared slot layout across every bone any layer could animate, so the
        // accumulator, each layer pose, and the reference pose share slot indices.
        slotByTargetId.clear();
        slotEntities.length = 0;
        slotTargetIds.length = 0;
        layoutClips.length = 0;
        for (const layer of layers) collectLayerClips(layer, playerClips, controllers, layoutClips);
        for (const clip of layoutClips) {
          for (const track of clip.tracks) {
            if (boneTrackField(track) === undefined) continue;
            const tid = track.target.targetId;
            if (slotByTargetId.has(tid)) continue;
            const entity = ids.get(tid);
            if (entity === undefined) continue;
            slotByTargetId.set(tid, slotEntities.length);
            slotEntities.push(entity);
            slotTargetIds.push(tid);
          }
        }
        const jointCount = slotEntities.length;

        let hasAdditive = false;
        for (const layer of layers) {
          if (layer.blend === 'additive') {
            hasAdditive = true;
            break;
          }
        }

        // Capture the bind/rest pose once per bone (the first frame it appears,
        // before any layer writes it) and materialize it over the slot layout.
        if (hasAdditive && jointCount > 0) {
          let refMap = references.byPlayer.get(playerEntity);
          if (refMap === undefined) {
            refMap = new Map<string, Float32Array>();
            references.byPlayer.set(playerEntity, refMap);
          }
          refPose.beginAccumulate(jointCount);
          for (let s = 0; s < jointCount; s++) {
            const entity = slotEntities[s]!;
            const tid = slotTargetIds[s]!;
            refPose.targets[s] = entity;
            let ref = refMap.get(tid);
            if (ref === undefined) {
              const tr = app.world.getComponent(entity, Transform);
              if (tr === undefined) continue;
              ref = new Float32Array(10);
              ref[0] = tr.translation[0]!;
              ref[1] = tr.translation[1]!;
              ref[2] = tr.translation[2]!;
              ref[3] = tr.rotation[0]!;
              ref[4] = tr.rotation[1]!;
              ref[5] = tr.rotation[2]!;
              ref[6] = tr.rotation[3]!;
              ref[7] = tr.scale[0]!;
              ref[8] = tr.scale[1]!;
              ref[9] = tr.scale[2]!;
              refMap.set(tid, ref);
            }
            refPose.t[s * 3] = ref[0]!;
            refPose.t[s * 3 + 1] = ref[1]!;
            refPose.t[s * 3 + 2] = ref[2]!;
            refPose.r[s * 4] = ref[3]!;
            refPose.r[s * 4 + 1] = ref[4]!;
            refPose.r[s * 4 + 2] = ref[5]!;
            refPose.r[s * 4 + 3] = ref[6]!;
            refPose.s[s * 3] = ref[7]!;
            refPose.s[s * 3 + 1] = ref[8]!;
            refPose.s[s * 3 + 2] = ref[9]!;
            refPose.wt[s] = 1;
            refPose.wr[s] = 1;
            refPose.ws[s] = 1;
          }
        }

        const acc = poseFor(playerEntity);
        acc.beginAccumulate(jointCount);
        for (let s = 0; s < jointCount; s++) acc.targets[s] = slotEntities[s]!;

        const dt = time.virtual.delta;
        for (let li = 0; li < layers.length; li++) {
          const layer = layers[li]!;
          const rt = layerRts[li]!;
          evaluateLayerInputs(layer, rt, dt, playerClips, controllers, inputs, motionScratch);
          if (inputs.length === 0) continue;

          if (jointCount > 0) {
            accumulateInputsIntoPose(inputs, slotByTargetId, slotEntities, layerPose, scratch);
            let maskBits: Uint8Array | undefined;
            const maskAsset = layer.mask !== undefined ? masks.get(layer.mask) : undefined;
            if (maskAsset !== undefined) {
              if (jointCount > maskScratch.length) maskScratch = new Uint8Array(jointCount);
              for (let s = 0; s < jointCount; s++) {
                maskScratch[s] = maskAsset.has(slotTargetIds[s]!) ? 1 : 0;
              }
              maskBits = maskScratch.subarray(0, jointCount);
            }
            if (layer.blend === 'additive') {
              composeLayerAdditive(acc, layerPose, refPose, layer.weight, maskBits);
            } else {
              composeLayerOverride(acc, layerPose, layer.weight, maskBits);
            }
          }

          // Non-bone tracks (lights, materials, …) write directly; later layers win.
          applyNonBoneTracks(app, registry, inputs, ids, scratch);
        }

        if (jointCount > 0) commitPoseToTransforms(acc, app.world);
      };

      // Single-clip players: one weighted source through the pose pipeline.
      for (const [playerEntity, player] of players.entries()) {
        resolverPlayer = playerEntity;
        const clip = playerClips.get(player.clip);
        if (clip === undefined) continue;

        if (player.playing) {
          const advanced = advancePlayerTime(
            player.time,
            time.virtual.delta * player.speed,
            clip.duration,
            player.repeat,
          );
          player.time = advanced.time;
          player.playing = advanced.playing;
        }

        const ids = byPlayer.get(playerEntity);
        if (ids === undefined) continue;
        inputs.length = 0;
        inputs.push({ clip, time: player.time, weight: 1 });
        applyBlendInputs(app, registry, inputs, ids, poseFor(playerEntity), slotByTargetId, slotEntities, scratch);
      }

      // Controller players: state machine → blended motions through the pose pipeline.
      for (const [playerEntity, player] of controllerPlayers.entries()) {
        const controller = controllers.get(player.controller);
        if (controller === undefined || controller.states.length === 0) continue;

        // A controller that declares layers composes as a stack: its base machine
        // is layer 0 (a controller-source layer over this same controller), with the
        // authored layers above it, driven through the shared layered path.
        if (controller.layers.length > 0) {
          driveStack(playerEntity, [
            {
              weight: 1,
              blend: 'override',
              source: {
                kind: 'controller',
                controller: player.controller,
                speed: player.speed,
                playing: player.playing,
                parameters: player.parameters,
              },
            },
            ...controller.layers,
          ]);
          continue;
        }

        let runtime = runtimes.byPlayer.get(playerEntity) as ControllerRuntime | undefined;
        if (runtime === undefined || runtime.phase.length !== controller.states.length) {
          runtime = createControllerRuntime(controller.states.length);
          runtimes.byPlayer.set(playerEntity, runtime);
        }

        resolverPlayer = playerEntity;
        ensureParameterDefaults(player.parameters, controller);
        const params = makeParameterAccess(player.parameters);
        const resolveClip = (h: Handle<AnimationClip>): AnimationClip | undefined => playerClips.get(h);
        const durationOf = (stateIndex: number): number =>
          motionDuration(controller.states[stateIndex]!.motion, resolveClip);

        if (player.playing) {
          stepController(controller, runtime, params, time.virtual.delta * player.speed, durationOf);
        } else if (runtime.currentState < 0) {
          stepController(controller, runtime, params, 0, durationOf);
        }

        const ids = byPlayer.get(playerEntity);
        if (ids === undefined) continue;

        const weights = stateWeights(runtime);

        inputs.length = 0;
        if (runtime.fromState >= 0) {
          evaluateMotion(
            controller.states[runtime.fromState]!.motion,
            runtime.phase[runtime.fromState]!,
            weights.from,
            params.get,
            resolveClip,
            motionScratch,
            inputs,
          );
        }
        evaluateMotion(
          controller.states[runtime.currentState]!.motion,
          runtime.phase[runtime.currentState]!,
          weights.current,
          params.get,
          resolveClip,
          motionScratch,
          inputs,
        );
        applyBlendInputs(app, registry, inputs, ids, poseFor(playerEntity), slotByTargetId, slotEntities, scratch);
      }

      // Layered players: a stack of clip/controller layers blended bottom-up
      // (override or additive, masked per layer) into one pose, committed once.
      for (const [playerEntity, stack] of layered.entries()) {
        driveStack(playerEntity, stack.layers);
      }
    },
    { name: 'animation-sample', label: 'animation-sample' },
  );
};
