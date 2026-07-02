/**
 * Which edge of a node a connector docks on, and the geometry helpers that go
 * with it. Sides drive both where a pin's anchor sits (see `layout-cache`) and how
 * an edge leaves/enters a node — a wire exits along its side's outward normal so
 * curves read cleanly regardless of which edges they connect.
 */

import type { Point } from './document';

/** A node edge a connector can dock on. */
export type Side = 'left' | 'right' | 'top' | 'bottom';

/**
 * A configured docking side, or `'auto'` to choose the side facing the connected
 * node at draw time (see {@link autoSides}). Only meaningful for edges that attach
 * to a node's edge rather than a fixed pin.
 */
export type PortSide = Side | 'auto';

/** The outward unit normal of a side (points away from the node body). */
export const sideNormal = (side: Side): Point => {
  switch (side) {
    case 'left':
      return [-1, 0];
    case 'right':
      return [1, 0];
    case 'top':
      return [0, -1];
    case 'bottom':
      return [0, 1];
  }
};

/** The side directly across the node from `side`. */
export const oppositeSide = (side: Side): Side => {
  switch (side) {
    case 'left':
      return 'right';
    case 'right':
      return 'left';
    case 'top':
      return 'bottom';
    case 'bottom':
      return 'top';
  }
};

/** A node's world rectangle `{ x, y, w, h }` for side math. */
export interface SideRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Pick the side of each node that faces the other, so a connecting wire leaves and
 * enters the nearest edges. Compares centers: the dominant axis (larger center
 * delta) decides horizontal (`left`/`right`) vs vertical (`top`/`bottom`) docking.
 */
export const autoSides = (a: SideRect, b: SideRect): { from: Side; to: Side } => {
  const acx = a.x + a.w / 2;
  const acy = a.y + a.h / 2;
  const bcx = b.x + b.w / 2;
  const bcy = b.y + b.h / 2;
  const dx = bcx - acx;
  const dy = bcy - acy;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { from: 'right', to: 'left' } : { from: 'left', to: 'right' };
  }
  return dy >= 0 ? { from: 'bottom', to: 'top' } : { from: 'top', to: 'bottom' };
};

/** The world-space midpoint of a node's given side. */
export const sideMidpoint = (rect: SideRect, side: Side): Point => {
  switch (side) {
    case 'left':
      return [rect.x, rect.y + rect.h / 2];
    case 'right':
      return [rect.x + rect.w, rect.y + rect.h / 2];
    case 'top':
      return [rect.x + rect.w / 2, rect.y];
    case 'bottom':
      return [rect.x + rect.w / 2, rect.y + rect.h];
  }
};
