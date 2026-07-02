/**
 * Edge-type descriptors and their per-kind registry — the pluggable wire layer,
 * parallel to {@link NodeTypeRegistry} for nodes. An edge type declares how a class
 * of edge attaches to its nodes (typed pins vs. facing node edges), which curve it
 * follows, whether it carries arrowheads / a midpoint badge, and whether reciprocal
 * pairs collapse to a single double-arrow line. A {@link GraphEdge} references a
 * type by id via its `style` field (`undefined` = the kind's default data wire).
 */

import type { EdgePathFn } from './edge-path';
import type { EdgeRenderer } from './edge-render';
import type { PortSide } from './side';

/** How an edge attaches to its endpoints: to declared pins, or to the facing node edges. */
export type EdgeEndpoints = 'pins' | 'nodes';

/** Describes a class of edge: attachment, curve, decorations, and merge behavior. */
export interface EdgeTypeDescriptor {
  /** Unique type id within its owning kind (matched by {@link GraphEdge}'s `style`). */
  readonly type: string;
  /** Attachment model. Defaults to `'pins'`. */
  readonly endpoints?: EdgeEndpoints;
  /** Docking side(s) for `'nodes'` endpoints; `'auto'` faces the other node. Default `'auto'`. */
  readonly dock?: PortSide;
  /** Curve strategy: a built-in path id (`bezier`/`straight`/`orthogonal`) or a function. Default `bezier`. */
  readonly path?: string | EdgePathFn;
  /** Arrowheads at the wire's ends. Default: none for `'pins'`, `{ end: true }` for `'nodes'`. */
  readonly arrow?: { readonly start?: boolean; readonly end?: boolean };
  /** Collapse reciprocal `A→B` + `B→A` into one line with an arrowhead on each end. */
  readonly mergeReciprocal?: boolean;
  /** Draw a glyph/label badge at the wire midpoint (uses `GraphEdge.label`). */
  readonly badge?: boolean;
  /** Full render override; when absent the built-in renderer honors the fields above. */
  readonly render?: EdgeRenderer;
}

/** A per-kind registry of {@link EdgeTypeDescriptor}s, keyed by type id. */
export class EdgeTypeRegistry {
  private readonly byType = new Map<string, EdgeTypeDescriptor>();

  register(desc: EdgeTypeDescriptor): this {
    this.byType.set(desc.type, desc);
    return this;
  }

  get(type: string): EdgeTypeDescriptor | undefined {
    return this.byType.get(type);
  }

  has(type: string): boolean {
    return this.byType.has(type);
  }

  list(): readonly EdgeTypeDescriptor[] {
    return [...this.byType.values()];
  }
}

/**
 * The built-in edge types every environment seeds: `default` (a typed data/exec
 * wire between pins) and `transition` (a state-machine arrow between node edges,
 * auto-docked, straight, with reciprocal pairs merged). A kind may re-register
 * either id to override it.
 */
export const BUILTIN_EDGE_TYPES: readonly EdgeTypeDescriptor[] = [
  { type: 'default', endpoints: 'pins', path: 'bezier' },
  {
    type: 'transition',
    endpoints: 'nodes',
    dock: 'auto',
    path: 'straight',
    arrow: { end: true },
    mergeReciprocal: true,
    badge: true,
  },
];
