/**
 * The graph's visual theme: geometry tokens plus packed chrome colors. Chrome is
 * seeded from the active editor palette so the graph matches the studio skin;
 * data-type / category colors come from their descriptors (see
 * {@link GraphEnvironment}) and can be overridden per name here. Geometry is in
 * world units (before zoom). Colors are packed `ImU32` for the draw list.
 */

import { getActivePalette, packU32, type Srgb8 } from '@retro-engine/editor-sdk';

/** Geometry tokens, in world units. Multiply by the view zoom at draw time. */
export interface GraphGeometry {
  nodeRadius: number;
  nodeMinW: number;
  headerH: number;
  rowH: number;
  pad: number;
  pinDot: number;
  pinExec: number;
  pinRing: number;
  wireW: number;
  wireWExec: number;
  wireWSel: number;
  rerouteSize: number;
  gridPitch: number;
  gridMajor: number;
  /** Base font sizes (px at zoom 1) for the title / row label / pixel sub-label. */
  fontTitle: number;
  fontLabel: number;
  fontSub: number;
}

/** Packed `ImU32` chrome colors for node/canvas rendering. */
export interface GraphChrome {
  canvasBg: number;
  bodyBg: number;
  headerBg: number;
  wellBg: number;
  border: number;
  borderStrong: number;
  textBright: number;
  textMuted: number;
  textFaint: number;
  selection: number;
  danger: number;
  gridDot: number;
  gridDotMajor: number;
  scanline: number;
}

/** The default geometry tokens (the handoff's §2.3 values). */
export const DEFAULT_GEOMETRY: GraphGeometry = {
  nodeRadius: 5,
  nodeMinW: 150,
  headerH: 28,
  rowH: 22,
  pad: 8,
  pinDot: 11,
  pinExec: 13,
  pinRing: 1.5,
  wireW: 2,
  wireWExec: 2.5,
  wireWSel: 3,
  rerouteSize: 14,
  gridPitch: 22,
  gridMajor: 6,
  fontTitle: 13,
  fontLabel: 12,
  fontSub: 8,
};

const clampByte = (n: number): number => Math.max(0, Math.min(255, Math.round(n)));

/** Parse a `#rgb` / `#rrggbb` string to an sRGB byte triple; falls back to phosphor green. */
const parseHex = (hex: string): Srgb8 => {
  let h = hex.trim();
  if (h.startsWith('#')) h = h.slice(1);
  if (h.length === 3) h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!;
  if (h.length !== 6) return [52, 224, 122];
  const n = Number.parseInt(h, 16);
  if (Number.isNaN(n)) return [52, 224, 122];
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
};

/** The graph theme: geometry, chrome, per-name color overrides, and a pack cache. */
export class GraphTheme {
  readonly geo: GraphGeometry;
  readonly chrome: GraphChrome;
  private readonly overrides = new Map<string, string>();
  private readonly cache = new Map<string, number>();

  constructor(geo: GraphGeometry, chrome: GraphChrome) {
    this.geo = geo;
    this.chrome = chrome;
  }

  /** Pack a CSS hex color (+ alpha 0..255) to `ImU32`, cached by string. */
  pack(hex: string, alpha = 255): number {
    const key = `${hex}|${alpha}`;
    let u = this.cache.get(key);
    if (u === undefined) {
      const [r, g, b] = parseHex(hex);
      u = packU32(r, g, b, clampByte(alpha));
      this.cache.set(key, u);
    }
    return u;
  }

  /** The effective color for a named data type / category: an override, else the descriptor color. */
  colorFor(name: string, fallbackHex: string, alpha = 255): number {
    return this.pack(this.overrides.get(name) ?? fallbackHex, alpha);
  }

  /** The soft-halo color (16% alpha) for a named type — the connected-pin glow / typed well tint. */
  softFor(name: string, fallbackHex: string): number {
    return this.colorFor(name, fallbackHex, 41); // ~16% of 255
  }

  /** Store a per-name color override (e.g. `setTheme(t, { '--gt-float': '#7CFFB0' })`). */
  setColorOverride(name: string, hex: string): void {
    this.overrides.set(name, hex);
    // Drop stale packed entries for this hex family; simplest is a full clear.
    this.cache.clear();
  }
}

/**
 * Create a graph theme. Chrome is seeded from the active editor palette; pass
 * geometry overrides to tweak tokens (e.g. a wider grid pitch).
 */
export const createGraphTheme = (geoOverrides?: Partial<GraphGeometry>): GraphTheme => {
  const p = getActivePalette();
  const chrome: GraphChrome = {
    canvasBg: packU32(p.gray0[0], p.gray0[1], p.gray0[2]),
    bodyBg: packU32(p.gray2[0], p.gray2[1], p.gray2[2]),
    headerBg: packU32(p.gray3[0], p.gray3[1], p.gray3[2]),
    wellBg: packU32(p.gray1[0], p.gray1[1], p.gray1[2]),
    border: packU32(p.gray6[0], p.gray6[1], p.gray6[2]),
    borderStrong: packU32(p.gray7[0], p.gray7[1], p.gray7[2]),
    textBright: packU32(p.text[0], p.text[1], p.text[2]),
    textMuted: packU32(p.textMuted[0], p.textMuted[1], p.textMuted[2]),
    textFaint: packU32(p.textFaint[0], p.textFaint[1], p.textFaint[2]),
    selection: packU32(p.amber400[0], p.amber400[1], p.amber400[2]),
    danger: packU32(p.red400[0], p.red400[1], p.red400[2]),
    gridDot: packU32(p.gray4[0], p.gray4[1], p.gray4[2], 90),
    gridDotMajor: packU32(p.gray6[0], p.gray6[1], p.gray6[2], 140),
    scanline: packU32(0, 0, 0, 64),
  };
  return new GraphTheme({ ...DEFAULT_GEOMETRY, ...geoOverrides }, chrome);
};

/** Apply runtime overrides: per-name color tokens (`--gt-*` / `--gcat-*`) and geometry numbers. */
export const setTheme = (
  theme: GraphTheme,
  overrides: Record<string, string | number>,
): void => {
  for (const [key, value] of Object.entries(overrides)) {
    if (typeof value === 'number') {
      // Geometry token, e.g. `--ggrid-pitch` -> gridPitch.
      const geoKey = tokenToGeoKey(key);
      if (geoKey !== undefined) (theme.geo as unknown as Record<string, number>)[geoKey] = value;
    } else {
      // Color token, e.g. `--gt-float` -> data-type name `float`.
      const name = key.replace(/^--g(t|cat)-/, '');
      theme.setColorOverride(name, value);
    }
  }
};

const GEO_TOKENS: Record<string, keyof GraphGeometry> = {
  '--gnode-radius': 'nodeRadius',
  '--gnode-min-w': 'nodeMinW',
  '--gnode-head-h': 'headerH',
  '--gnode-row-h': 'rowH',
  '--gnode-pad': 'pad',
  '--gpin-dot': 'pinDot',
  '--gpin-exec': 'pinExec',
  '--gpin-ring': 'pinRing',
  '--gwire-w': 'wireW',
  '--gwire-w-exec': 'wireWExec',
  '--gwire-w-sel': 'wireWSel',
  '--greroute-size': 'rerouteSize',
  '--ggrid-pitch': 'gridPitch',
  '--ggrid-major': 'gridMajor',
};

const tokenToGeoKey = (token: string): keyof GraphGeometry | undefined => GEO_TOKENS[token];
