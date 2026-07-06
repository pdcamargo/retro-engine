// FlexLayoutEngine compute hot path (ADR-0150, in-game UI):
//
// - The UI layout system recomputes the flex tree whenever a node's style or the
//   hierarchy changes. Cost scales with node count. This bench lays out a
//   realistic HUD-ish tree (a column of rows, each row a mix of grow/fixed
//   items) so a regression in the flex resolution shows up here.
//
// See docs/adr/ADR-0017 (bench schema) and docs/adr/ADR-0150 (UI architecture).

import { bench, summary } from 'mitata';

import { FlexLayoutEngine } from '../src/flex-layout';
import type { LayoutNode } from '../src/layout-engine';
import { makeStyle } from '../src/ui-style';

const ROWS = 30;
const COLS = 8;

const buildTree = (): LayoutNode => {
  const rows: LayoutNode[] = [];
  for (let r = 0; r < ROWS; r++) {
    const cols: LayoutNode[] = [];
    for (let c = 0; c < COLS; c++) {
      cols.push({
        style: makeStyle(
          c % 3 === 0
            ? { flexGrow: 1, minWidth: 40, margin: 2 }
            : { width: 60, height: 24, margin: 2 },
        ),
        children: [],
      });
    }
    rows.push({
      style: makeStyle({ height: 32, gap: 4, alignItems: 'center' }),
      children: cols,
    });
  }
  return {
    style: makeStyle({ width: 1280, height: 720, flexDirection: 'column', padding: 16, gap: 8 }),
    children: rows,
  };
};

const engine = new FlexLayoutEngine();
const tree = buildTree();

summary(() => {
  bench(`FlexLayoutEngine.compute: ${ROWS}×${COLS} grid (${ROWS * COLS + ROWS + 1} nodes)`, () => {
    engine.compute(tree, { width: 1280, height: 720 });
  });
});
