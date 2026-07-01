import { describe, expect, it } from 'bun:test';

import { AnimationClip } from './animation-clip';
import { AnimationClips } from './animation-clip-asset';
import { AnimationController, type Motion } from './animation-controller';
import { createAnimationControllerSerializer } from './animation-controller-asset';

const emptyClip = (): AnimationClip => new AnimationClip([], 1);

describe('AnimationController serialization — nested blend trees', () => {
  it('round-trips a recursive motion (blend2d whose slots are blend1d trees)', () => {
    const clips = new AnimationClips();
    const idle = clips.add(emptyClip());
    const walk = clips.add(emptyClip());
    const run = clips.add(emptyClip());

    // Two directional slots, each a 1D speed blend over idle → walk → run,
    // driven by a different parameter than the outer directional tree.
    const speedTree = (): Motion => ({
      kind: 'blend1d',
      parameter: 'speed',
      children: [
        { motion: { kind: 'clip', clip: idle }, threshold: 0 },
        { motion: { kind: 'clip', clip: walk }, threshold: 0.5 },
        { motion: { kind: 'clip', clip: run }, threshold: 1 },
      ],
    });
    const motion: Motion = {
      kind: 'blend2d',
      mode: 'freeformDirectional',
      parameterX: 'moveX',
      parameterY: 'moveY',
      children: [
        { motion: speedTree(), x: 1, y: 0 },
        { motion: speedTree(), x: 0, y: 1 },
      ],
    };

    const controller = new AnimationController(
      [
        { name: 'moveX', type: 'float', default: 0 },
        { name: 'moveY', type: 'float', default: 0 },
        { name: 'speed', type: 'float', default: 0 },
      ],
      [{ name: 'locomotion', motion }],
      [],
      0,
      'nested-locomotion',
    );

    const serializer = createAnimationControllerSerializer(clips);
    const bytes = serializer.serialize(controller);

    // Decode through a fresh store: unresolved GUIDs reserve slots but keep the
    // GUID, so the recursive structure survives an independent round-trip.
    const clips2 = new AnimationClips();
    const restored = createAnimationControllerSerializer(clips2).deserialize(bytes);

    // Re-serializing the restored controller reproduces identical bytes.
    const reBytes = createAnimationControllerSerializer(clips2).serialize(restored);
    expect(new TextDecoder().decode(reBytes)).toBe(new TextDecoder().decode(bytes));

    // And the recursive shape/leaf GUIDs came back intact.
    const outer = restored.states[0]!.motion;
    expect(outer.kind).toBe('blend2d');
    if (outer.kind !== 'blend2d') throw new Error('expected blend2d');
    expect(outer.parameterX).toBe('moveX');
    expect(outer.children).toHaveLength(2);

    const firstSlot = outer.children[0]!.motion;
    expect(firstSlot.kind).toBe('blend1d');
    if (firstSlot.kind !== 'blend1d') throw new Error('expected blend1d');
    expect(firstSlot.parameter).toBe('speed');
    expect(firstSlot.children.map((c) => c.threshold)).toEqual([0, 0.5, 1]);

    const idleLeaf = firstSlot.children[0]!.motion;
    expect(idleLeaf.kind).toBe('clip');
    if (idleLeaf.kind !== 'clip') throw new Error('expected clip');
    expect(idleLeaf.clip.guid).toBe(idle.guid);
  });
});
