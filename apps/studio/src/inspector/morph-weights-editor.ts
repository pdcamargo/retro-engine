import { type ComponentEditor, labelColumnWidth, labeledRow } from '@retro-engine/editor-sdk';

/**
 * Inspector editor for the engine's `MorphWeights` component: one `[0, 1]` slider
 * per morph target, labelled by the target's name, instead of the default pair of
 * raw `names` / `weights` arrays. Each slider scrubs the matching `weights[i]`
 * through the edit boundary, so changes route through undo and the live mesh
 * deforms as you drag.
 *
 * Registered by stable name (`'MorphWeights'`), so the studio needs no compile
 * dependency on the engine class.
 */
export const morphWeightsEditor: ComponentEditor = (ctx) => {
  const mw = ctx.instance as { names?: string[]; weights?: number[] };
  const names = mw.names ?? [];
  const weights = mw.weights ?? [];
  if (weights.length === 0) {
    ctx.ui.textDisabled('No morph targets.');
    return;
  }

  const labels = weights.map((_w, i) => names[i] ?? `Target ${i}`);
  const labelWidth = labelColumnWidth(ctx.ui, labels);

  for (let i = 0; i < weights.length; i++) {
    const edit = ctx.edit.scalar([{ kind: 'field', name: 'weights' }, { kind: 'index', index: i }], weights[i] ?? 0);
    labeledRow(ctx.ui, labels[i]!, labelWidth, () => {
      ctx.ui.withDisabled(ctx.readonly, () => {
        const next = ctx.widgets.slider(`##morph-${i}`, edit.value, { min: 0, max: 1 });
        if (ctx.readonly) return;
        edit.preview(next);
        edit.sync(ctx.ui.itemEdges());
      });
    });
  }
};
