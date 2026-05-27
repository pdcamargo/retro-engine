import { describe, expect, it } from 'bun:test';

import { vec2 } from '@retro-engine/math';

import { GlobalTransform, Transform } from '../transform';
import { InheritedVisibility, ViewVisibility, Visibility } from '../visibility';

import { LightOccluder2d } from './light-occluder-2d';

describe('LightOccluder2d', () => {
  it('defaults to no segments', () => {
    expect(new LightOccluder2d().segments).toEqual([]);
  });

  it('fromPolygon closes the loop by default (N points -> N segments)', () => {
    const occ = LightOccluder2d.fromPolygon([
      vec2.create(0, 0),
      vec2.create(10, 0),
      vec2.create(10, 10),
    ]);
    expect(occ.segments).toHaveLength(3);
    // Last segment joins the final point back to the first.
    expect(occ.segments[2]![0]).toEqual(vec2.create(10, 10));
    expect(occ.segments[2]![1]).toEqual(vec2.create(0, 0));
  });

  it('fromPolygon open leaves N-1 segments', () => {
    const occ = LightOccluder2d.fromPolygon(
      [vec2.create(0, 0), vec2.create(10, 0), vec2.create(10, 10)],
      false,
    );
    expect(occ.segments).toHaveLength(2);
  });

  it('rect produces a 4-segment closed box of the given half-extents', () => {
    const occ = LightOccluder2d.rect(8, 4);
    expect(occ.segments).toHaveLength(4);
    expect(occ.segments[0]![0]).toEqual(vec2.create(-8, -4));
  });

  it('exposes the canonical visibility / transform requires set (mirrors PointLight2d)', () => {
    expect(LightOccluder2d.requires).toEqual([
      Transform,
      GlobalTransform,
      Visibility,
      InheritedVisibility,
      ViewVisibility,
    ]);
  });
});
