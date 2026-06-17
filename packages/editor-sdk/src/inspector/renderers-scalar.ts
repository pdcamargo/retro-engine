import type { PropertyRenderer } from './property-types';
import { pick, propertyRow, scrub } from './renderers-support';

/** A number: a slider when the field carries a `[min, max]` range, else a scrub field. */
export const numberRenderer: PropertyRenderer = (ctx) => {
  const value = ctx.value as number;
  propertyRow(ctx, () => {
    const range = ctx.meta.range;
    if (range !== undefined) {
      scrub(ctx, ctx.path, value, (v) => ctx.widgets.slider(ctx.id, v, { min: range[0], max: range[1] }));
    } else {
      scrub(ctx, ctx.path, value, (v) => ctx.widgets.dragNumber(ctx.id, v, { step: 0.1 }));
    }
  });
};

/** A single-line text field. */
export const stringRenderer: PropertyRenderer = (ctx) => {
  const value = ctx.value as string;
  propertyRow(ctx, () => {
    scrub(ctx, ctx.path, value, (v) => ctx.ui.inputText(`##${ctx.id}`, v));
  });
};

/** A boolean toggle switch. */
export const booleanRenderer: PropertyRenderer = (ctx) => {
  const value = ctx.value as boolean;
  propertyRow(ctx, () => {
    pick(ctx, ctx.path, value, (v) => ctx.widgets.switchToggle(ctx.id, v));
  });
};

/** A string-literal enum as a dropdown of its allowed values. */
export const enumRenderer: PropertyRenderer = (ctx) => {
  const value = String(ctx.value);
  const options = (ctx.type.enumValues ?? []).map((v) => ({ value: String(v) }));
  propertyRow(ctx, () => {
    pick(ctx, ctx.path, value, (v) => ctx.widgets.combo(ctx.id, v, options));
  });
};
