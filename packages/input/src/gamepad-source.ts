/**
 * A plain, frame-owned snapshot of one connected gamepad, produced by a
 * {@link GamepadSource}. Decouples the poll site (the Web Gamepad API, or a test
 * stub) from the state machinery — the same reconciliation runs over any source.
 */
export interface GamepadSnapshot {
  readonly index: number;
  readonly id: string;
  /** `'standard'` when the browser mapped the pad to the Standard Gamepad layout. */
  readonly mapping: string;
  readonly connected: boolean;
  readonly buttons: readonly { readonly pressed: boolean; readonly value: number }[];
  readonly axes: readonly number[];
}

/**
 * Polls the current state of every connected gamepad. Gamepad state is only
 * available by polling (the Web Gamepad API has no button events), so this is a
 * poll source rather than the event-drain {@link InputBackend}.
 */
export interface GamepadSource {
  /** Snapshot every connected pad right now. Called once per frame. */
  poll(): readonly GamepadSnapshot[];
}

const EMPTY: readonly GamepadSnapshot[] = Object.freeze([]);

/**
 * {@link GamepadSource} backed by the Web Gamepad API. Reads
 * `navigator.getGamepads()` fresh on every poll (never caches a pad reference,
 * as the spec requires) and copies each pad into a {@link GamepadSnapshot}.
 * Returns empty when no gamepad-capable `navigator` is present, so it is safe to
 * install unconditionally.
 */
export class NavigatorGamepadSource implements GamepadSource {
  poll(): readonly GamepadSnapshot[] {
    const nav = typeof navigator !== 'undefined' ? navigator : undefined;
    if (nav === undefined || typeof nav.getGamepads !== 'function') return EMPTY;
    const out: GamepadSnapshot[] = [];
    for (const pad of nav.getGamepads()) {
      if (pad === null) continue;
      out.push({
        index: pad.index,
        id: pad.id,
        mapping: pad.mapping,
        connected: pad.connected,
        buttons: pad.buttons.map((b) => ({ pressed: b.pressed, value: b.value })),
        axes: [...pad.axes],
      });
    }
    return out;
  }
}

/** No-op {@link GamepadSource} for headless environments; polls nothing. */
export class HeadlessGamepadSource implements GamepadSource {
  poll(): readonly GamepadSnapshot[] {
    return EMPTY;
  }
}
