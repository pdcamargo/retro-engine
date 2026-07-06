// UI picking hot path (ADR-0154, in-game UI interaction):
//
// - Each frame the interaction system hit-tests the cursor against every
//   interactive node to find the topmost hit. Cost scales with the number of
//   Interactable nodes. This bench runs that hit-test over a menu-sized set.
//
// See docs/adr/ADR-0017 (bench schema) and docs/adr/ADR-0150 (UI architecture).

import { bench, summary } from 'mitata';

import { ComputedLayout } from '../src/ui-node';
import { type PickEntry, pickTopmost } from '../src/interaction/picking';

const buildEntries = (count: number): PickEntry[] => {
  const entries: PickEntry[] = [];
  for (let i = 0; i < count; i++) {
    const l = new ComputedLayout(10 + (i % 8) * 120, 10 + Math.floor(i / 8) * 44, 110, 40);
    l.order = i;
    entries.push({ entity: i as never, layout: l });
  }
  return entries;
};

summary(() => {
  for (const count of [16, 128]) {
    const entries = buildEntries(count);
    // A point inside the last (topmost) node, forcing a full scan.
    const last = entries[count - 1]!.layout;
    const x = last.x + 5;
    const y = last.y + 5;
    bench(`pickTopmost ${count} nodes`, () => {
      pickTopmost(entries, x, y);
    });
  }
});
