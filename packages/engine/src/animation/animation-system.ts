import type { ComponentType, Entity } from '@retro-engine/ecs';
import { type FieldPath, readPath, resolveFieldType, writePathLeaf } from '@retro-engine/reflect';
import type { TypeRegistry } from '@retro-engine/reflect';

import type { App } from '../index';
import { AppTypeRegistry } from '../scene/app-type-registry';
import { Query, Res } from '../system-param';
import { Time } from '../time';
import type { AnimationTrack } from './animation-clip';
import { AnimationClips } from './animation-clip-asset';
import { AnimationPlayer, AnimationTarget } from './animation-player';
import { sampleInto } from './sampler';

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
 * Write one track's sampled value at `time` into its bound entity's component.
 * Resolves the leaf's reflected {@link import('@retro-engine/reflect').FieldType}
 * to choose interpolation (quaternion → shortest-path slerp; vectors and scalars
 * → linear) and the destination shape (mutate a `Float32Array` vector in place,
 * assign a scalar/color leaf). Marks the component changed so transform
 * propagation and change-gated systems observe the write. `scratch` is reused
 * across calls for scalar/color destinations.
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
 * Register the clip-sampling system. Each frame it advances every
 * {@link AnimationPlayer}'s cursor by the virtual delta, then samples every
 * track of its clip into the bound {@link AnimationTarget} entities — writing
 * the targeted reflected properties.
 *
 * Runs in `update`, which the fixed stage order places before `postUpdate`
 * transform propagation — a stronger guarantee than a label constraint and one
 * that leaves the propagation/visibility/skinning order in `postUpdate`
 * untouched. So when tracks drive bone `Transform`s, the propagated
 * `GlobalTransform`s (and the downstream skinning palette) reflect the new pose
 * the same frame.
 */
export const addAnimationSampling = (app: App): void => {
  const scratch = new Float32Array(16);
  // (player entity, targetId) → bound entity, rebuilt each frame from the
  // AnimationTarget query so a freshly instantiated rig binds without a cache flush.
  const byPlayer = new Map<Entity, Map<string, Entity>>();

  app.addSystem(
    'update',
    [Res(Time), Res(AnimationClips), Query([AnimationPlayer]), Query([AnimationTarget])],
    (time, clips, players, targets) => {
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
        for (const track of clip.tracks) {
          const targetEntity = ids.get(track.target.targetId);
          if (targetEntity === undefined) continue;
          applyTrack(app, registry, targetEntity, track, player.time, scratch);
        }
      }
    },
    { name: 'animation-sample' },
  );
};
