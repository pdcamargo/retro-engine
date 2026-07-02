import { describe, expect, it } from 'bun:test';

import { AnimationClip } from './animation-clip';
import { AnimationClips } from './animation-clip-asset';
import { AnimationController, type ControllerLayer, type Motion } from './animation-controller';
import { AnimationControllers, createAnimationControllerSerializer } from './animation-controller-asset';
import { AvatarMask } from './avatar-mask';
import { AvatarMasks } from './avatar-mask-asset';

const emptyClip = (): AnimationClip => new AnimationClip([], 1);

/** A serializer wired to the three stores it resolves handles through. */
const makeSerializer = (clips: AnimationClips) =>
  createAnimationControllerSerializer(clips, new AnimationControllers(), new AvatarMasks());

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

    const bytes = makeSerializer(clips).serialize(controller);

    // Decode through a fresh store: unresolved GUIDs reserve slots but keep the
    // GUID, so the recursive structure survives an independent round-trip.
    const clips2 = new AnimationClips();
    const restored = makeSerializer(clips2).deserialize(bytes);

    // Re-serializing the restored controller reproduces identical bytes.
    const reBytes = makeSerializer(clips2).serialize(restored);
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

  it('round-trips author-facing names on nested blend trees', () => {
    const clips = new AnimationClips();
    const walk = clips.add(emptyClip());
    const motion: Motion = {
      kind: 'blend2d',
      name: 'Locomotion',
      mode: 'freeformDirectional',
      parameterX: 'moveX',
      parameterY: 'moveY',
      children: [
        { motion: { kind: 'blend1d', name: 'Forward', parameter: 'speed', children: [{ motion: { kind: 'clip', clip: walk }, threshold: 0 }] }, x: 0, y: 1 },
        // An unnamed slot stays unnamed (no `name` key emitted).
        { motion: { kind: 'blend1d', parameter: 'speed', children: [{ motion: { kind: 'clip', clip: walk }, threshold: 0 }] }, x: 1, y: 0 },
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
      'named-locomotion',
    );

    const restored = makeSerializer(new AnimationClips()).deserialize(makeSerializer(clips).serialize(controller));
    const outer = restored.states[0]!.motion;
    if (outer.kind !== 'blend2d') throw new Error('expected blend2d');
    expect(outer.name).toBe('Locomotion');
    const named = outer.children[0]!.motion;
    const unnamed = outer.children[1]!.motion;
    if (named.kind !== 'blend1d' || unnamed.kind !== 'blend1d') throw new Error('expected blend1d slots');
    expect(named.name).toBe('Forward');
    expect(unnamed.name).toBeUndefined();
  });
});

describe('AnimationController serialization — layers (v3)', () => {
  it('round-trips a masked additive clip layer and a controller layer by GUID', () => {
    const clips = new AnimationClips();
    const base = clips.add(emptyClip());
    const aim = clips.add(emptyClip());

    const masks = new AvatarMasks();
    const upperBody = masks.add(new AvatarMask(['Spine', 'Chest', 'L Arm', 'R Arm'], 'UpperBody'));

    const otherControllers = new AnimationControllers();
    const subController = otherControllers.add(new AnimationController([], [{ name: 'idle', motion: { kind: 'clip', clip: base } }]));

    const layers: ControllerLayer[] = [
      {
        name: 'Upper Body Aim',
        weight: 0.8,
        blend: 'additive',
        mask: upperBody,
        source: { kind: 'clip', clip: aim, speed: 1, playing: true, repeat: 'loop' },
      },
      {
        name: 'Face',
        weight: 1,
        blend: 'override',
        source: { kind: 'controller', controller: subController, speed: 1, playing: true, parameters: [{ name: 'blink', value: 0 }] },
      },
    ];

    const controller = new AnimationController(
      [],
      [{ name: 'locomotion', motion: { kind: 'clip', clip: base } }],
      [],
      0,
      'layered',
      layers,
    );

    // Serialize with the authoring stores, decode through fresh stores by GUID.
    const serializer = createAnimationControllerSerializer(clips, otherControllers, masks);
    const bytes = serializer.serialize(controller);

    const restored = createAnimationControllerSerializer(
      new AnimationClips(),
      new AnimationControllers(),
      new AvatarMasks(),
    ).deserialize(bytes);

    expect(restored.layers).toHaveLength(2);
    const [aimLayer, faceLayer] = restored.layers;

    expect(aimLayer!.name).toBe('Upper Body Aim');
    expect(aimLayer!.weight).toBe(0.8);
    expect(aimLayer!.blend).toBe('additive');
    expect(aimLayer!.mask?.guid).toBe(upperBody.guid);
    expect(aimLayer!.source.kind).toBe('clip');
    if (aimLayer!.source.kind !== 'clip') throw new Error('expected clip source');
    expect(aimLayer!.source.clip.guid).toBe(aim.guid);

    expect(faceLayer!.blend).toBe('override');
    expect(faceLayer!.source.kind).toBe('controller');
    if (faceLayer!.source.kind !== 'controller') throw new Error('expected controller source');
    expect(faceLayer!.source.controller.guid).toBe(subController.guid);
    expect(faceLayer!.source.parameters).toEqual([{ name: 'blink', value: 0 }]);
  });

  it('emits the v3 wire format as YAML with no layers key when empty', () => {
    const clips = new AnimationClips();
    const controller = new AnimationController([], [{ name: 's', motion: { kind: 'clip', clip: clips.add(emptyClip()) } }]);
    const text = new TextDecoder().decode(makeSerializer(clips).serialize(controller));

    // YAML (not JSON braces) and the bumped version; omitted layers stay absent.
    expect(text).toContain('version: 3');
    expect(text).not.toContain('{');
    expect(text).not.toContain('layers:');
  });

  it('rejects an older format version with a clear error', () => {
    const v2 = new TextEncoder().encode('version: 2\ndefaultState: 0\nparameters: []\nstates: []\ntransitions: []\n');
    expect(() => makeSerializer(new AnimationClips()).deserialize(v2)).toThrow(/unsupported format version 2/);
  });
});
