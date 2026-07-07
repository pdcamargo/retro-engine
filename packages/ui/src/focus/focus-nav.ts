import type { Entity } from '@retro-engine/ecs';

/** A focusable node reduced to what navigation needs: its id and layout box. */
export interface FocusNode {
  readonly entity: Entity;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A directional or sequential focus move. */
export type NavDirection = 'up' | 'down' | 'left' | 'right' | 'next' | 'prev';

const centerX = (n: FocusNode): number => n.x + n.width / 2;
const centerY = (n: FocusNode): number => n.y + n.height / 2;

/**
 * Sequential focus: the node after `current` in `ordered` (or before it, when
 * `reverse`), wrapping around the ends. With no current focus (or one not in the
 * list) returns the first node (or the last, when `reverse`). `null` only when
 * there is nothing focusable. `ordered` is assumed already in tab order.
 */
export const tabNavigate = (
  ordered: readonly FocusNode[],
  current: Entity | null,
  reverse: boolean,
): Entity | null => {
  if (ordered.length === 0) return null;
  const i = current === null ? -1 : ordered.findIndex((n) => n.entity === current);
  if (i === -1) return (reverse ? ordered[ordered.length - 1] : ordered[0])!.entity;
  const n = ordered.length;
  const next = reverse ? (i - 1 + n) % n : (i + 1) % n;
  return ordered[next]!.entity;
};

/**
 * Directional (spatial) focus: the nearest node from `current` in `direction`,
 * by a "distance along the axis + perpendicular penalty" cost so an aligned
 * neighbour wins over a skewed closer one. With no current focus, returns the
 * first node as an entry point. `null` when nothing lies in that direction (focus
 * should stay put). Only candidates strictly beyond `current`'s center on the
 * axis are considered.
 */
export const spatialNavigate = (
  nodes: readonly FocusNode[],
  current: Entity | null,
  direction: 'up' | 'down' | 'left' | 'right',
): Entity | null => {
  if (nodes.length === 0) return null;
  const from = current === null ? undefined : nodes.find((n) => n.entity === current);
  if (from === undefined) return nodes[0]!.entity;

  const fx = centerX(from);
  const fy = centerY(from);
  const horizontal = direction === 'left' || direction === 'right';
  const sign = direction === 'right' || direction === 'down' ? 1 : -1;

  let best: Entity | null = null;
  let bestCost = Infinity;
  for (const n of nodes) {
    if (n.entity === from.entity) continue;
    const primary = (horizontal ? centerX(n) - fx : centerY(n) - fy) * sign;
    if (primary <= 0) continue; // not in the requested direction
    const perp = Math.abs(horizontal ? centerY(n) - fy : centerX(n) - fx);
    const cost = primary + perp * 2;
    if (cost < bestCost) {
      bestCost = cost;
      best = n.entity;
    }
  }
  return best;
};
