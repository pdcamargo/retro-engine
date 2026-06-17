import type { Color } from '@retro-engine/math';

import type { PropertyRenderer } from './property-types';
import { colorToHex, hexToColor } from './renderers-bridge';
import { propertyRow, scrub } from './renderers-support';

// Per-component chip: x/y/z carry an axis tint; the 4th (w) uses a plain label
// since the axis palette is three-dimensional.
const COMPONENT_CHIP = [{ axis: 'x' as const }, { axis: 'y' as const }, { axis: 'z' as const }, { label: 'W' }];

// Axis-chip width as a fraction of the field height, matching the vec3 widget.
const chipWidth = (frameHeight: number): number => Math.round(frameHeight * 0.82);

/** A fixed-width float vector: one axis-tinted scrub field per component. */
const vectorRenderer =
  (count: number): PropertyRenderer =>
  (ctx) => {
    const arr = ctx.value as Float32Array;
    propertyRow(ctx, () => {
      const gap = 4;
      const avail = ctx.ui.contentAvail()[0];
      const chip = chipWidth(ctx.ui.frameHeight());
      const fieldW = Math.max(18, (avail - gap * (count - 1) - chip * count) / count);
      for (let i = 0; i < count; i++) {
        if (i > 0) ctx.ui.sameLine(0, gap);
        const slot = COMPONENT_CHIP[i] ?? {};
        scrub(ctx, [...ctx.path, { kind: 'index', index: i }], arr[i] ?? 0, (v) =>
          ctx.widgets.dragNumber(`${ctx.id}-${i}`, v, { ...slot, step: 0.1, width: fieldW }),
        );
      }
    });
  };

/** A 2-component vector. */
export const vec2Renderer = vectorRenderer(2);
/** A 3-component vector. */
export const vec3Renderer = vectorRenderer(3);
/** A 4-component vector. */
export const vec4Renderer = vectorRenderer(4);
/** A quaternion, edited as raw `x y z w` components. */
export const quatRenderer = vectorRenderer(4);

/** An sRGB color, edited through a hex/swatch field (alpha preserved, not edited). */
export const colorRenderer: PropertyRenderer = (ctx) => {
  const value = ctx.value as Color;
  propertyRow(ctx, () => {
    scrub(ctx, ctx.path, value, (current) => {
      const hex = colorToHex(current);
      const next = ctx.widgets.colorField(ctx.id, hex);
      return next === hex ? current : hexToColor(next, current.a);
    });
  });
};

/** A 4×4 matrix, shown read-only (column-major rows of values). */
export const mat4Renderer: PropertyRenderer = (ctx) => {
  const m = ctx.value as Float32Array;
  const cell = (i: number): string => (m[i] ?? 0).toFixed(2);
  ctx.ui.textMuted(ctx.meta.label);
  ctx.ui.indent();
  for (let r = 0; r < 4; r++) {
    ctx.ui.textDisabled(`${cell(r * 4)}  ${cell(r * 4 + 1)}  ${cell(r * 4 + 2)}  ${cell(r * 4 + 3)}`);
  }
  ctx.ui.unindent();
};
