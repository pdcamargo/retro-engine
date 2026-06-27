import { quat, vec3 } from '@retro-engine/math';
import { describe, expect, it } from 'bun:test';

import { Children, Parent } from '../hierarchy';
import { App } from '../index';
import { SkinnedPalettes } from '../skinning/palette';
import { makeRenderingRenderer } from '../test-utils';
import { Transform } from '../transform';
import { parseMakeHumanRig } from './makehuman-rig';
import { buildRigPose } from './rig-pose';
import { spawnRig } from './spawn-rig';

const RIG = JSON.stringify({
  Root: { head: { default_position: [0, 0, 0] }, tail: { default_position: [0, 1, 0] }, parent: '' },
  spine: { head: { default_position: [0, 1, 0] }, tail: { default_position: [0, 2, 0] }, parent: 'Root' },
  head: { head: { default_position: [0, 2, 0] }, tail: { default_position: [0, 3, 0] }, parent: 'spine' },
});

const makeApp = (): App => new App({ renderer: makeRenderingRenderer() });

describe('spawnRig', () => {
  it('wires the joint hierarchy with Parent/Children edges', () => {
    const app = makeApp();
    const pose = buildRigPose(parseMakeHumanRig(RIG));
    const { joints } = spawnRig(app.world, pose);

    expect(joints).toHaveLength(3);
    expect(app.world.getComponent(joints[0]!, Parent)).toBeUndefined(); // Root is free
    expect(app.world.getComponent(joints[1]!, Parent)?.entity).toBe(joints[0]!);
    expect(app.world.getComponent(joints[2]!, Parent)?.entity).toBe(joints[1]!);
    expect(app.world.getComponent(joints[0]!, Children)?.entities).toEqual([joints[1]!]);
    expect(app.world.getComponent(joints[1]!, Children)?.entities).toEqual([joints[2]!]);
  });

  it('deforms a descendant joint when an ancestor is posed', () => {
    const app = makeApp();
    const pose = buildRigPose(parseMakeHumanRig(RIG));
    const { joints, skeleton } = spawnRig(app.world, pose);
    const mesh = app.world.spawn(new Transform(), skeleton);

    app.advanceFrame();

    const palettes = app.getResource(SkinnedPalettes)!;
    // At rest, every joint sits at its bind ⇒ identity palette.
    const restHead = palettes.byEntity.get(mesh)!.data.slice(32, 48);
    expect(restHead[13]).toBeCloseTo(0, 5);

    // Rotate the spine (joint 1) 90° about Z; the head (joint 2, its child) must
    // follow through the Parent/Children chain, so its palette matrix changes.
    const spine = app.world.getComponent(joints[1]!, Transform)!;
    spine.rotation = quat.fromAxisAngle(vec3.create(0, 0, 1), Math.PI / 2, quat.create());
    app.world.markChanged(joints[1]!, Transform);
    app.advanceFrame();

    const posedHead = palettes.byEntity.get(mesh)!.data.slice(32, 48);
    // The head joint's world position moved off the Y axis (rotated about the
    // spine head at (0,1,0)), so the palette translation gained an X component.
    expect(Math.abs(posedHead[12]!)).toBeGreaterThan(0.5);
    expect(posedHead[12]).not.toBeCloseTo(restHead[12]!, 3);
  });
});
