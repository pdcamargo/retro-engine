import { Draw } from '../draw';
import { axisColor, getActivePalette, srgbU32 } from '../palette';
import type { Srgb8, Vec2 } from '../units';

import { distance2D } from './hit-test';
import type {
  AxisPick,
  ViewportGizmoInput,
  ViewportGizmoOptions,
  ViewportGizmoOutput,
} from './viewport-gizmo-types';

/** One projected axis ball for a single frame. */
interface Ball {
  pos: Vec2;
  depth: number;
  radius: number;
  axis: 'x' | 'y' | 'z';
  sign: 1 | -1;
  color: Srgb8;
  positive: boolean;
  label: string;
  labelColor: Srgb8;
}

const AXIS_KEYS = ['x', 'y', 'z'] as const;

/** Darken an sRGB color toward black by `f` (0..1 kept). */
const dim = (c: Srgb8, f: number): Srgb8 => [
  Math.round(c[0] * f),
  Math.round(c[1] * f),
  Math.round(c[2] * f),
];

/**
 * A camera-orientation widget for an editor viewport — the three.js/Blender-style
 * sphere gizmo. It reflects the camera's orientation as six colored axis balls
 * (positive ones labelled, with lines to the center; negative ones smaller and
 * faint) and lets the user **drag the body to orbit** the camera or **click a
 * ball to align** the view to that axis. A disc fades in behind the balls while
 * hovered.
 *
 * The widget is pure and host-agnostic: {@link update} draws itself through a
 * {@link Draw} list and returns intents ({@link ViewportGizmoOutput}) — orbit
 * deltas and axis picks — for the host to apply to its own camera. It holds only
 * the small amount of state needed to tell a click from a drag across frames.
 *
 * Colors and sizes come from the {@link ViewportGizmoOptions} passed in; the
 * same object can be mutated live to restyle the gizmo. Unset (`null`) colors
 * resolve from the active theme palette.
 */
export class ViewportGizmo {
  private dragging = false;
  private pressedInside = false;
  private pointerStart: Vec2 = [0, 0];
  private lastPointer: Vec2 = [0, 0];
  private focus: { axis: 'x' | 'y' | 'z'; sign: 1 | -1 } | null = null;

  /** @param options Live appearance + behavior config (see {@link defaultViewportGizmoOptions}). */
  constructor(private readonly options: ViewportGizmoOptions) {}

  /**
   * Lay out, draw, and process input for one frame. Returns the orbit/pick
   * intents (if any) and whether the gizmo is capturing the pointer this frame.
   */
  update(input: ViewportGizmoInput): ViewportGizmoOutput {
    const o = this.options;
    const center = this.center(input.viewport);
    const r = o.size / 2;
    const balls = this.layout(input.viewMatrix, center);

    const ptr = input.pointer.position;
    const distToCenter = distance2D(ptr, center);
    const over = input.hovered && distToCenter <= r;

    // Re-pick the hovered ball each frame (nearest within its radius).
    this.focus = over ? nearestBall(balls, ptr, o.hoverScale) : null;

    let orbit: ViewportGizmoOutput['orbit'] = null;
    let pick: AxisPick | null = null;

    if (input.pointer.pressed && over) {
      this.pressedInside = true;
      this.dragging = false;
      this.pointerStart = ptr;
      this.lastPointer = ptr;
    }

    if (this.pressedInside && input.pointer.down) {
      if (!this.dragging && distance2D(ptr, this.pointerStart) > o.clickThresholdPx) {
        this.dragging = true;
      }
      if (this.dragging) {
        // Map pixel travel to radians scaled by widget size, like the reference
        // library's `(1/size) * π` — a half-widget drag is a quarter turn.
        const k = Math.PI / o.size;
        orbit = { dYaw: (ptr[0] - this.lastPointer[0]) * k, dPitch: (ptr[1] - this.lastPointer[1]) * k };
        this.lastPointer = ptr;
      }
    }

    if (input.pointer.released) {
      if (this.pressedInside && !this.dragging && this.focus !== null) {
        pick = { axis: this.focus.axis, sign: this.focus.sign };
      }
      this.pressedInside = false;
      this.dragging = false;
    }

    const active = over || this.dragging;
    this.draw(center, r, balls, active);

    return { active, orbit, pick };
  }

  /** Resolve the widget center from placement, size, and offset within `vp`. */
  private center(vp: ViewportGizmoInput['viewport']): Vec2 {
    const o = this.options;
    const half = o.size / 2;
    const [v, h] = o.placement.split('-');
    const x =
      h === 'left' ? vp.x + o.offset + half : h === 'right' ? vp.x + vp.width - o.offset - half : vp.x + vp.width / 2;
    const y =
      v === 'top' ? vp.y + o.offset + half : v === 'bottom' ? vp.y + vp.height - o.offset - half : vp.y + vp.height / 2;
    return [x, y];
  }

  /** Project the six world axes through the view rotation into widget-space balls. */
  private layout(viewMatrix: ViewportGizmoInput['viewMatrix'], center: Vec2): Ball[] {
    const o = this.options;
    // Balls orbit at a radius that leaves room for the ball itself + hover growth.
    const orbitR = o.size / 2 - o.ballRadius * o.hoverScale - 2;
    const m = viewMatrix;
    const balls: Ball[] = [];
    for (let a = 0; a < 3; a++) {
      // View-space direction of +axis is column `a` of the view (rotation) matrix.
      const vx = m[a * 4]!;
      const vy = m[a * 4 + 1]!;
      const vz = m[a * 4 + 2]!;
      const key = AXIS_KEYS[a]!;
      const style = o[key];
      const base = style.color ?? axisColor(key);
      const labelColor = style.labelColor ?? getActivePalette().gray0;
      for (const sign of [1, -1] as const) {
        const positive = sign === 1;
        balls.push({
          // Screen Y grows downward, so flip the view-space up component.
          pos: [center[0] + vx * sign * orbitR, center[1] - vy * sign * orbitR],
          depth: vz * sign,
          radius: positive ? o.ballRadius : o.ballRadius * o.negativeBallScale,
          axis: key,
          sign,
          color: positive ? base : dim(base, 0.85),
          positive,
          label: positive ? style.label : '',
          labelColor,
        });
      }
    }
    // Far balls first so nearer ones paint on top.
    balls.sort((p, q) => p.depth - q.depth);
    return balls;
  }

  /** Render the disc, axis lines, balls, and labels. */
  private draw(center: Vec2, r: number, balls: Ball[], active: boolean): void {
    const o = this.options;
    const draw = Draw.window();
    const palette = getActivePalette();

    const discColor = o.background.color ?? palette.gray8;
    const discOpacity = active ? o.background.hoverOpacity : o.background.opacity;
    if (discOpacity > 0) draw.circleFilled(center, r, srgbU32(discColor, discOpacity), 48);

    // Lines from the center to the positive balls (drawn behind the balls).
    for (const b of balls) {
      if (!b.positive) continue;
      draw.line(center, b.pos, srgbU32(b.color, 0.9), o.lineWidth);
    }

    for (const b of balls) {
      const hovered =
        this.focus !== null && this.focus.axis === b.axis && this.focus.sign === b.sign;
      const radius = hovered ? b.radius * o.hoverScale : b.radius;
      const opacity = b.positive ? 1 : 0.55;
      draw.circleFilled(b.pos, radius, srgbU32(b.color, opacity), 0);
      if (hovered) draw.circle(b.pos, radius, srgbU32(palette.white), 2, 0);
      if (b.label !== '') {
        // Roughly center the single-glyph label on the ball.
        const fs = o.font.size;
        draw.text([b.pos[0] - b.label.length * fs * 0.28, b.pos[1] - fs * 0.62], srgbU32(b.labelColor), b.label);
      }
    }
  }
}

/** Nearest ball whose (hover-grown) radius contains `p`, or `null`. */
const nearestBall = (balls: Ball[], p: Vec2, hoverScale: number): { axis: 'x' | 'y' | 'z'; sign: 1 | -1 } | null => {
  let best: { axis: 'x' | 'y' | 'z'; sign: 1 | -1 } | null = null;
  let bestD = Infinity;
  for (const b of balls) {
    const d = distance2D(p, b.pos);
    if (d <= b.radius * hoverScale && d < bestD) {
      bestD = d;
      best = { axis: b.axis, sign: b.sign };
    }
  }
  return best;
};
