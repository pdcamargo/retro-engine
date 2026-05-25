import { describe, expect, it } from 'bun:test';

import { buildCore2dSubGraph } from './core-2d';
import { OpaquePass2dLabel } from './opaque-pass-2d-node';
import { TransparentPass2dLabel } from './transparent-pass-2d-node';

describe('buildCore2dSubGraph', () => {
  it('contains exactly the opaque + transparent 2D phase nodes', () => {
    const sub = buildCore2dSubGraph();
    sub.freeze();
    const ordered = sub.orderedNodes()!;
    expect(ordered.map((n) => n.label)).toEqual([
      OpaquePass2dLabel,
      TransparentPass2dLabel,
    ]);
  });

  it('orders opaque before transparent (edge is enforced through topo sort)', () => {
    const sub = buildCore2dSubGraph();
    sub.freeze();
    const ordered = sub.orderedNodes()!;
    const opaqueIdx = ordered.findIndex((n) => n.label === OpaquePass2dLabel);
    const transparentIdx = ordered.findIndex((n) => n.label === TransparentPass2dLabel);
    expect(opaqueIdx).toBeLessThan(transparentIdx);
  });
});
