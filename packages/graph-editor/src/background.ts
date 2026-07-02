/**
 * Canvas background strategies: the pluggable backdrop layer. A renderer paints the
 * region behind wires and nodes each frame, phased to the view's pan so the pattern
 * tracks content. Built-ins (`grid` / `dots` / `lines` / `none`) are seeded on the
 * environment; consumers register their own for a bespoke canvas.
 */

import type { Draw, Vec2 } from '@retro-engine/editor-sdk';

import type { GraphTheme } from './theme';
import type { GraphView } from './view';

/** Paints the canvas backdrop for one frame, in screen space. */
export type BackgroundRenderer = (draw: Draw, origin: Vec2, size: Vec2, view: GraphView, theme: GraphTheme) => void;

/** Phase an axis so the pattern tracks the pan, returning the first line/dot ≥ origin. */
const phase = (originAxis: number, pan: number, pitch: number): number =>
  originAxis + (((pan % pitch) + pitch) % pitch);

/** Dotted grid with brighter major dots every `gridMajor` cells — the default backdrop. */
export const gridBackground: BackgroundRenderer = (draw, origin, size, view, theme) => {
  const pitch = theme.geo.gridPitch * view.zoom;
  if (pitch < 6) return;
  const [ox, oy] = origin;
  const [w, h] = size;
  const major = Math.max(2, Math.round(theme.geo.gridMajor));
  const startX = phase(ox, view.pan[0], pitch);
  const startY = phase(oy, view.pan[1], pitch);
  const col0 = Math.round((startX - ox - view.pan[0]) / pitch);
  const row0 = Math.round((startY - oy - view.pan[1]) / pitch);
  let ci = 0;
  for (let x = startX; x <= ox + w; x += pitch, ci++) {
    let ri = 0;
    for (let y = startY; y <= oy + h; y += pitch, ri++) {
      const isMajor = (col0 + ci) % major === 0 && (row0 + ri) % major === 0;
      const r = isMajor ? 1.4 : 0.9;
      draw.rectFilled([x - r, y - r], [x + r, y + r], isMajor ? theme.chrome.gridDotMajor : theme.chrome.gridDot);
    }
  }
};

/** Uniform dots, no major striping. */
export const dotsBackground: BackgroundRenderer = (draw, origin, size, view, theme) => {
  const pitch = theme.geo.gridPitch * view.zoom;
  if (pitch < 6) return;
  const [ox, oy] = origin;
  const [w, h] = size;
  for (let x = phase(ox, view.pan[0], pitch); x <= ox + w; x += pitch) {
    for (let y = phase(oy, view.pan[1], pitch); y <= oy + h; y += pitch) {
      draw.rectFilled([x - 0.9, y - 0.9], [x + 0.9, y + 0.9], theme.chrome.gridDot);
    }
  }
};

/** A ruled line grid. */
export const linesBackground: BackgroundRenderer = (draw, origin, size, view, theme) => {
  const pitch = theme.geo.gridPitch * view.zoom;
  if (pitch < 6) return;
  const [ox, oy] = origin;
  const [w, h] = size;
  const major = Math.max(2, Math.round(theme.geo.gridMajor));
  const startX = phase(ox, view.pan[0], pitch);
  const startY = phase(oy, view.pan[1], pitch);
  const col0 = Math.round((startX - ox - view.pan[0]) / pitch);
  const row0 = Math.round((startY - oy - view.pan[1]) / pitch);
  let ci = 0;
  for (let x = startX; x <= ox + w; x += pitch, ci++) {
    draw.line([x, oy], [x, oy + h], (col0 + ci) % major === 0 ? theme.chrome.gridDotMajor : theme.chrome.gridDot, 1);
  }
  let ri = 0;
  for (let y = startY; y <= oy + h; y += pitch, ri++) {
    draw.line([ox, y], [ox + w, y], (row0 + ri) % major === 0 ? theme.chrome.gridDotMajor : theme.chrome.gridDot, 1);
  }
};

/** No backdrop pattern (the canvas fill only). */
export const noneBackground: BackgroundRenderer = () => {};

/** The built-in background renderers seeded on every environment. */
export const BUILTIN_BACKGROUNDS: Readonly<Record<string, BackgroundRenderer>> = {
  grid: gridBackground,
  dots: dotsBackground,
  lines: linesBackground,
  none: noneBackground,
};
