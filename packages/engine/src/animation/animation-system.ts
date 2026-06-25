import type { Handle } from '@retro-engine/assets';
import type { ComponentType, Entity } from '@retro-engine/ecs';
import { type FieldPath, readPath, resolveFieldType, writePathLeaf } from '@retro-engine/reflect';
import type { TypeRegistry } from '@retro-engine/reflect';

import type { App } from '../index';
import { AppTypeRegistry } from '../scene/app-type-registry';
import { Query, Res } from '../system-param';
import { Time } from '../time';
import type { AnimationClip, AnimationTrack } from './animation-clip';
import { AnimationClips } from './animation-clip-asset';
import {
  type AnimationController,
  type MotionInput,
  evaluateMotion,
  motionDuration,
} from './animation-controller';
import { AnimationControllerPlayer } from './animation-controller-player';
import { AnimationControllers } from './animation-controller-asset';
import { AnimationPlayer, AnimationTarget } from './animation-player';
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
  } else {
    return; // Unsupported leaf kind for v1; the track is inert.
  }

  app.world.markChanged(entity, registered.ctor as ComponentType);
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

  const jointCount = slotEntities.length;
  if (jointCount > 0) {
    pose.beginAccumulate(jointCount);
    for (let s = 0; s < jointCount; s++) pose.targets[s] = slotEntities[s]!;
    for (const input of inputs) {
      samplePoseFromClip(input.clip, input.time, input.weight, slotByTargetId, pose, scratch);
    }
    finalizePose(pose);
    commitPoseToTransforms(pose, app.world);
  }

  // Non-bone tracks (light intensity, material color, …) write directly.
  for (const input of inputs) {
    for (const track of input.clip.tracks) {
      if (boneTrackField(track) !== undefined) continue;
      const entity = ids.get(track.target.targetId);
      if (entity === undefined) continue;
      applyTrack(app, registry, entity, track, input.time, scratch);
    }
  }
};

/** Resolve a player's parameter values against a controller's declared defaults, with trigger consumption. */
const makeParameterAccess = (player: AnimationControllerPlayer): ParameterAccess => {
  const get = (name: string): number => {
    for (const p of player.parameters) if (p.name === name) return p.value;
    return 0;
  };
  const reset = (name: string): void => {
    for (const p of player.parameters) {
      if (p.name === name) {
        p.value = 0;
        return;
      }
    }
    player.parameters.push({ name, value: 0 });
  };
  return { get, reset };
};

const ensureParameterDefaults = (
  player: AnimationControllerPlayer,
  controller: { parameters: readonly { name: string; default: number }[] },
): void => {
  for (const param of controller.parameters) {
    let present = false;
    for (const p of player.parameters) {
      if (p.name === param.name) {
        present = true;
        break;
      }
    }
    if (!present) player.parameters.push({ name: param.name, value: param.default });
  }
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
  let weightScratch = new Float32Array(64);

  app.addSystem(
    'update',
    [
      Res(Time),
      Res(AnimationClips),
      Res(AnimationControllers),
      Query([AnimationPlayer]),
      Query([AnimationControllerPlayer]),
      Query([AnimationTarget]),
    ],
    (time, clips, controllers, players, controllerPlayers, targets) => {
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

      const poseFor = (playerEntity: Entity): Pose => {
        let pose = poses.byPlayer.get(playerEntity);
        if (pose === undefined) {
          pose = new Pose();
          poses.byPlayer.set(playerEntity, pose);
        }
        return pose;
      };

      // Single-clip players: one weighted source through the pose pipeline.
      for (const [playerEntity, player] of players.entries()) {
        const clip = clips.get(player.clip);
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

        let runtime = runtimes.byPlayer.get(playerEntity) as ControllerRuntime | undefined;
        if (runtime === undefined || runtime.phase.length !== controller.states.length) {
          runtime = createControllerRuntime(controller.states.length);
          runtimes.byPlayer.set(playerEntity, runtime);
        }

        ensureParameterDefaults(player, controller);
        const params = makeParameterAccess(player);
        const resolveClip = (h: Handle<AnimationClip>): AnimationClip | undefined => clips.get(h);
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
        const maxChildren = controllerMaxChildren(controller);
        if (maxChildren > weightScratch.length) weightScratch = new Float32Array(maxChildren);

        inputs.length = 0;
        if (runtime.fromState >= 0) {
          evaluateMotion(
            controller.states[runtime.fromState]!.motion,
            runtime.phase[runtime.fromState]!,
            weights.from,
            params.get,
            resolveClip,
            weightScratch,
            inputs,
          );
        }
        evaluateMotion(
          controller.states[runtime.currentState]!.motion,
          runtime.phase[runtime.currentState]!,
          weights.current,
          params.get,
          resolveClip,
          weightScratch,
          inputs,
        );
        applyBlendInputs(app, registry, inputs, ids, poseFor(playerEntity), slotByTargetId, slotEntities, scratch);
      }
    },
    { name: 'animation-sample' },
  );
};

/** Largest blend-tree child count across a controller's states (sizes the weight scratch). */
const controllerMaxChildren = (controller: AnimationController): number => {
  let max = 1;
  for (const state of controller.states) {
    if (state.motion.kind !== 'clip' && state.motion.children.length > max) {
      max = state.motion.children.length;
    }
  }
  return max;
};
