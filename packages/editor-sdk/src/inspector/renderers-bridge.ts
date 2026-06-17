import type { Color } from '@retro-engine/math';
import type { FieldType } from '@retro-engine/reflect';

const clamp01 = (x: number): number => Math.max(0, Math.min(1, x));

/** A reflection {@link Color} (channels 0–1) to a `#RRGGBB` string (alpha dropped). */
export const colorToHex = (c: Color): string => {
  const to = (x: number): string =>
    Math.round(clamp01(x) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(c.r)}${to(c.g)}${to(c.b)}`.toUpperCase();
};

/** A `#RGB` / `#RRGGBB` string to a reflection {@link Color}, carrying `alpha` through. */
export const hexToColor = (hex: string, alpha = 1): Color => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.replace(/(.)/g, '$1$1') : h;
  const n = Number.parseInt(full, 16);
  if (Number.isNaN(n)) return { r: 0, g: 0, b: 0, a: alpha };
  return { r: ((n >> 16) & 0xff) / 255, g: ((n >> 8) & 0xff) / 255, b: (n & 0xff) / 255, a: alpha };
};

/**
 * A sensible fresh value for a field of the given type — used when switching a
 * discriminated-union arm, where the new arm needs a default payload. Covers the
 * common kinds; reference kinds (handle, nested type, entity ref) and variants
 * fall back to `undefined` for the caller to fill.
 */
export const defaultValueFor = (ft: FieldType<unknown>): unknown => {
  switch (ft.kind) {
    case 'number':
      return 0;
    case 'string':
      return '';
    case 'boolean':
      return false;
    case 'enum':
      return ft.enumValues?.[0] ?? '';
    case 'vec2':
      return new Float32Array(2);
    case 'vec3':
      return new Float32Array(3);
    case 'vec4':
      return new Float32Array(4);
    case 'quat':
      return new Float32Array([0, 0, 0, 1]);
    case 'mat4': {
      const m = new Float32Array(16);
      m[0] = m[5] = m[10] = m[15] = 1;
      return m;
    }
    case 'color':
      return { r: 0, g: 0, b: 0, a: 1 };
    case 'array':
      return [];
    case 'tuple':
      return (ft.elements ?? []).map(defaultValueFor);
    case 'struct': {
      const out: Record<string, unknown> = {};
      for (const [key, sub] of Object.entries(ft.fields ?? {})) out[key] = defaultValueFor(sub);
      return out;
    }
    case 'entity':
      return 0;
    case 'handle':
    case 'type':
    case 'variant':
      return undefined;
  }
};
