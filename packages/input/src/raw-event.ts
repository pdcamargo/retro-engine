import type { MouseScrollUnit } from './mouse';

/**
 * A single platform-normalized input event queued by an {@link InputBackend}
 * and drained once per frame by `InputPlugin`. This is the narrow wire between
 * "how events are captured" (DOM, and later Tauri/test) and "how state is
 * updated" — keeping the plugin's per-frame logic identical across backends.
 *
 * Coordinates on `mouse-move` are in the backend's pointer-target-local pixel
 * space; `dx`/`dy` are the movement since the previous move event.
 */
export type RawInputEvent =
  | { readonly kind: 'key-down'; readonly code: string; readonly repeat: boolean }
  | { readonly kind: 'key-up'; readonly code: string }
  | { readonly kind: 'mouse-down'; readonly button: number }
  | { readonly kind: 'mouse-up'; readonly button: number }
  | {
      readonly kind: 'mouse-move';
      readonly x: number;
      readonly y: number;
      readonly dx: number;
      readonly dy: number;
      readonly present: boolean;
    }
  | { readonly kind: 'wheel'; readonly dx: number; readonly dy: number; readonly unit: MouseScrollUnit }
  /** Pointer left the target — clear `CursorPosition.present`. */
  | { readonly kind: 'cursor-leave' }
  /** Window/target lost focus — release all held buttons so none get stranded. */
  | { readonly kind: 'blur' };

/**
 * Captures platform input and exposes it as a per-frame queue of
 * {@link RawInputEvent}s. The renderer-style HAL for input: `InputPlugin`
 * depends only on this contract, so a DOM, Tauri, or test backend is
 * interchangeable.
 *
 * Lifecycle: {@link InputBackend.attach} begins capture (idempotent — safe to
 * call when already attached), {@link InputBackend.detach} stops it and drops
 * any queued events, and {@link InputBackend.drain} returns the events queued
 * since the previous drain and clears the queue.
 */
export interface InputBackend {
  /** Begin capturing input. Idempotent: a second call while attached is a no-op. */
  attach(): void;
  /** Stop capturing input and discard any queued events. Idempotent. */
  detach(): void;
  /** Return and clear the events queued since the last drain (oldest first). */
  drain(): readonly RawInputEvent[];
}
