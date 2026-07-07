import { describe, expect, it } from 'bun:test';

import type { Entity } from '@retro-engine/ecs';

import { UiNode } from '../ui-node';

import { Interactable } from './ui-interaction';
import { applyToggleClicks, UiToggle, UiToggled } from './ui-toggle';

const e = (n: number): Entity => n as unknown as Entity;

describe('UiToggle', () => {
  it('defaults to unchecked with a full on/off/disabled palette', () => {
    const t = new UiToggle();
    expect(t.checked).toBe(false);
    expect(Array.from(t.on).length).toBe(4);
    expect(t.on).not.toEqual(t.off);
  });

  it('accepts an initial checked state and palette overrides', () => {
    const green = new Float32Array([0, 1, 0, 1]);
    const t = new UiToggle({ checked: true, on: green as unknown as UiToggle['on'] });
    expect(t.checked).toBe(true);
    expect(Array.from(t.on)).toEqual([0, 1, 0, 1]);
  });

  it('requires the Interactable machinery (and thus a UiNode)', () => {
    expect(UiToggle.requires).toContain(Interactable);
    expect(UiToggle.requires).toContain(UiNode);
  });
});

describe('applyToggleClicks', () => {
  const world = (map: Map<Entity, UiToggle>, disabled = new Set<Entity>()) => ({
    get: (entity: Entity) => map.get(entity),
    disabled: (entity: Entity) => disabled.has(entity),
  });

  it('flips a clicked toggle and emits UiToggled with the new value', () => {
    const t = new UiToggle();
    const map = new Map([[e(1), t]]);
    const w = world(map);
    const emitted: UiToggled[] = [];
    const changed: Entity[] = [];

    applyToggleClicks([e(1)], w.get, w.disabled, (x) => changed.push(x), (m) => emitted.push(m));
    expect(t.checked).toBe(true);
    expect(changed).toEqual([e(1)]);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.entity).toBe(e(1));
    expect(emitted[0]!.checked).toBe(true);

    // A second click flips it back.
    applyToggleClicks([e(1)], w.get, w.disabled, () => undefined, (m) => emitted.push(m));
    expect(t.checked).toBe(false);
    expect(emitted[1]!.checked).toBe(false);
  });

  it('ignores clicked entities that have no toggle', () => {
    const emitted: UiToggled[] = [];
    applyToggleClicks([e(99)], () => undefined, () => false, () => undefined, (m) => emitted.push(m));
    expect(emitted).toHaveLength(0);
  });

  it('does not flip a disabled toggle', () => {
    const t = new UiToggle({ checked: false });
    const map = new Map([[e(1), t]]);
    const w = world(map, new Set([e(1)]));
    const emitted: UiToggled[] = [];
    applyToggleClicks([e(1)], w.get, w.disabled, () => undefined, (m) => emitted.push(m));
    expect(t.checked).toBe(false);
    expect(emitted).toHaveLength(0);
  });

  it('flips several toggles in one batch', () => {
    const a = new UiToggle({ checked: false });
    const b = new UiToggle({ checked: true });
    const map = new Map([
      [e(1), a],
      [e(2), b],
    ]);
    const w = world(map);
    const emitted: UiToggled[] = [];
    applyToggleClicks([e(1), e(2)], w.get, w.disabled, () => undefined, (m) => emitted.push(m));
    expect(a.checked).toBe(true);
    expect(b.checked).toBe(false);
    expect(emitted.map((m) => m.checked)).toEqual([true, false]);
  });
});
