// `.rss` style-resolution hot path (ADR-0150, in-game UI "Retro CSS"):
//
// - The UI style system re-resolves every `UiClass` node against the active
//   stylesheet every frame (so hover/press/disable state changes reflow the same
//   frame). Cost scales with node count × stylesheet size — each node filters the
//   rules, sorts the matches by specificity, and maps the winning declarations.
//   This bench resolves a HUD-ish batch of nodes against a realistic sheet so a
//   regression in the cascade / declaration mapping shows up here.
//
// See docs/adr/ADR-0017 (bench schema) and docs/adr/ADR-0150 (UI architecture).

import { bench, summary } from 'mitata';

import { parseRss } from '../src/rss-parser';
import { resolveUiStyle, type StyleNode } from '../src/rss-resolve';

const RULES = parseRss(`
  * { margin: 0; }
  Panel { flex-direction: column; padding: 8; gap: 4; background-color: #14161f; }
  .row { flex-direction: row; gap: 6; height: 28; }
  .cell { flex-grow: 1; min-width: 40; padding: 4; background-color: #1c2230; }
  .cell:hovered { background-color: #2a3550; }
  .cell:pressed { background-color: #3a4a70; }
  .cell:disabled { background-color: #101216; }
  .label { flex-grow: 1; padding-left: 6; }
  .badge { width: 48; height: 20; border: 2 solid #556; background-color: #ff8c1a; }
  #hud-root { width: 1280; height: 720; padding: 16; }
`);

// One frame's worth of nodes: a root, rows, and a grid of cells in varied states.
const ROWS = 24;
const COLS = 8;
const NODES: StyleNode[] = [{ name: 'hud-root', classes: [], states: [] }];
for (let r = 0; r < ROWS; r++) {
  NODES.push({ type: 'Panel', classes: ['row'], states: [] });
  for (let c = 0; c < COLS; c++) {
    const states = c % 5 === 0 ? ['hovered'] : c % 7 === 0 ? ['pressed', 'hovered'] : [];
    NODES.push({ classes: c % 3 === 0 ? ['cell', 'badge'] : ['cell', 'label'], states });
  }
}

summary(() => {
  bench(`resolveUiStyle: ${NODES.length} nodes × ${RULES.length} rules (one frame)`, () => {
    for (const node of NODES) resolveUiStyle(RULES, node);
  });
});
