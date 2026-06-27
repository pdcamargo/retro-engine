import type { AssetIndex, Handle } from '@retro-engine/assets';
import type { Entity } from '@retro-engine/ecs';

import type { AnimationClip } from './animation-clip';

/**
 * Read-only view of {@link EffectiveClips} as the sampler consumes it — the
 * shape `Res(...)` exposes, where the backing maps are read-only.
 */
export interface EffectiveClipsView {
  readonly byPlayer: ReadonlyMap<Entity, ReadonlyMap<AssetIndex, Handle<AnimationClip> | null>>;
}

/**
 * The clip a player should actually sample for a given authored clip handle,
 * when it differs from the authored one. Populated by the auto-retarget path:
 * when a player binds a clip authored for a different rig, the retargeted
 * (derived) clip is resolved here instead, keyed by the player entity and the
 * authored handle's {@link AssetIndex}.
 *
 * The authored handle on the component is never rewritten, so a scene saves only
 * the original clip reference; this mapping is transient and recomputed on every
 * load. A `null` entry means "this clip is foreign but its retargeted form is
 * not ready yet" — the sampler skips that contribution rather than playing the
 * raw (mis-targeted) clip, so an in-flight model load never flickers a wrong
 * pose. An absent entry means the authored handle is used unchanged (the clip is
 * native, or no auto-retarget path is installed).
 */
export class EffectiveClips implements EffectiveClipsView {
  /** Player entity → (authored clip handle index → effective clip, or `null` to suppress). */
  readonly byPlayer = new Map<Entity, Map<AssetIndex, Handle<AnimationClip> | null>>();

  /** Record the effective clip (or `null` suppression) for one authored handle on a player. */
  set(player: Entity, authored: AssetIndex, effective: Handle<AnimationClip> | null): void {
    let inner = this.byPlayer.get(player);
    if (inner === undefined) {
      inner = new Map();
      this.byPlayer.set(player, inner);
    }
    inner.set(authored, effective);
  }

  /** Drop every effective entry for a player (e.g. its clip assignment changed). */
  clearPlayer(player: Entity): void {
    this.byPlayer.delete(player);
  }
}

/**
 * Resolve the clip handle a player should sample: the recorded effective handle
 * if one exists, the authored handle if not, or `null` if the clip is foreign
 * and its retargeted form is not ready (caller skips the contribution).
 */
export const effectiveClip = (
  effective: EffectiveClipsView | undefined,
  player: Entity,
  authored: Handle<AnimationClip>,
): Handle<AnimationClip> | null => {
  const inner = effective?.byPlayer.get(player);
  if (inner === undefined || !inner.has(authored.index)) return authored;
  return inner.get(authored.index) ?? null;
};
