import type { App } from '@retro-engine/engine';
import { type Schema, t } from '@retro-engine/reflect';

import { DiagnosticsText } from './diagnostics-overlay';
import { Focusable } from './focus/ui-focus';
import { UiCamera } from './ui-camera';
import { Disabled, UiButton } from './interaction/ui-button';
import { Interactable } from './interaction/ui-interaction';
import { UiSlider } from './interaction/ui-slider';
import { UiTextInput } from './interaction/ui-text-input';
import { UiToggle } from './interaction/ui-toggle';
import { UiClass, uiClassSchema } from './rss-style';
import { UiImage } from './ui-image';
import { UiNode } from './ui-node';
import { uiImageSchema, uiNodeSchema, uiTextSchema } from './ui-plugin';
import { UiText } from './ui-text';

/**
 * Reflection schema for {@link UiButton}: the four background colors the button
 * paints in each interaction state. All authored, so all persist.
 */
export const uiButtonSchema: Schema<UiButton> = {
  normal: t.vec4,
  hovered: t.vec4,
  pressed: t.vec4,
  disabled: t.vec4,
};

/**
 * Reflection schema for {@link UiToggle}: the checked flag plus the on/off/disabled
 * background colors. All authored, so all persist.
 */
export const uiToggleSchema: Schema<UiToggle> = {
  checked: t.boolean,
  on: t.vec4,
  off: t.vec4,
  disabled: t.vec4,
};

/**
 * Reflection schema for {@link UiSlider}: the current value and its inclusive
 * range. All authored, so all persist.
 */
export const uiSliderSchema: Schema<UiSlider> = {
  value: t.number,
  min: t.number,
  max: t.number,
};

/**
 * Reflection schema for {@link UiTextInput}: the edited string, its max length,
 * and the placeholder. The caret position is transient edit state, so it is not
 * persisted.
 */
export const uiTextInputSchema: Schema<UiTextInput> = {
  value: t.string,
  maxLength: t.number,
  placeholder: t.string,
  cursor: t.number.skip(),
};

/**
 * Register the reflection schemas for every UI component — layout nodes, text and
 * images, style classes, and the interaction widgets (button, toggle, slider,
 * text input) plus the marker components (interactable, disabled, focusable,
 * diagnostics text) — against the App's type registry, without installing any UI
 * systems.
 *
 * The individual UI plugins ({@link import('./ui-plugin').UiPlugin} and the
 * interaction / focus / diagnostics plugins) register their own components in
 * `build`; tools that need the full UI component palette available for authoring
 * or serialization (e.g. an editor's component picker) can call this to register
 * every UI type at once without adding the systems that drive them.
 */
export const registerUiComponents = (app: App): void => {
  app.registerComponent(UiNode, uiNodeSchema, { name: 'UiNode', make: () => new UiNode() });
  app.registerComponent(UiText, uiTextSchema, { name: 'UiText', make: () => new UiText() });
  app.registerComponent(UiImage, uiImageSchema, { name: 'UiImage', make: () => new UiImage() });
  app.registerComponent(UiClass, uiClassSchema, { name: 'UiClass', make: () => new UiClass() });

  app.registerComponent(Interactable, {}, { name: 'Interactable', make: () => new Interactable() });
  app.registerComponent(Disabled, {}, { name: 'Disabled', make: () => new Disabled() });
  app.registerComponent(UiButton, uiButtonSchema, { name: 'UiButton', make: () => new UiButton() });
  app.registerComponent(UiToggle, uiToggleSchema, { name: 'UiToggle', make: () => new UiToggle() });
  app.registerComponent(UiSlider, uiSliderSchema, { name: 'UiSlider', make: () => new UiSlider() });
  app.registerComponent(UiTextInput, uiTextInputSchema, { name: 'UiTextInput', make: () => new UiTextInput() });

  app.registerComponent(Focusable, {}, { name: 'Focusable', make: () => new Focusable() });
  app.registerComponent(DiagnosticsText, {}, { name: 'DiagnosticsText', make: () => new DiagnosticsText() });

  // Marker: opts a camera into hosting the UI (renders the UI into that camera's
  // target). Authored on a camera entity, so it round-trips with the scene.
  app.registerComponent(UiCamera, {}, { name: 'UiCamera', make: () => new UiCamera() });
};
