import type { VertexBufferLayout } from '@retro-engine/renderer-core';
import { describe, expect, it } from 'bun:test';

import {
  INSTANCE_LAYOUT,
  PREVIOUS_INSTANCE_TRANSFORM_BASE_LOCATION,
  PREVIOUS_INSTANCE_LAYOUT,
} from './instance-layout';

/**
 * Standard mesh vertex attributes occupy vertex slot 0 at these locations
 * (position, normal, uv). The motion-vector prepass pipeline binds this slot
 * alongside {@link INSTANCE_LAYOUT} and {@link PREVIOUS_INSTANCE_LAYOUT}, so
 * all three share one 16-attribute address space.
 */
const MESH_SLOT0_LOCATIONS = [0, 1, 2];

const locationsOf = (layout: VertexBufferLayout): number[] =>
  layout.attributes.map((a) => a.shaderLocation);

describe('instance vertex layouts — WebGPU attribute-location limits', () => {
  it('keeps every shaderLocation within the 16-attribute floor (0..15)', () => {
    // WebGPU guarantees only `maxVertexAttributes = 16`, so the highest valid
    // `@location` is 15. A pipeline declaring an attribute at 16+ is rejected
    // at creation on a real device — invisible to the permissive test stub,
    // which is why this assertion exists.
    const all = [...locationsOf(INSTANCE_LAYOUT), ...locationsOf(PREVIOUS_INSTANCE_LAYOUT)];
    for (const loc of all) {
      expect(loc).toBeLessThanOrEqual(15);
      expect(loc).toBeGreaterThanOrEqual(0);
    }
  });

  it('assigns unique locations across the combined motion-vector prepass layout', () => {
    // The motion-vector prepass binds mesh slot 0 + current instance + previous
    // instance simultaneously; a duplicated location across the three would be
    // rejected by the backend.
    const combined = [
      ...MESH_SLOT0_LOCATIONS,
      ...locationsOf(INSTANCE_LAYOUT),
      ...locationsOf(PREVIOUS_INSTANCE_LAYOUT),
    ];
    expect(new Set(combined).size).toBe(combined.length);
    expect(Math.max(...combined)).toBeLessThanOrEqual(15);
  });

  it('lays out the previous-instance matrix as four contiguous float32x4 columns', () => {
    const base = PREVIOUS_INSTANCE_TRANSFORM_BASE_LOCATION;
    expect(PREVIOUS_INSTANCE_LAYOUT.attributes).toHaveLength(4);
    PREVIOUS_INSTANCE_LAYOUT.attributes.forEach((attr, i) => {
      expect(attr.format).toBe('float32x4');
      expect(attr.shaderLocation).toBe(base + i);
      expect(attr.offset).toBe(i * 16);
    });
  });
});
