import { type Vec4, vec4 } from '@retro-engine/math';

import type { RssRule, RssSelector } from './rss-parser';
import {
  type AlignItems,
  type AlignSelf,
  type Dimension,
  type Edges,
  type FlexDirection,
  type JustifyContent,
  makeStyle,
  type PositionType,
  type UiStyle,
  type UiStyleInit,
} from './ui-style';

/**
 * The identity a `.rss` rule matches against: an element's type, `#name`, its
 * `.class` list, and its active `:state` pseudo-classes
 * (`hovered`/`focused`/`pressed`/`disabled`/`checked`).
 */
export interface StyleNode {
  readonly type?: string;
  readonly name?: string;
  readonly classes: readonly string[];
  readonly states: readonly string[];
}

/** Whether `selector` matches `node` (all parts of a compound must match). */
export const matches = (selector: RssSelector, node: StyleNode): boolean => {
  if (selector.universal) return true;
  if (selector.type !== undefined && selector.type !== node.type) return false;
  if (selector.name !== undefined && selector.name !== node.name) return false;
  for (const cls of selector.classes) if (!node.classes.includes(cls)) return false;
  for (const state of selector.states) if (!node.states.includes(state)) return false;
  return true;
};

/**
 * CSS/USS specificity as `[ids, classes+states, types]` — `#name` beats
 * `.class`/`:state` beats `Type` beats `*`. Compared component-by-component.
 */
export const specificity = (selector: RssSelector): [number, number, number] => [
  selector.name !== undefined ? 1 : 0,
  selector.classes.length + selector.states.length,
  selector.type !== undefined ? 1 : 0,
];

/**
 * Resolve the winning declarations for `node` from `rules`: keep the matching
 * rules, order them by ascending specificity then source order, and let later
 * (more specific / later-in-file) declarations overwrite earlier ones.
 */
export const resolveDeclarations = (
  rules: readonly RssRule[],
  node: StyleNode,
): Record<string, string> => {
  const matched = rules.filter((rule) => matches(rule.selector, node));
  matched.sort((a, b) => {
    const sa = specificity(a.selector);
    const sb = specificity(b.selector);
    return (sa[0] - sb[0]) || (sa[1] - sb[1]) || (sa[2] - sb[2]) || a.order - b.order;
  });
  const out: Record<string, string> = {};
  for (const rule of matched) {
    for (const decl of rule.declarations) out[decl.property] = decl.value;
  }
  return out;
};

const len = (value: string): number => {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
};

const dim = (value: string): Dimension => (value.trim() === 'auto' ? undefined : len(value));

const edges = (value: string): Partial<Edges> => {
  const p = value.split(/\s+/).map(len);
  const top = p[0] ?? 0;
  const right = p[1] ?? top;
  const bottom = p[2] ?? top;
  const left = p[3] ?? right;
  return { top, right, bottom, left };
};

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** CSS-accurate values for the small set of named colors `.rss` accepts. */
const NAMED_COLORS: Record<string, readonly [number, number, number, number]> = {
  transparent: [0, 0, 0, 0],
  black: [0, 0, 0, 1],
  white: [1, 1, 1, 1],
  gray: [128 / 255, 128 / 255, 128 / 255, 1],
  grey: [128 / 255, 128 / 255, 128 / 255, 1],
  red: [1, 0, 0, 1],
  green: [0, 128 / 255, 0, 1],
  lime: [0, 1, 0, 1],
  blue: [0, 0, 1, 1],
  yellow: [1, 1, 0, 1],
  cyan: [0, 1, 1, 1],
  magenta: [1, 0, 1, 1],
};

const parseHexColor = (hex: string): Vec4 | undefined => {
  let h = hex.slice(1).trim();
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
  if (h.length !== 6 && h.length !== 8) return undefined;
  const byte = (i: number): number => Number.parseInt(h.slice(i, i + 2), 16) / 255;
  const r = byte(0);
  const g = byte(2);
  const b = byte(4);
  const a = h.length === 8 ? byte(6) : 1;
  if ([r, g, b, a].some((n) => !Number.isFinite(n))) return undefined;
  return vec4.create(r, g, b, a);
};

const parseFuncColor = (value: string): Vec4 | undefined => {
  const inner = /^rgba?\(([^)]+)\)$/i.exec(value)?.[1];
  if (inner === undefined) return undefined;
  const parts = inner.split(/[,/\s]+/).filter((p) => p.length > 0);
  if (parts.length < 3) return undefined;
  // Channels are 0–255 (or %); alpha is 0–1 (or %).
  const chan = (s: string): number =>
    s.endsWith('%') ? clamp01(Number.parseFloat(s) / 100) : clamp01(Number.parseFloat(s) / 255);
  const alpha = (s: string): number =>
    s.endsWith('%') ? clamp01(Number.parseFloat(s) / 100) : clamp01(Number.parseFloat(s));
  const r = chan(parts[0]!);
  const g = chan(parts[1]!);
  const b = chan(parts[2]!);
  const a = parts[3] !== undefined ? alpha(parts[3]) : 1;
  if ([r, g, b, a].some((n) => !Number.isFinite(n))) return undefined;
  return vec4.create(r, g, b, a);
};

/**
 * Parse a CSS color — `#rgb`/`#rgba`/`#rrggbb`/`#rrggbbaa`, `rgb()`/`rgba()`, or a
 * named color — into an RGBA {@link Vec4} with channels in `[0, 1]`. Returns
 * `undefined` for an unrecognized value. Channels are stored as authored (the
 * same convention as a hand-set `UiStyle.backgroundColor`); no gamma conversion
 * is applied.
 */
export const parseColor = (raw: string): Vec4 | undefined => {
  const value = raw.trim().toLowerCase();
  const named = NAMED_COLORS[value];
  if (named !== undefined) return vec4.create(named[0], named[1], named[2], named[3]);
  if (value.startsWith('#')) return parseHexColor(value);
  if (value.startsWith('rgb')) return parseFuncColor(value);
  return undefined;
};

/** Mutable accumulator for per-side edge declarations (`Edges` is readonly). */
type MutableEdges = { left?: number; right?: number; top?: number; bottom?: number };

/** Map resolved CSS-ish declarations onto a {@link UiStyleInit}. */
const mapDeclarations = (props: Record<string, string>): UiStyleInit => {
  const init: Record<string, unknown> = {};
  const padding: MutableEdges = {};
  const margin: MutableEdges = {};
  let hasPadding = false;
  let hasMargin = false;

  for (const [property, raw] of Object.entries(props)) {
    const value = raw.trim();
    switch (property) {
      case 'flex-direction': init.flexDirection = value as FlexDirection; break;
      case 'justify-content': init.justifyContent = value as JustifyContent; break;
      case 'align-items': init.alignItems = value as AlignItems; break;
      case 'align-self': init.alignSelf = value as AlignSelf; break;
      case 'flex-grow': init.flexGrow = len(value); break;
      case 'flex-shrink': init.flexShrink = len(value); break;
      case 'flex-basis': init.flexBasis = dim(value); break;
      case 'flex': {
        const parts = value.split(/\s+/);
        init.flexGrow = len(parts[0] ?? '0');
        if (parts[1] !== undefined) init.flexShrink = len(parts[1]);
        if (parts[2] !== undefined) init.flexBasis = dim(parts[2]);
        break;
      }
      case 'width': init.width = dim(value); break;
      case 'height': init.height = dim(value); break;
      case 'min-width': init.minWidth = len(value); break;
      case 'max-width': init.maxWidth = len(value); break;
      case 'min-height': init.minHeight = len(value); break;
      case 'max-height': init.maxHeight = len(value); break;
      case 'gap': init.gap = len(value); break;
      case 'position': init.position = value as PositionType; break;
      case 'left': init.left = dim(value); break;
      case 'right': init.right = dim(value); break;
      case 'top': init.top = dim(value); break;
      case 'bottom': init.bottom = dim(value); break;
      case 'padding': Object.assign(padding, edges(value)); hasPadding = true; break;
      case 'padding-left': padding.left = len(value); hasPadding = true; break;
      case 'padding-right': padding.right = len(value); hasPadding = true; break;
      case 'padding-top': padding.top = len(value); hasPadding = true; break;
      case 'padding-bottom': padding.bottom = len(value); hasPadding = true; break;
      case 'margin': Object.assign(margin, edges(value)); hasMargin = true; break;
      case 'margin-left': margin.left = len(value); hasMargin = true; break;
      case 'margin-right': margin.right = len(value); hasMargin = true; break;
      case 'margin-top': margin.top = len(value); hasMargin = true; break;
      case 'margin-bottom': margin.bottom = len(value); hasMargin = true; break;
      case 'background-color': { const c = parseColor(value); if (c !== undefined) init.backgroundColor = c; break; }
      case 'border-color': { const c = parseColor(value); if (c !== undefined) init.borderColor = c; break; }
      case 'border-width': init.borderWidth = edges(value); break;
      case 'border': {
        // `<width> <style> <color>` in any order; the style keyword (e.g. `solid`) is ignored.
        for (const token of value.split(/\s+/)) {
          const c = parseColor(token);
          if (c !== undefined) { init.borderColor = c; continue; }
          if (/^[\d.]/.test(token)) init.borderWidth = len(token);
        }
        break;
      }
      default: break; // unknown property — ignored (forward-compatible)
    }
  }

  if (hasPadding) init.padding = padding;
  if (hasMargin) init.margin = margin;
  return init as UiStyleInit;
};

/**
 * Resolve a node's final {@link UiStyle} from a parsed stylesheet: cascade the
 * matching rules, map the winning declarations onto style fields, and merge any
 * `inline` overrides on top (inline wins, as in USS). Unknown properties are
 * ignored. `--var`/`var()`, inheritance, and combinators are not resolved yet.
 */
export const resolveUiStyle = (
  rules: readonly RssRule[],
  node: StyleNode,
  inline?: UiStyleInit,
): UiStyle => {
  const mapped = mapDeclarations(resolveDeclarations(rules, node));
  return makeStyle(inline !== undefined ? { ...mapped, ...inline } : mapped);
};
