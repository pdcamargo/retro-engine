// Per-frame cost of polling + reconciling gamepad state (ADR-0146). Runs once
// per frame in preUpdate; scales with connected pad count. See ADR-0017.

import { bench, summary } from 'mitata';

import { Gamepads, updateGamepads } from '../src/gamepad';
import { STANDARD_BUTTONS } from '../src/gamepad-mapping';
import type { GamepadSnapshot, GamepadSource } from '../src/gamepad-source';

const snapshot = (index: number): GamepadSnapshot => ({
  index,
  id: `pad${index}`,
  mapping: 'standard',
  connected: true,
  // A realistic mix: a couple of buttons held, sticks off-center, triggers half.
  buttons: STANDARD_BUTTONS.map((_, i) => ({ pressed: i === 0 || i === 12, value: i === 6 ? 0.5 : 0 })),
  axes: [0.4, -0.6, 0.1, 0.2],
});

class FixedSource implements GamepadSource {
  constructor(private readonly snaps: readonly GamepadSnapshot[]) {}
  poll(): readonly GamepadSnapshot[] {
    return this.snaps;
  }
}

for (const count of [1, 4]) {
  summary(() => {
    bench(`updateGamepads @ ${count} pad(s)`, function* () {
      const pads = new Gamepads();
      const source = new FixedSource(Array.from({ length: count }, (_, i) => snapshot(i)));
      // Warm the map so we measure the steady-state update, not first-connect.
      updateGamepads(pads, source);
      yield () => updateGamepads(pads, source);
    });
  });
}
