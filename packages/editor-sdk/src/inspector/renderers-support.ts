import type { FieldPath } from '../edit/field-path';
import type { Ui } from '../ui';
import type { PropertyContext } from './property-types';

/** Gap (px) between the end of the longest label and the control column. */
const ROW_GAP = 14;
/** Floor for the label column so very short labels don't cramp the control. */
const MIN_LABEL_W = 56;

/**
 * The label column width for a group of rows: the widest label plus a gap, so
 * every row in the group aligns and none overlaps its control. Measure once per
 * group (component body, nested struct) and thread it down as the label width.
 */
export const labelColumnWidth = (ui: Ui, labels: readonly string[]): number => {
  let widest = 0;
  for (const label of labels) widest = Math.max(widest, ui.calcTextSize(label)[0]);
  return Math.max(MIN_LABEL_W, Math.ceil(widest + ROW_GAP));
};

/**
 * An inspector row: a label, then a control column starting at `labelWidth`. The
 * column never starts before this label's own width plus a gap, so alignment is
 * uniform across the group while a stray long label still can't overlap.
 */
export const labeledRow = (ui: Ui, label: string, labelWidth: number, control: () => void): void => {
  ui.alignTextToFramePadding();
  ui.textMuted(label);
  const own = ui.calcTextSize(label)[0] + ROW_GAP;
  ui.sameLine(Math.max(labelWidth, own));
  ui.group(control);
};

/** {@link labeledRow} for a property: label and column width come from the context. */
export const propertyRow = (ctx: PropertyContext, control: () => void): void =>
  labeledRow(ctx.ui, ctx.meta.label, ctx.labelWidth, control);

/**
 * Wire a continuous-edit widget (drag, slider, text, color picker) at `path`:
 * draw it disabled when the field is read-only, apply the value live every
 * frame, and let the host coalesce the interaction into one undo step. `draw`
 * receives the current value and returns the widget's next value.
 */
export const scrub = <T>(ctx: PropertyContext, path: FieldPath, current: T, draw: (value: T) => T): void => {
  const edit = ctx.edit.scalar(path, current);
  ctx.ui.withDisabled(ctx.readonly, () => {
    const next = draw(edit.value);
    if (ctx.readonly) return;
    edit.preview(next);
    edit.sync(ctx.ui.itemEdges());
  });
};

/**
 * Wire an atomic-edit widget (checkbox, combo, radio) at `path`: draw it disabled
 * when read-only, and record a single undo step the frame its value changes.
 */
export const pick = <T>(ctx: PropertyContext, path: FieldPath, current: T, draw: (value: T) => T): void => {
  const edit = ctx.edit.scalar(path, current);
  ctx.ui.withDisabled(ctx.readonly, () => {
    const next = draw(edit.value);
    if (!ctx.readonly && !Object.is(next, edit.value)) edit.commit(next);
  });
};
