import type { Entity } from '@retro-engine/ecs';

import { UiNode } from '../ui-node';

import { Interactable } from './ui-interaction';

/** Initializer for {@link UiSlider}; omitted fields take the defaults below. */
export interface UiSliderOptions {
  /** Initial value; clamped into `[min, max]`. Default `0`. */
  value?: number;
  /** Lower bound. Default `0`. */
  min?: number;
  /** Upper bound. Default `1`. */
  max?: number;
}

/**
 * A draggable scalar in `[min, max]`. A built-in system updates
 * {@link UiSlider.value} from the pointer's horizontal position across the
 * node's track while the slider is held, emitting {@link UiSliderChanged} on
 * change. Authored + reflection-registered; adding it auto-attaches the
 * {@link Interactable} machinery (and thus a {@link UiNode}).
 *
 * The value is the feature — read it (`slider.value`) or subscribe with
 * `MessageReader(UiSliderChanged)`. Visual fill is composed by the game (bind a
 * child node's width to `value`); the widget owns the value, not the artwork.
 */
export class UiSlider {
  value: number;
  min: number;
  max: number;

  constructor(options: UiSliderOptions = {}) {
    this.min = options.min ?? 0;
    this.max = options.max ?? 1;
    const v = options.value ?? 0;
    this.value = v < this.min ? this.min : v > this.max ? this.max : v;
  }

  static readonly requires = [UiNode, Interactable];
}

/**
 * Emitted when a {@link UiSlider}'s `value` changes from a drag, carrying the
 * entity and its new value. Read with `MessageReader(UiSliderChanged)`.
 */
export class UiSliderChanged {
  constructor(
    public readonly entity: Entity,
    public readonly value: number,
  ) {}
}

/**
 * Map a cursor x-position across a horizontal track `[trackX, trackX+trackWidth]`
 * to a value in `[min, max]`, clamped to the ends. A non-positive `trackWidth`
 * (an unlaid-out track) yields `min`. Pure — the slider drag system's only logic,
 * unit-tested directly.
 *
 * @internal
 */
export const computeSliderValue = (
  cursorX: number,
  trackX: number,
  trackWidth: number,
  min: number,
  max: number,
): number => {
  if (trackWidth <= 0) return min;
  const t = (cursorX - trackX) / trackWidth;
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  return min + clamped * (max - min);
};
