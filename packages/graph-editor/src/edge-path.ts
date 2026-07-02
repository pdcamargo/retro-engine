/**
 * Edge path strategies: the pluggable curve layer. A strategy maps two resolved
 * screen-space endpoints (each an attach point + the node side it leaves/enters)
 * and any ordered waypoints (reroute knots) to an {@link EdgeShape} — a list of
 * cubic bezier segments. A straight segment is a cubic with colinear controls, so
 * one drawing / hit-testing / tangent path serves every strategy.
 *
 * Consumers register their own {@link EdgePathFn} on the environment; the built-in
 * `bezier` / `straight` / `orthogonal` strategies are seeded there.
 */

import type { Draw } from '@retro-engine/editor-sdk';

import type { Point } from './document';
import { type Side, sideNormal } from './side';

/** A resolved edge endpoint in screen space: where it touches and which side it uses. */
export interface EndpointGeom {
  readonly pos: Point;
  readonly side: Side;
}

/** Everything a path strategy needs, in screen space. */
export interface EdgePathInput {
  readonly from: EndpointGeom;
  readonly to: EndpointGeom;
  /** Ordered reroute knots the wire threads through, source→target. */
  readonly waypoints: readonly Point[];
  readonly zoom: number;
}

/** One cubic bezier segment `[p0, c1, c2, p3]` in screen space. */
export type CubicSegment = readonly [Point, Point, Point, Point];

/** A drawable/hit-testable edge: an ordered chain of cubic segments, source→target. */
export interface EdgeShape {
  readonly segments: readonly CubicSegment[];
}

/** Maps endpoints + waypoints to a concrete {@link EdgeShape}. */
export type EdgePathFn = (input: EdgePathInput) => EdgeShape;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Tangent-handle length between two screen points at a given zoom (curve stiffness). */
const handleLen = (ax: number, ay: number, bx: number, by: number, zoom: number): number =>
  clamp(Math.hypot(bx - ax, by - ay) * 0.4, 26 * zoom, 150 * zoom);

const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const norm = (v: Point): Point => {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
};

/** Straight cubic segments through the point chain (colinear controls). */
const polylineToShape = (pts: readonly Point[]): EdgeShape => {
  const segments: CubicSegment[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const c1: Point = [a[0] + (b[0] - a[0]) / 3, a[1] + (b[1] - a[1]) / 3];
    const c2: Point = [a[0] + (2 * (b[0] - a[0])) / 3, a[1] + (2 * (b[1] - a[1])) / 3];
    segments.push([a, c1, c2, b]);
  }
  return { segments };
};

/** Straight lines source→(waypoints)→target. Tangents follow each chord. */
export const straightPath: EdgePathFn = ({ from, to, waypoints }) =>
  polylineToShape([from.pos, ...waypoints, to.pos]);

/**
 * Smooth cubics that exit/enter along each endpoint's side normal (horizontal for
 * left/right, vertical for top/bottom), threading any waypoints. This is the
 * signature node-graph wire; interior knots use their travel tangent so the curve
 * visibly bends through them.
 */
export const bezierPath: EdgePathFn = ({ from, to, waypoints, zoom }) => {
  const pts = [from.pos, ...waypoints, to.pos];
  // Forward unit tangent (direction of travel, source→target) at each point.
  const tan: Point[] = pts.map((_pt, i) => {
    if (i === 0) return sideNormal(from.side); // exit outward
    if (i === pts.length - 1) {
      const n = sideNormal(to.side);
      return [-n[0], -n[1]]; // approach the target from outside → travel is inward
    }
    return norm(sub(pts[i + 1]!, pts[i - 1]!));
  });
  const segments: CubicSegment[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const k = handleLen(a[0], a[1], b[0], b[1], zoom);
    const ta = tan[i - 1]!;
    const tb = tan[i]!;
    segments.push([a, [a[0] + ta[0] * k, a[1] + ta[1] * k], [b[0] - tb[0] * k, b[1] - tb[1] * k], b]);
  }
  return { segments };
};

/** Axis-aligned stepped routing: a short stub off each side, then a mid-split corner. */
export const orthogonalPath: EdgePathFn = ({ from, to, waypoints, zoom }) => {
  const stub = 18 * zoom;
  const fn = sideNormal(from.side);
  const tn = sideNormal(to.side);
  const s1: Point = [from.pos[0] + fn[0] * stub, from.pos[1] + fn[1] * stub];
  const e1: Point = [to.pos[0] + tn[0] * stub, to.pos[1] + tn[1] * stub];
  const chain: Point[] = [from.pos, s1];
  const mids = [...waypoints, e1];
  let prev = s1;
  for (const m of mids) {
    // Corner between prev and m: step along the axis of prev's exit first.
    const horizFirst = from.side === 'left' || from.side === 'right';
    chain.push(horizFirst ? [m[0], prev[1]] : [prev[0], m[1]]);
    chain.push(m);
    prev = m;
  }
  chain.push(to.pos);
  return polylineToShape(chain);
};

const cubicAt = (s: CubicSegment, t: number): Point => {
  const u = 1 - t;
  const w0 = u * u * u;
  const w1 = 3 * u * u * t;
  const w2 = 3 * u * t * t;
  const w3 = t * t * t;
  return [
    w0 * s[0][0] + w1 * s[1][0] + w2 * s[2][0] + w3 * s[3][0],
    w0 * s[0][1] + w1 * s[1][1] + w2 * s[2][1] + w3 * s[3][1],
  ];
};

/** Draw every segment of a shape to the draw list. */
export const drawEdgeShape = (draw: Draw, shape: EdgeShape, col: number, thickness: number): void => {
  for (const s of shape.segments) draw.bezierCubic(s[0], s[1], s[2], s[3], col, thickness);
};

const distToSeg2 = (px: number, py: number, ax: number, ay: number, bx: number, by: number): number => {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return (px - cx) ** 2 + (py - cy) ** 2;
};

/** Minimum distance from a point to a shape, by sampling each cubic into a polyline. */
export const edgeShapeDistance = (shape: EdgeShape, px: number, py: number, samples = 14): number => {
  let best = Infinity;
  for (const s of shape.segments) {
    let prev = s[0];
    for (let i = 1; i <= samples; i++) {
      const p = cubicAt(s, i / samples);
      const d = distToSeg2(px, py, prev[0], prev[1], p[0], p[1]);
      if (d < best) best = d;
      prev = p;
    }
  }
  return Math.sqrt(best);
};

/** The shape's visual midpoint (middle of its middle segment) — the badge anchor. */
export const edgeShapeMidpoint = (shape: EdgeShape): Point => {
  const n = shape.segments.length;
  if (n === 0) return [0, 0];
  return cubicAt(shape.segments[Math.floor((n - 1) / 2)]!, 0.5);
};

/** Unit travel tangents at the shape's start (source) and end (target). */
export const edgeShapeTangents = (shape: EdgeShape): { start: Point; end: Point } => {
  const n = shape.segments.length;
  if (n === 0) return { start: [1, 0], end: [1, 0] };
  const first = shape.segments[0]!;
  const last = shape.segments[n - 1]!;
  const startRaw = sub(first[1], first[0]);
  const endRaw = sub(last[3], last[2]);
  const startFallback = sub(first[3], first[0]);
  const endFallback = sub(last[3], last[0]);
  return {
    start: norm(Math.hypot(startRaw[0], startRaw[1]) > 0.01 ? startRaw : startFallback),
    end: norm(Math.hypot(endRaw[0], endRaw[1]) > 0.01 ? endRaw : endFallback),
  };
};
