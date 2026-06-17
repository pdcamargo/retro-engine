import type { FieldType } from '@retro-engine/reflect';

import { humanize } from './amendments';
import type { PropertyRenderer } from './property-types';
import { defaultValueFor } from './renderers-bridge';
import { labelColumnWidth, propertyRow } from './renderers-support';

/** A nested struct: an indented section of its fields. */
export const structRenderer: PropertyRenderer = (ctx) => {
  const obj = (ctx.value ?? {}) as Record<string, unknown>;
  const fields = Object.entries(ctx.type.fields ?? {});
  const labelWidth = labelColumnWidth(ctx.ui, fields.map(([name]) => humanize(name)));
  ctx.ui.textMuted(ctx.meta.label);
  ctx.ui.indent();
  for (const [name, ft] of fields) {
    ctx.renderChild({ type: ft, value: obj[name], segment: { kind: 'field', name }, labelWidth });
  }
  ctx.ui.unindent();
};

/** A homogeneous array: an indented, element-by-element list. */
export const arrayRenderer: PropertyRenderer = (ctx) => {
  const arr = (ctx.value ?? []) as unknown[];
  const element = ctx.type.element;
  ctx.ui.textMuted(`${ctx.meta.label}  (${String(arr.length)})`);
  if (element === undefined) return;
  const labelWidth = labelColumnWidth(ctx.ui, [`[${String(Math.max(0, arr.length - 1))}]`]);
  ctx.ui.indent();
  for (let i = 0; i < arr.length; i++) {
    ctx.renderChild({ type: element, value: arr[i], segment: { kind: 'index', index: i }, label: `[${String(i)}]`, labelWidth });
  }
  ctx.ui.unindent();
};

/** A fixed-length tuple: an indented, positional list. */
export const tupleRenderer: PropertyRenderer = (ctx) => {
  const arr = (ctx.value ?? []) as unknown[];
  const elements = ctx.type.elements ?? [];
  const labelWidth = labelColumnWidth(ctx.ui, [`[${String(Math.max(0, elements.length - 1))}]`]);
  ctx.ui.textMuted(ctx.meta.label);
  ctx.ui.indent();
  for (let i = 0; i < elements.length; i++) {
    ctx.renderChild({ type: elements[i]!, value: arr[i], segment: { kind: 'index', index: i }, label: `[${String(i)}]`, labelWidth });
  }
  ctx.ui.unindent();
};

const buildArm = (ft: FieldType<unknown>, arm: string): unknown => {
  const schema = ft.variants?.[arm] ?? {};
  const entries = Object.entries(schema);
  if (ft.variantStringArms) {
    if (entries.length === 0) return arm;
    const out: Record<string, unknown> = {};
    for (const [key, sub] of entries) out[key] = defaultValueFor(sub);
    return out;
  }
  const out: Record<string, unknown> = { [ft.variantTag ?? 'kind']: arm };
  for (const [key, sub] of entries) out[key] = defaultValueFor(sub);
  return out;
};

/**
 * A discriminated union: an arm selector plus the active arm's payload fields.
 * Switching arms commits a freshly-defaulted value for the new arm; the payload
 * fields recurse through the dispatcher.
 */
export const variantRenderer: PropertyRenderer = (ctx) => {
  const ft = ctx.type;
  const arms = Object.keys(ft.variants ?? {});
  const tag = ft.variantTag ?? 'kind';

  let currentArm: string;
  let payload: Record<string, unknown> | undefined;
  if (ft.variantStringArms) {
    if (typeof ctx.value === 'string') {
      currentArm = ctx.value;
      payload = undefined;
    } else {
      payload = (ctx.value ?? {}) as Record<string, unknown>;
      currentArm = arms.find((a) => Object.keys(ft.variants?.[a] ?? {}).length > 0) ?? arms[0] ?? '';
    }
  } else {
    payload = (ctx.value ?? {}) as Record<string, unknown>;
    currentArm = String(payload[tag] ?? arms[0] ?? '');
  }

  propertyRow(ctx, () => {
    const edit = ctx.edit.scalar(ctx.path, ctx.value);
    ctx.ui.withDisabled(ctx.readonly, () => {
      const next = ctx.widgets.combo(
        `${ctx.id}-arm`,
        currentArm,
        arms.map((a) => ({ value: a })),
      );
      if (!ctx.readonly && next !== currentArm) edit.commit(buildArm(ft, next));
    });
  });

  const entries = Object.entries(ft.variants?.[currentArm] ?? {});
  if (entries.length === 0 || payload === undefined) return;
  const labelWidth = labelColumnWidth(ctx.ui, entries.map(([name]) => humanize(name)));
  ctx.ui.indent();
  for (const [name, sub] of entries) {
    ctx.renderChild({ type: sub, value: payload[name], segment: { kind: 'field', name }, labelWidth });
  }
  ctx.ui.unindent();
};
