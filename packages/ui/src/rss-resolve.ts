import { type Vec4, vec4 } from '@retro-engine/math';

import type { RssRule, RssSelector } from './rss-parser';
import {
  type AlignItems,
  type AlignSelf,
  type Dimension,
  type Display,
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

/**
 * Grid-item span from a `grid-column` / `grid-row` value: `span N` or a bare `N`
 * (both → `N`); anything else → `1`. (Explicit line placement like `1 / 3` is a
 * later phase.)
 */
const spanCount = (value: string): number => {
  const v = value.trim();
  const n = Number.parseInt(v.startsWith('span') ? v.slice(4).trim() : v, 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
};

/** A parsed `grid-column` / `grid-row`: an explicit 1-based `start` line (`0` = auto) + track `span`. */
interface GridLine {
  readonly start: number;
  readonly span: number;
}

/**
 * Parse a CSS `grid-column` / `grid-row` value into an explicit start line +
 * span (matching CSS line semantics):
 * - `span N` → auto start (`0`), span `N`.
 * - `N` → start at line `N`, span `1` (a bare number is a **line**, not a span).
 * - `N / M` → start `N`, span `M − N` (line-to-line).
 * - `N / span M` → start `N`, span `M`.
 * Unrecognized parts fall back to auto / span 1.
 */
const gridLine = (value: string): GridLine => {
  const parts = value.split('/').map((p) => p.trim());
  const line = (t: string): number => {
    const n = Number.parseInt(t, 10);
    return Number.isFinite(n) && n >= 1 ? n : 0;
  };
  const first = parts[0] ?? '';
  if (parts.length < 2) {
    return first.startsWith('span') ? { start: 0, span: spanCount(first) } : { start: line(first), span: 1 };
  }
  const start = line(first);
  const end = parts[1]!;
  if (end.startsWith('span')) return { start, span: spanCount(end) };
  const endLine = Number.parseInt(end, 10);
  if (start >= 1 && Number.isFinite(endLine) && endLine > start) return { start, span: endLine - start };
  return { start, span: 1 };
};

/**
 * Normalize an item-alignment keyword to the engine's `flex-*` form: the CSS
 * grid keywords `start` / `end` map to `flex-start` / `flex-end`, while
 * `flex-start` / `flex-end` / `center` / `stretch` / `auto` pass through. Lets
 * `.rss` author grid alignment with either spelling.
 */
const alignKeyword = (value: string): string => {
  const v = value.trim();
  return v === 'start' ? 'flex-start' : v === 'end' ? 'flex-end' : v;
};

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
      case 'display': init.display = value as Display; break;
      case 'grid-template-columns': init.gridTemplateColumns = value; break;
      case 'grid-template-rows': init.gridTemplateRows = value; break;
      case 'grid-column': {
        const g = gridLine(value);
        init.gridColumnStart = g.start;
        init.gridColumnSpan = g.span;
        break;
      }
      case 'grid-row': {
        const g = gridLine(value);
        init.gridRowStart = g.start;
        init.gridRowSpan = g.span;
        break;
      }
      case 'grid-auto-rows': init.gridAutoRows = len(value); break;
      case 'flex-direction': init.flexDirection = value as FlexDirection; break;
      case 'justify-content': init.justifyContent = value as JustifyContent; break;
      case 'align-content': init.alignContent = value as JustifyContent; break;
      case 'align-items': init.alignItems = alignKeyword(value) as AlignItems; break;
      case 'align-self': init.alignSelf = alignKeyword(value) as AlignSelf; break;
      case 'justify-items': init.justifyItems = alignKeyword(value) as AlignItems; break;
      case 'justify-self': init.justifySelf = alignKeyword(value) as AlignSelf; break;
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
        // `<width> <style> <color>` in any order; the style keyword (e.g. `solid`)
        // is ignored. Pull a functional/hex color out first (it can contain the
        // spaces `rgb(r, g, b)` uses), then read the width from a numeric token.
        const funcColor = /rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}/.exec(value)?.[0];
        const rest = funcColor !== undefined ? value.replace(funcColor, ' ') : value;
        let color = funcColor !== undefined ? parseColor(funcColor) : undefined;
        for (const token of rest.split(/\s+/)) {
          if (token === '') continue;
          if (color === undefined) {
            const named = parseColor(token);
            if (named !== undefined) { color = named; continue; }
          }
          if (/^[\d.]/.test(token)) init.borderWidth = len(token);
        }
        if (color !== undefined) init.borderColor = color;
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
 * Collect every custom-property (`--name`) declaration across the sheet into a
 * flat variable map — a global theme. Later declarations win (source order).
 * Per-node scoping / inheritance is not modeled: a `--var` declared anywhere is
 * visible everywhere, which suits a global palette (override it per-run via a
 * theme map merged on top).
 */
export const collectThemeVars = (rules: readonly RssRule[]): Record<string, string> => {
  const vars: Record<string, string> = {};
  for (const rule of rules) {
    for (const decl of rule.declarations) {
      if (decl.property.startsWith('--')) vars[decl.property] = decl.value.trim();
    }
  }
  return vars;
};

/**
 * Whether a selector is a *global* variable source — `*` (universal) or `:root`.
 * Custom properties declared on these apply to every node; those on element
 * selectors (`.class` / `#name` / type) are subtree-scoped (see
 * {@link resolveNodeVars}).
 */
const isGlobalVarSelector = (selector: RssSelector): boolean =>
  selector.universal ||
  (selector.type === undefined &&
    selector.name === undefined &&
    selector.classes.length === 0 &&
    selector.states.length === 1 &&
    selector.states[0] === 'root');

/**
 * Collect the *global* custom properties — those declared on `*` / `:root` — into
 * a flat map (later declarations win). These form the inherited base every node
 * starts from; a matching ancestor can override them for its subtree.
 */
export const collectGlobalVars = (rules: readonly RssRule[]): Record<string, string> => {
  const vars: Record<string, string> = {};
  for (const rule of rules) {
    if (!isGlobalVarSelector(rule.selector)) continue;
    for (const decl of rule.declarations) {
      if (decl.property.startsWith('--')) vars[decl.property] = decl.value.trim();
    }
  }
  return vars;
};

/**
 * The *element-scoped* custom properties `node` itself declares — the `--name`
 * declarations from matching non-global rules, cascaded (specificity then source
 * order). These override inherited values within the node's subtree.
 */
export const resolveNodeVars = (rules: readonly RssRule[], node: StyleNode): Record<string, string> => {
  const matched = rules.filter((rule) => !isGlobalVarSelector(rule.selector) && matches(rule.selector, node));
  matched.sort((a, b) => {
    const sa = specificity(a.selector);
    const sb = specificity(b.selector);
    return (sa[0] - sb[0]) || (sa[1] - sb[1]) || (sa[2] - sb[2]) || a.order - b.order;
  });
  const vars: Record<string, string> = {};
  for (const rule of matched) {
    for (const decl of rule.declarations) {
      if (decl.property.startsWith('--')) vars[decl.property] = decl.value.trim();
    }
  }
  return vars;
};

const VAR_REF = /var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/g;

/**
 * Substitute `var(--name)` / `var(--name, fallback)` references in a declaration
 * value using `vars`. An unknown variable resolves to its fallback (or an empty
 * string). Fallbacks are simple values — a `var()` nested inside another `var()`
 * fallback is not resolved.
 */
export const substituteVars = (value: string, vars: Record<string, string>): string => {
  if (!value.includes('var(')) return value;
  return value.replace(VAR_REF, (_match, name: string, fallback?: string) => {
    const resolved = vars[name];
    if (resolved !== undefined) return resolved;
    return fallback !== undefined ? fallback.trim() : '';
  });
};

/**
 * Resolve a node's final {@link UiStyle} from a parsed stylesheet: cascade the
 * matching rules, substitute `var()` references against `vars` (the sheet's own
 * custom properties when omitted), map the winning declarations onto style
 * fields, and merge any `inline` overrides on top (inline wins, as in USS).
 * Unknown properties are ignored. Inheritance and combinators are not resolved yet.
 */
export const resolveUiStyle = (
  rules: readonly RssRule[],
  node: StyleNode,
  inline?: UiStyleInit,
  vars?: Record<string, string>,
): UiStyle => {
  const varMap = vars ?? collectThemeVars(rules);
  const resolved = resolveDeclarations(rules, node);
  const substituted: Record<string, string> = {};
  for (const [property, value] of Object.entries(resolved)) {
    substituted[property] = substituteVars(value, varMap);
  }
  const mapped = mapDeclarations(substituted);
  return makeStyle(inline !== undefined ? { ...mapped, ...inline } : mapped);
};
