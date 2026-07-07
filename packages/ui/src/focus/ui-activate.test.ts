import { describe, expect, it } from 'bun:test';

import type { Entity } from '@retro-engine/ecs';

import { shouldActivateFocused, UiActivate } from './ui-activate';

const e = (n: number): Entity => n as unknown as Entity;

describe('shouldActivateFocused', () => {
  it('targets the focused entity when activated', () => {
    expect(shouldActivateFocused(true, e(7))).toBe(e(7));
  });

  it('does nothing without an activation this frame', () => {
    expect(shouldActivateFocused(false, e(7))).toBeNull();
  });

  it('does nothing when nothing is focused', () => {
    expect(shouldActivateFocused(true, null)).toBeNull();
  });

  it('UiActivate is a bare message', () => {
    expect(new UiActivate()).toBeInstanceOf(UiActivate);
  });
});
