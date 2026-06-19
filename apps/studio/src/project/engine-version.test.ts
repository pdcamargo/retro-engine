import { describe, expect, test } from 'bun:test';

import { engineVersionMismatch } from './engine-version';

describe('engineVersionMismatch', () => {
  test('matches on the breaking segment (minor under 0.x, major at >=1)', () => {
    expect(engineVersionMismatch('0.5.0', '0.5.3')).toBe(false);
    expect(engineVersionMismatch('0.5.0', '0.6.0')).toBe(true);
    expect(engineVersionMismatch('1.2.0', '1.9.9')).toBe(false);
    expect(engineVersionMismatch('1.0.0', '2.0.0')).toBe(true);
  });

  test('an unset version never mismatches', () => {
    expect(engineVersionMismatch('', '0.5.0')).toBe(false);
    expect(engineVersionMismatch('0.5.0', '')).toBe(false);
  });
});
