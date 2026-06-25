import { mat4, vec3 } from '@retro-engine/math';
import { describe, expect, it } from 'bun:test';

import { App } from '../index';
import { AppTypeRegistry } from '../scene/app-type-registry';
import { makeRenderingRenderer } from '../test-utils';
import { Transform } from '../transform';
import { SkinnedPalettes } from './palette';
import { Skeleton } from './skeleton';

const makeApp = (): App => new App({ renderer: makeRenderingRenderer() });

describe('SkinningPlugin — bone → palette', () => {
  it('registers Skeleton with a reflection schema', () => {
    const app = makeApp();
    app.advanceFrame();
    const reg = app.getResource(AppTypeRegistry)!;
    expect(reg.registry.getByCtor(Skeleton)?.name).toBe('Skeleton');
  });

  it('recomputes the joint palette every frame and deforms when a bone moves', () => {
    const app = makeApp();

    // Two joints at their bind positions; a mesh entity carries the skeleton.
    const joint0 = app.world.spawn(new Transform(vec3.create(0, 0, 0)));
    const joint1 = app.world.spawn(new Transform(vec3.create(0, 1, 0)));
    const bind0 = mat4.identity();
    const bind1 = mat4.translation(vec3.create(0, 1, 0));
    const mesh = app.world.spawn(
      new Transform(),
      new Skeleton([joint0, joint1], [mat4.inverse(bind0, mat4.create()), mat4.inverse(bind1, mat4.create())]),
    );

    app.advanceFrame();

    const palettes = app.getResource(SkinnedPalettes)!;
    const palette = palettes.byEntity.get(mesh);
    expect(palette).toBeDefined();
    expect(palette!.jointCount).toBe(2);

    // At rest pose every palette matrix is identity (joint sits at its bind).
    const restJoint1 = palette!.data.slice(16, 32);
    for (let i = 0; i < 16; i++) expect(restJoint1[i]!).toBeCloseTo(mat4.identity()[i] as number, 5);

    // Move bone 1 up by 4 more units; propagation + recompute must follow it.
    app.world.getComponent(joint1, Transform)!.translation = vec3.create(0, 5, 0);
    app.world.markChanged(joint1, Transform);
    app.advanceFrame();

    // palette[1] = jointGlobal(0,5,0) · inverseBind(0,1,0) = translate(0,4,0).
    const movedJoint1 = palettes.byEntity.get(mesh)!.data.slice(16, 32);
    expect(movedJoint1[13]).toBeCloseTo(4, 5);
    // The matrix actually changed from the rest pose.
    expect(movedJoint1[13]).not.toBeCloseTo(restJoint1[13]!, 5);
  });

  it('drops the palette entry when the skinned entity is despawned', () => {
    const app = makeApp();
    const joint = app.world.spawn(new Transform());
    const mesh = app.world.spawn(new Transform(), new Skeleton([joint], [mat4.identity()]));
    app.advanceFrame();
    expect(app.getResource(SkinnedPalettes)!.byEntity.has(mesh)).toBe(true);

    app.world.despawn(mesh);
    app.advanceFrame();
    expect(app.getResource(SkinnedPalettes)!.byEntity.has(mesh)).toBe(false);
  });
});
