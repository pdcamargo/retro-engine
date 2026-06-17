import { humanize } from './amendments';
import type { PropertyRenderer } from './property-types';
import { labelColumnWidth, propertyRow } from './renderers-support';

/** An entity reference, shown read-only as its id (a picker is a later slice). */
export const entityRenderer: PropertyRenderer = (ctx) => {
  propertyRow(ctx, () => ctx.ui.textDisabled(`Entity #${String(ctx.value)}`));
};

/** An asset handle, shown read-only by its store name (a picker is a later slice). */
export const handleRenderer: PropertyRenderer = (ctx) => {
  const asset = ctx.type.assetType ?? 'asset';
  propertyRow(ctx, () =>
    ctx.ui.textDisabled(ctx.value === undefined || ctx.value === null ? `(no ${asset})` : `${asset} handle`),
  );
};

/** A nested registered type: walk its reflected fields under an indented section. */
export const typeRenderer: PropertyRenderer = (ctx) => {
  const nested = ctx.type.nestedCtor !== undefined ? ctx.reflect.getByCtor(ctx.type.nestedCtor) : undefined;
  if (nested === undefined || typeof ctx.value !== 'object') {
    propertyRow(ctx, () => ctx.ui.textDisabled('(unregistered type)'));
    return;
  }
  const obj = ctx.value as Record<string, unknown>;
  const labelWidth = labelColumnWidth(ctx.ui, nested.fields.map(([name]) => humanize(name)));
  ctx.ui.textMuted(ctx.meta.label);
  ctx.ui.indent();
  for (const [name, ft] of nested.fields) {
    ctx.renderChild({ type: ft, value: obj[name], segment: { kind: 'field', name }, labelWidth });
  }
  ctx.ui.unindent();
};
