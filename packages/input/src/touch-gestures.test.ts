import { describe, expect, it } from 'bun:test';

import { Touches } from './touch';
import { recognizeGestures, TouchGestureState } from './touch-gestures';

/** Drive `touches` through one frame of raw events, then recognize at `nowMs`. */
const frame = (touches: Touches, state: TouchGestureState, nowMs: number, apply: () => void) => {
  touches.beginFrame();
  apply();
  return recognizeGestures(touches, nowMs, state);
};

describe('recognizeGestures', () => {
  it('recognizes a quick, still touch as a tap', () => {
    const touches = new Touches();
    const state = new TouchGestureState();
    frame(touches, state, 0, () => touches.start(1, 100, 200)); // down
    const { taps, swipes } = frame(touches, state, 120, () => touches.end(1)); // up, 120ms later
    expect(swipes).toHaveLength(0);
    expect(taps).toHaveLength(1);
    expect([taps[0]!.x, taps[0]!.y]).toEqual([100, 200]);
  });

  it('recognizes a fast flick as a directional swipe', () => {
    const touches = new Touches();
    const state = new TouchGestureState();
    frame(touches, state, 0, () => touches.start(1, 0, 0));
    frame(touches, state, 40, () => touches.move(1, 60, 5)); // travels right
    const { taps, swipes } = frame(touches, state, 90, () => touches.end(1));
    expect(taps).toHaveLength(0);
    expect(swipes).toHaveLength(1);
    expect(swipes[0]!.direction).toBe('right');
    expect(swipes[0]!.dx).toBe(60);
  });

  it('picks the dominant axis for swipe direction (up)', () => {
    const touches = new Touches();
    const state = new TouchGestureState();
    frame(touches, state, 0, () => touches.start(1, 50, 100));
    frame(touches, state, 30, () => touches.move(1, 55, 10)); // mostly up (dy = -90)
    const { swipes } = frame(touches, state, 70, () => touches.end(1));
    expect(swipes).toHaveLength(1);
    expect(swipes[0]!.direction).toBe('up');
  });

  it('classifies neither a tap (too slow) nor a swipe (too short) as no gesture', () => {
    const touches = new Touches();
    const state = new TouchGestureState();
    frame(touches, state, 0, () => touches.start(1, 0, 0));
    frame(touches, state, 300, () => touches.move(1, 8, 0)); // 8px < swipe min, held 300ms
    const { taps, swipes } = frame(touches, state, 600, () => touches.end(1)); // 600ms > tap max
    expect(taps).toHaveLength(0);
    expect(swipes).toHaveLength(0);
  });

  it('a far-but-slow drag is not a swipe (exceeds swipeMaxMs)', () => {
    const touches = new Touches();
    const state = new TouchGestureState();
    frame(touches, state, 0, () => touches.start(1, 0, 0));
    frame(touches, state, 500, () => touches.move(1, 200, 0));
    const { taps, swipes } = frame(touches, state, 1000, () => touches.end(1));
    expect(taps).toHaveLength(0);
    expect(swipes).toHaveLength(0);
  });

  it('drops a canceled touch without emitting a gesture', () => {
    const touches = new Touches();
    const state = new TouchGestureState();
    frame(touches, state, 0, () => touches.start(1, 0, 0));
    const { taps, swipes } = frame(touches, state, 40, () => touches.cancel(1));
    expect(taps).toHaveLength(0);
    expect(swipes).toHaveLength(0);
    // Next frame the entry is gone (no stale tracking → no late gesture).
    const after = frame(touches, state, 80, () => undefined);
    expect(after.taps).toHaveLength(0);
    expect(state.starts.size).toBe(0);
  });
});
