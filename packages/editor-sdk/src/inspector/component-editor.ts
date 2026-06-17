import type { RegisteredType } from '@retro-engine/reflect';

import type { EditEmitter } from '../edit/emitter';
import type { Widgets } from '../components';
import type { Ui } from '../ui';

/**
 * What a {@link ComponentEditor} receives: the live instance, its registered
 * type (or `undefined` for a derived component with no schema), a read-only flag,
 * the edit boundary, and {@link field} — render one schema field through the full
 * property dispatcher, the escape hatch a custom editor uses to reuse the
 * baseline for fields it does not draw itself.
 */
export interface ComponentEditorContext {
  readonly ui: Ui;
  readonly widgets: Widgets;
  readonly instance: object;
  readonly registered: RegisteredType | undefined;
  readonly readonly: boolean;
  readonly edit: EditEmitter;
  /** Render one schema field by name through the dispatcher (resolution, amendments, recursion). */
  readonly field: (name: string) => void;
}

/**
 * Draws the inspector body for one component, replacing the default field walk.
 * Register one per component to customize its layout; it can still call
 * {@link ComponentEditorContext.field} to delegate individual fields to the
 * baseline renderers.
 */
export type ComponentEditor = (ctx: ComponentEditorContext) => void;

/**
 * The implicit editor when no custom one is registered: render every schema
 * field, in declaration order, through the property dispatcher.
 */
export const defaultComponentEditor: ComponentEditor = (ctx) => {
  if (ctx.registered === undefined) {
    ctx.ui.textDisabled('No serializable fields.');
    return;
  }
  for (const [name] of ctx.registered.fields) ctx.field(name);
};
