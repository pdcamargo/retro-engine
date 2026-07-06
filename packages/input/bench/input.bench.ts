// Per-frame input cost: the clear-then-drain cycle `InputPlugin` runs every
// frame in `preUpdate`, plus the raw ButtonInput transitions underneath it.
// This is on the frame hot path, so it must stay cheap regardless of how many
// events a busy frame carries. See docs/adr/ADR-0144 (input architecture) and
// docs/adr/ADR-0017 (bench methodology).

import { bench, summary } from 'mitata';

import { ButtonInput } from '../src/button-input';
import {
  CursorPosition,
  MouseButtonInput,
  MouseMotion,
  MouseScroll,
} from '../src/mouse';
import { KeyboardInput } from '../src/keyboard';
import { applyInputFrame } from '../src/input-plugin';
import type { InputBackend, RawInputEvent } from '../src/raw-event';
import { Touches } from '../src/touch';

// A backend that replays a fixed batch of events on every drain — models a busy
// frame (several keys held, cursor dragging, wheel spinning) without any DOM.
const makeReplayBackend = (events: readonly RawInputEvent[]): InputBackend => ({
  attach() {},
  detach() {},
  drain: () => events,
});

const frameEvents = (keys: number): RawInputEvent[] => {
  const out: RawInputEvent[] = [];
  for (let i = 0; i < keys; i += 1) out.push({ kind: 'key-down', code: `Key${i}`, repeat: false });
  out.push({ kind: 'mouse-move', x: 100, y: 120, dx: 4, dy: -2, present: true });
  out.push({ kind: 'wheel', dx: 0, dy: 3, unit: 'line' });
  out.push({ kind: 'mouse-down', button: 0 });
  // A couple of moving touch points (multi-touch drag).
  out.push({ kind: 'touch-move', id: 0, x: 40, y: 50 });
  out.push({ kind: 'touch-move', id: 1, x: 200, y: 220 });
  return out;
};

for (const keys of [1, 8, 32]) {
  summary(() => {
    bench(`applyInputFrame @ ${keys} keys/frame`, function* () {
      const backend = makeReplayBackend(frameEvents(keys));
      const keyboard = new KeyboardInput();
      const mouseButtons = new MouseButtonInput();
      const motion = new MouseMotion();
      const scroll = new MouseScroll();
      const cursor = new CursorPosition();
      const touches = new Touches();
      yield () => applyInputFrame(backend, keyboard, mouseButtons, motion, scroll, cursor, touches);
    });
  });
}

summary(() => {
  bench('ButtonInput press/query/clear cycle @ 32 keys', function* () {
    const input = new ButtonInput<string>();
    const codes = Array.from({ length: 32 }, (_, i) => `Key${i}`);
    yield () => {
      input.clear();
      for (const c of codes) input.press(c);
      let held = 0;
      for (const c of codes) if (input.pressed(c)) held += 1;
      for (const c of codes) input.release(c);
      return held;
    };
  });
});
