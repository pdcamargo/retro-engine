import { describe, expect, it } from 'bun:test';

import { mapPrimitiveMode } from './topology';
import { expectGltfError } from './test-support';

describe('mapPrimitiveMode', () => {
  it('defaults to triangle-list when mode is omitted', () => {
    expect(mapPrimitiveMode()).toBe('triangle-list');
  });

  it('maps the representable glTF modes', () => {
    expect(mapPrimitiveMode(0)).toBe('point-list');
    expect(mapPrimitiveMode(1)).toBe('line-list');
    expect(mapPrimitiveMode(3)).toBe('line-strip');
    expect(mapPrimitiveMode(4)).toBe('triangle-list');
    expect(mapPrimitiveMode(5)).toBe('triangle-strip');
  });

  it('rejects LINE_LOOP and TRIANGLE_FAN (no WebGPU topology)', () => {
    expectGltfError(() => mapPrimitiveMode(2), 'unsupported-primitive-mode');
    expectGltfError(() => mapPrimitiveMode(6), 'unsupported-primitive-mode');
  });

  it('rejects an out-of-range mode', () => {
    expectGltfError(() => mapPrimitiveMode(7), 'invalid-accessor');
  });
});
