import { asAssetIndex, makeHandle } from '@retro-engine/assets';
import type { Entity } from '@retro-engine/ecs';
import { describe, expect, it } from 'bun:test';

import type { AnimationClip } from './animation-clip';
import { EffectiveClips, effectiveClip } from './effective-clips';

const player = 7 as Entity;
const authored = makeHandle<AnimationClip>(asAssetIndex(3));
const derived = makeHandle<AnimationClip>(asAssetIndex(99));

describe('effectiveClip', () => {
  it('returns the authored handle when no entry exists (native / no auto-retarget)', () => {
    const eff = new EffectiveClips();
    expect(effectiveClip(eff, player, authored)).toBe(authored);
    expect(effectiveClip(undefined, player, authored)).toBe(authored);
  });

  it('returns the recorded effective handle for a retargeted clip', () => {
    const eff = new EffectiveClips();
    eff.set(player, authored.index, derived);
    expect(effectiveClip(eff, player, authored)).toBe(derived);
  });

  it('returns null when the clip is suppressed (foreign, not yet ready)', () => {
    const eff = new EffectiveClips();
    eff.set(player, authored.index, null);
    expect(effectiveClip(eff, player, authored)).toBeNull();
  });

  it('keys by player, so another player resolves independently', () => {
    const eff = new EffectiveClips();
    eff.set(player, authored.index, derived);
    expect(effectiveClip(eff, 8 as Entity, authored)).toBe(authored);
  });

  it('drops a player’s entries on clearPlayer', () => {
    const eff = new EffectiveClips();
    eff.set(player, authored.index, derived);
    eff.clearPlayer(player);
    expect(effectiveClip(eff, player, authored)).toBe(authored);
  });
});
