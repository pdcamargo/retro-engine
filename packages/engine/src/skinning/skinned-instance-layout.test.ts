import { mat4, vec3 } from '@retro-engine/math';
import { describe, expect, it } from 'bun:test';

import {
  SKINNED_INSTANCE_BYTE_SIZE,
  SKINNED_INSTANCE_FLOAT_COUNT,
  SKINNED_INSTANCE_LAYOUT,
  SKINNED_JOINT_OFFSET_LOCATION,
  packSkinnedInstance,
} from './skinned-instance-layout';

describe('skinned instance layout', () => {
  it('is the rigid 128-byte instance plus a 4-byte joint offset', () => {
    expect(SKINNED_INSTANCE_BYTE_SIZE).toBe(132);
    expect(SKINNED_INSTANCE_FLOAT_COUNT).toBe(33);
    expect(SKINNED_INSTANCE_LAYOUT.arrayStride).toBe(132);
  });

  it('places joint_offset at the free location 7 as a uint32', () => {
    const offsetAttr = SKINNED_INSTANCE_LAYOUT.attributes.find(
      (a) => a.shaderLocation === SKINNED_JOINT_OFFSET_LOCATION,
    );
    expect(SKINNED_JOINT_OFFSET_LOCATION).toBe(7);
    expect(offsetAttr).toBeDefined();
    expect(offsetAttr!.format).toBe('uint32');
    expect(offsetAttr!.offset).toBe(128);
    // The eight transform columns still occupy 8..15.
    const locs = SKINNED_INSTANCE_LAYOUT.attributes.map((a) => a.shaderLocation).sort((x, y) => x - y);
    expect(locs).toEqual([7, 8, 9, 10, 11, 12, 13, 14, 15]);
  });

  it('packs the model matrix then the joint offset into the shared buffer', () => {
    const buffer = new ArrayBuffer(SKINNED_INSTANCE_BYTE_SIZE);
    const f32 = new Float32Array(buffer);
    const u32 = new Uint32Array(buffer);
    const model = mat4.translation(vec3.create(1, 2, 3));

    const written = packSkinnedInstance(f32, u32, 0, model, 64);

    expect(written).toBe(SKINNED_INSTANCE_FLOAT_COUNT);
    // First 16 floats are the model matrix (translation in the last column).
    expect(f32[12]).toBeCloseTo(1, 5);
    expect(f32[13]).toBeCloseTo(2, 5);
    expect(f32[14]).toBeCloseTo(3, 5);
    // Joint offset lands in the 33rd slot (after model + inverse-transpose).
    expect(u32[32]).toBe(64);
  });
});
