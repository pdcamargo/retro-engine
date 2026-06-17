import type { PropertyRenderer } from './property-types';
import { propertyRow } from './renderers-support';

/** Fallback for a field whose kind has no registered renderer — a read-only note, never a throw. */
export const fallbackRenderer: PropertyRenderer = (ctx) => {
  propertyRow(ctx, () => ctx.ui.textDisabled(`‹${ctx.type.kind}›`));
};
