/**
 * Node rendering: body + header (three variants) + rows (pins, field wells).
 * Everything is emitted to the draw list in screen space via the view transform.
 * Pin connection state and full field widgets are refined in later phases; this
 * draws the node shell, typed pins (hollow / filled), and labels with a zoom LOD.
 */

import type { Draw, Vec2 } from '@retro-engine/editor-sdk';

import type { GraphNode, HeaderVariant, Point } from './document';
import type { GraphEnvironment } from './environment';
import type { NodeLayout, PinLayout } from './layout-cache';
import type { NodeTypeDescriptor } from './node-type';
import type { GraphTheme } from './theme';
import { type GraphView, worldToScreen } from './view';

// ImDrawFlags corner-rounding bits (avoids importing the enum for a constant).
const ROUND_TOP = (1 << 4) | (1 << 5);

/** The minimum zoom at which text is legible; below this, labels are culled. */
const TEXT_LOD = 0.4;

/** Key identifying a pin endpoint, for the connected-pins lookup. */
export const pinKey = (node: string, dir: 'in' | 'out', pin: string): string => `${node}|${dir}|${pin}`;

/** Parameters for one node draw. */
export interface DrawNodeParams {
  readonly draw: Draw;
  readonly node: GraphNode;
  readonly layout: NodeLayout;
  readonly type: NodeTypeDescriptor | undefined;
  readonly view: GraphView;
  readonly origin: Vec2;
  readonly env: GraphEnvironment;
  readonly theme: GraphTheme;
  readonly selected: boolean;
  /** Set of connected pin keys (see {@link pinKey}). */
  readonly connected: ReadonlySet<string>;
}

const categoryColor = (env: GraphEnvironment, theme: GraphTheme, category: string | undefined): number => {
  const desc = category !== undefined ? env.categories.get(category) : undefined;
  return theme.colorFor(category ?? '', desc?.color ?? '#34e07a');
};

const typeColor = (env: GraphEnvironment, theme: GraphTheme, type: string): number =>
  theme.colorFor(type, env.dataTypes.get(type)?.color ?? '#34e07a');

const isExec = (env: GraphEnvironment, type: string): boolean => env.dataTypes.get(type)?.shape === 'triangle';

/** Draw one node. */
export const drawNode = (p: DrawNodeParams): void => {
  const { draw, node, layout, type, view, origin, env, theme } = p;
  const z = view.zoom;
  const geo = theme.geo;
  const alpha = node.disabled ? 0.45 : 1;
  const withA = (col: number): number => (alpha >= 1 ? col : dim(col, alpha));

  const min = worldToScreen(view, origin, layout.x, layout.y);
  const max: Point = [min[0] + layout.w * z, min[1] + layout.h * z];
  const rounding = geo.nodeRadius * z;
  const cat = categoryColor(env, theme, type?.category);
  const variant: HeaderVariant = node.headerVariant ?? type?.header ?? 'stripe';

  // Body.
  draw.rectFilled(min, max, withA(theme.chrome.bodyBg), rounding);

  // Header.
  const headBottom = min[1] + layout.headerH * z;
  const headMax: Point = [max[0], headBottom];
  const headerBg = variant === 'solid' ? theme.chrome.headerBg : theme.chrome.headerBg;
  draw.rectFilled(min, headMax, withA(headerBg), rounding, ROUND_TOP);
  if (variant === 'solid') draw.rectFilled(min, headMax, withA(dim(cat, 0.26)), rounding, ROUND_TOP);
  if (variant === 'stripe') draw.rectFilled(min, [max[0], min[1] + Math.max(2, 3 * z)], withA(cat), rounding, ROUND_TOP);
  if (variant === 'tick') {
    draw.rectFilled([min[0], min[1] + 4 * z], [min[0] + Math.max(2, 3 * z), headBottom - 4 * z], withA(cat));
  }
  draw.line([min[0], headBottom], [max[0], headBottom], withA(theme.chrome.border), Math.max(1, z));

  // Border (+ selection / error ring).
  const border = node.error ? theme.chrome.danger : p.selected ? theme.chrome.selection : theme.chrome.border;
  draw.rect(min, max, withA(border), rounding, Math.max(1, z));
  if (p.selected) draw.rect([min[0] - 1, min[1] - 1], [max[0] + 1, max[1] + 1], theme.chrome.selection, rounding, Math.max(1, z));

  // Header text (title + pixel sub-label), zoom-culled.
  if (z >= TEXT_LOD) {
    const title = node.title ?? type?.label ?? node.typeId;
    const titleSize = geo.fontTitle * z;
    draw.textAt([min[0] + 10 * z, min[1] + (layout.headerH * z - titleSize) / 2], withA(theme.chrome.textBright), title, {
      size: titleSize,
    });
    const sub = (type?.sub ?? type?.category ?? '').toUpperCase();
    if (sub.length > 0) {
      const subSize = geo.fontSub * z;
      const subW = sub.length * subSize * 0.62;
      draw.textAt([max[0] - subW - 8 * z, min[1] + (layout.headerH * z - subSize) / 2], withA(theme.chrome.textFaint), sub, {
        font: 'pixel',
        size: subSize,
      });
    }
  }

  if (node.collapsed) {
    drawPins(p, layout.inputs);
    drawPins(p, layout.outputs);
    return;
  }

  // Field rows (P3: label + inset well placeholder; real widgets land later).
  if (z >= TEXT_LOD) {
    const labelSize = geo.fontLabel * z;
    for (const f of layout.fields) {
      const cyS = worldToScreen(view, origin, layout.x, f.cy)[1];
      draw.textAt([min[0] + 10 * z, cyS - labelSize / 2], withA(theme.chrome.textMuted), f.name, { size: labelSize });
      const wx0 = min[0] + Math.min(70 * z, layout.w * z * 0.5);
      draw.rectFilled([wx0, cyS - 8 * z], [max[0] - 8 * z, cyS + 8 * z], withA(theme.chrome.wellBg), 2 * z);
      draw.rect([wx0, cyS - 8 * z], [max[0] - 8 * z, cyS + 8 * z], withA(theme.chrome.border), 2 * z, 1);
    }
    // Row labels next to pins.
    const labelFor = (pin: PinLayout, out: boolean): void => {
      const cyS = worldToScreen(view, origin, 0, pin.anchor[1])[1];
      const label = pin.name;
      if (out) {
        const wpx = label.length * labelSize * 0.6;
        draw.textAt([max[0] - 14 * z - wpx, cyS - labelSize / 2], withA(theme.chrome.textMuted), label, { size: labelSize });
      } else {
        draw.textAt([min[0] + 14 * z, cyS - labelSize / 2], withA(theme.chrome.textBright), label, { size: labelSize });
      }
    };
    for (const pin of layout.inputs) labelFor(pin, false);
    for (const pin of layout.outputs) labelFor(pin, true);
  }

  drawPins(p, layout.inputs);
  drawPins(p, layout.outputs);
};

const drawPins = (p: DrawNodeParams, pins: readonly PinLayout[]): void => {
  const { draw, node, view, origin, env, theme } = p;
  const z = view.zoom;
  const alpha = node.disabled ? 0.45 : 1;
  for (const pin of pins) {
    const c = worldToScreen(view, origin, pin.anchor[0], pin.anchor[1]);
    const col = alpha >= 1 ? typeColor(env, theme, pin.type) : dim(typeColor(env, theme, pin.type), alpha);
    const on = p.connected.has(pinKey(node.id, pin.dir, pin.name));
    if (isExec(env, pin.type)) drawExecPin(draw, c, theme.geo.pinExec * z, col, theme.chrome.bodyBg, on);
    else drawDataPin(draw, c, (theme.geo.pinDot * z) / 2, col, theme.chrome.bodyBg, theme.softFor(pin.type, env.dataTypes.get(pin.type)?.color ?? '#34e07a'), on, Math.max(1, theme.geo.pinRing * z));
  }
};

const drawDataPin = (
  draw: Draw,
  center: Point,
  r: number,
  col: number,
  bg: number,
  soft: number,
  connected: boolean,
  ring: number,
): void => {
  if (connected) {
    draw.circleFilled(center, r * 1.8, soft); // halo
    draw.circleFilled(center, r, col);
  } else {
    draw.circleFilled(center, r, bg); // panel-filled so wires/grid don't show through
    draw.circle(center, r, col, ring);
  }
};

const drawExecPin = (draw: Draw, center: Point, box: number, col: number, bg: number, connected: boolean): void => {
  const h = box / 2;
  const a: Point = [center[0] - h * 0.7, center[1] - h];
  const b: Point = [center[0] - h * 0.7, center[1] + h];
  const tip: Point = [center[0] + h * 0.9, center[1]];
  if (connected) {
    draw.triFilled(a, b, tip, col);
  } else {
    draw.triFilled(a, b, tip, bg); // panel-filled: the edge must not show through
    draw.line(a, b, col, 2);
    draw.line(b, tip, col, 2);
    draw.line(tip, a, col, 2);
  }
};

/** Scale a packed `ImU32`'s alpha by `f` (for the disabled/dimmed look). */
const dim = (col: number, f: number): number => {
  const a = (col >>> 24) & 0xff;
  return (col & 0x00ffffff) | (Math.round(a * f) << 24);
};
