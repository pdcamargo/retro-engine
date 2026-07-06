import { describe, expect, it } from 'bun:test';

import type { Entity } from '@retro-engine/ecs';
import type { CursorPosition, MouseButton, MouseButtonInput } from '@retro-engine/input';

import { ComputedLayout } from '../ui-node';

import { type InteractionNode, pickTopmost, UiPointer, updateUiInteraction } from './picking';
import { UiInteraction, type UiInteractionState } from './ui-interaction';

const layout = (x: number, y: number, w: number, h: number, order: number): ComputedLayout => {
  const l = new ComputedLayout(x, y, w, h);
  l.order = order;
  return l;
};

const node = (id: number, l: ComputedLayout): InteractionNode => ({
  entity: id as unknown as Entity,
  layout: l,
  ui: new UiInteraction(),
});

const cursor = (x: number, y: number, present = true): CursorPosition =>
  ({ x, y, present }) as CursorPosition;

const buttons = (state: {
  pressed?: boolean;
  justPressed?: boolean;
  justReleased?: boolean;
}): MouseButtonInput =>
  ({
    pressed: (b: MouseButton) => b === 'Left' && !!state.pressed,
    justPressed: (b: MouseButton) => b === 'Left' && !!state.justPressed,
    justReleased: (b: MouseButton) => b === 'Left' && !!state.justReleased,
  }) as unknown as MouseButtonInput;

describe('pickTopmost', () => {
  const a = node(1, layout(0, 0, 100, 100, 0));
  const b = node(2, layout(20, 20, 40, 40, 5)); // overlaps a, higher order

  it('returns the containing node', () => {
    expect(pickTopmost([a], 50, 50)).toBe(a.entity);
  });

  it('returns the topmost (highest order) among overlapping nodes', () => {
    expect(pickTopmost([a, b], 30, 30)).toBe(b.entity);
    expect(pickTopmost([a, b], 90, 90)).toBe(a.entity); // outside b, inside a
  });

  it('returns null outside every node', () => {
    expect(pickTopmost([a, b], 200, 200)).toBeNull();
  });
});

describe('updateUiInteraction', () => {
  const noop = (): void => undefined;

  it('marks the hovered node hovered and others none', () => {
    const a = node(1, layout(0, 0, 100, 100, 0));
    const b = node(2, layout(200, 0, 100, 100, 1));
    const changed: Entity[] = [];
    updateUiInteraction([a, b], cursor(50, 50), buttons({}), new UiPointer(), noop, (e) => changed.push(e));
    expect(a.ui.state).toBe('hovered');
    expect(b.ui.state).toBe('none');
    expect(changed).toContain(a.entity);
  });

  it('marks the pressed-origin node pressed while the button is held', () => {
    const a = node(1, layout(0, 0, 100, 100, 0));
    const pointer = new UiPointer();
    updateUiInteraction([a], cursor(50, 50), buttons({ justPressed: true, pressed: true }), pointer, noop, noop);
    expect(pointer.pressed).toBe(a.entity);
    expect(a.ui.state).toBe('pressed');
  });

  it('emits a click when a press releases over the same node', () => {
    const a = node(1, layout(0, 0, 100, 100, 0));
    const pointer = new UiPointer();
    const clicks: Entity[] = [];
    // Frame 1: press.
    updateUiInteraction([a], cursor(50, 50), buttons({ justPressed: true, pressed: true }), pointer, (e) => clicks.push(e), noop);
    // Frame 2: release over the same node.
    updateUiInteraction([a], cursor(50, 50), buttons({ justReleased: true }), pointer, (e) => clicks.push(e), noop);
    expect(clicks).toEqual([a.entity]);
    expect(pointer.pressed).toBeNull();
    expect(a.ui.state).toBe('hovered'); // still under cursor after release
  });

  it('does not emit a click when the release is over a different node', () => {
    const a = node(1, layout(0, 0, 100, 100, 0));
    const b = node(2, layout(200, 0, 100, 100, 1));
    const pointer = new UiPointer();
    const clicks: Entity[] = [];
    updateUiInteraction([a, b], cursor(50, 50), buttons({ justPressed: true, pressed: true }), pointer, (e) => clicks.push(e), noop);
    // Release while over b.
    updateUiInteraction([a, b], cursor(250, 50), buttons({ justReleased: true }), pointer, (e) => clicks.push(e), noop);
    expect(clicks).toEqual([]);
    expect(pointer.pressed).toBeNull();
  });

  it('clears interaction when the cursor is not present', () => {
    const a = node(1, layout(0, 0, 100, 100, 0));
    a.ui.state = 'hovered' as UiInteractionState;
    updateUiInteraction([a], cursor(50, 50, false), buttons({}), new UiPointer(), noop, noop);
    expect(a.ui.state).toBe('none');
  });
});
