import type { Entity } from '@retro-engine/ecs';
import { type Vec4, vec4 } from '@retro-engine/math';

import { UiNode } from '../ui-node';

import { Interactable } from './ui-interaction';

/** Initializer for {@link UiToggle}; omitted fields take the defaults below. */
export interface UiToggleOptions {
  /** Initial checked state. Default `false`. */
  checked?: boolean;
  /** Background while checked (on). */
  on?: Vec4;
  /** Background while unchecked (off). */
  off?: Vec4;
  /** Background while {@link Disabled}. */
  disabled?: Vec4;
}

/**
 * A two-state toggle / checkbox. A built-in system flips {@link UiToggle.checked}
 * each time the node is clicked (emitting {@link UiToggled}), and drives the
 * node's `backgroundColor` from `checked` (and {@link Disabled}). Authored +
 * reflection-registered; adding it auto-attaches the {@link Interactable}
 * machinery (and thus a {@link UiNode}).
 *
 * Read the state directly (`toggle.checked`) or react to changes with
 * `MessageReader(UiToggled)`.
 */
export class UiToggle {
  checked: boolean;
  on: Vec4;
  off: Vec4;
  disabled: Vec4;

  constructor(options: UiToggleOptions = {}) {
    this.checked = options.checked ?? false;
    this.on = options.on ?? vec4.create(0.32, 0.6, 0.38, 1);
    this.off = options.off ?? vec4.create(0.26, 0.28, 0.34, 1);
    this.disabled = options.disabled ?? vec4.create(0.18, 0.19, 0.24, 1);
  }

  static readonly requires = [UiNode, Interactable];
}

/**
 * Emitted when a {@link UiToggle}'s `checked` state flips from a click, carrying
 * the entity and its new value. Read with `MessageReader(UiToggled)`.
 */
export class UiToggled {
  constructor(
    public readonly entity: Entity,
    public readonly checked: boolean,
  ) {}
}

/**
 * Flip the {@link UiToggle} on each clicked entity that has one and is not
 * disabled, emitting a {@link UiToggled} for each. Pure over its inputs (no ECS
 * query/command types) so it unit-tests directly; the toggle system is its only
 * caller in an App.
 *
 * @internal
 */
export const applyToggleClicks = (
  clicked: Iterable<Entity>,
  getToggle: (entity: Entity) => UiToggle | undefined,
  isDisabled: (entity: Entity) => boolean,
  markChanged: (entity: Entity) => void,
  emit: (toggled: UiToggled) => void,
): void => {
  for (const entity of clicked) {
    const toggle = getToggle(entity);
    if (toggle === undefined || isDisabled(entity)) continue;
    toggle.checked = !toggle.checked;
    markChanged(entity);
    emit(new UiToggled(entity, toggle.checked));
  }
};
