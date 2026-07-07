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

  it('emits a pan for a single moving touch (per frame), not on the down frame', () => {
    const touches = new Touches();
    const state = new TouchGestureState();
    const down = frame(touches, state, 0, () => touches.start(1, 100, 100));
    expect(down.pans).toHaveLength(0); // no movement on the down frame
    const dragged = frame(touches, state, 16, () => touches.move(1, 112, 105));
    expect(dragged.pans).toHaveLength(1);
    expect([dragged.pans[0]!.deltaX, dragged.pans[0]!.deltaY]).toEqual([12, 5]);
    expect([dragged.pans[0]!.x, dragged.pans[0]!.y]).toEqual([112, 105]);
  });

  it('emits a pinch scale for two touches spreading apart / together', () => {
    const touches = new Touches();
    const state = new TouchGestureState();
    // Both down 20px apart → seeds the reference distance, no pinch yet.
    const seed = frame(touches, state, 0, () => {
      touches.start(1, 0, 0);
      touches.start(2, 20, 0);
    });
    expect(seed.pinches).toHaveLength(0);
    // Second touch moves out to 40px → distance doubled → scale 2 (spreading).
    const apart = frame(touches, state, 16, () => touches.move(2, 40, 0));
    expect(apart.pinches).toHaveLength(1);
    expect(apart.pinches[0]!.scale).toBeCloseTo(2, 5);
    expect(apart.pinches[0]!.centerX).toBeCloseTo(20, 5);
    // Back to 20px → halved → scale 0.5 (pinching in).
    const together = frame(touches, state, 32, () => touches.move(2, 20, 0));
    expect(together.pinches[0]!.scale).toBeCloseTo(0.5, 5);
    // A single touch is a pan, never a pinch.
    const single = frame(touches, state, 48, () => touches.end(2));
    expect(single.pinches).toHaveLength(0);
    expect(state.pinchPrevDistance).toBeUndefined();
  });
});
