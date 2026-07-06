import { describe, expect, it } from 'bun:test';

import { UiNode } from '../ui-node';

import { Disabled, UiButton } from './ui-button';
import { Interactable } from './ui-interaction';

describe('UiButton', () => {
  it('provides a default palette', () => {
    const b = new UiButton();
    expect(b.normal[3]).toBe(1);
    expect(Array.from(b.hovered).length).toBe(4);
    expect(b.pressed).not.toEqual(b.normal);
  });

  it('accepts palette overrides', () => {
    const red = new Float32Array([1, 0, 0, 1]);
    const b = new UiButton({ hovered: red as unknown as UiButton['hovered'] });
    expect(Array.from(b.hovered)).toEqual([1, 0, 0, 1]);
  });

  it('requires the Interactable machinery (and thus a UiNode)', () => {
    expect(UiButton.requires).toContain(Interactable);
    expect(UiButton.requires).toContain(UiNode);
  });

  it('Disabled is a bare marker', () => {
    expect(new Disabled()).toBeInstanceOf(Disabled);
  });
});
