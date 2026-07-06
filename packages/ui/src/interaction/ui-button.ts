import { type Vec4, vec4 } from '@retro-engine/math';

import { UiNode } from '../ui-node';

import { Interactable } from './ui-interaction';

/** Initializer for {@link UiButton}; omitted colors take the defaults below. */
export interface UiButtonOptions {
  /** Background at rest. */
  normal?: Vec4;
  /** Background while the pointer is over the button. */
  hovered?: Vec4;
  /** Background while the button is held down. */
  pressed?: Vec4;
  /** Background while {@link Disabled}. */
  disabled?: Vec4;
}

/**
 * A clickable button's background palette. A built-in system drives the node's
 * `backgroundColor` from these by the node's {@link UiInteraction} state (and
 * {@link Disabled}). Authored + reflection-registered; adding it auto-attaches
 * the {@link Interactable} machinery (and thus a {@link UiNode}).
 *
 * Pair with a `UiText` child/self for a label and read `UiClicked` to react.
 */
export class UiButton {
  normal: Vec4;
  hovered: Vec4;
  pressed: Vec4;
  disabled: Vec4;

  constructor(options: UiButtonOptions = {}) {
    this.normal = options.normal ?? vec4.create(0.24, 0.28, 0.42, 1);
    this.hovered = options.hovered ?? vec4.create(0.34, 0.4, 0.6, 1);
    this.pressed = options.pressed ?? vec4.create(0.16, 0.19, 0.3, 1);
    this.disabled = options.disabled ?? vec4.create(0.18, 0.19, 0.24, 1);
  }

  static readonly requires = [UiNode, Interactable];
}

/**
 * Marks an interactive node as disabled: the picking system ignores it (no
 * hover/press/click) and widget styling shows its disabled look. Authored
 * marker (a pseudo-class-style flag), reflection-registered.
 */
export class Disabled {}
