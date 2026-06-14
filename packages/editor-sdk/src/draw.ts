import { type ImDrawList, ImGui, ImGuiCol, ImVec2 } from '@mori2003/jsimgui';

import { packU32 } from './palette';
import type { Vec2 } from './units';

const ZERO = new ImVec2(0, 0);

const v = (p: Vec2): ImVec2 => new ImVec2(p[0], p[1]);

/**
 * A thin, allocation-light facade over an `ImDrawList` for the custom-drawn
 * components (selection rails, axis chips, the switch knob, asset previews, the
 * logo). Colors are `ImU32` from {@link srgbU32}/{@link packU32}; points are
 * {@link Vec2} pixel coordinates in screen space.
 */
export class Draw {
  private constructor(private readonly dl: ImDrawList) {}

  /** Wrap the current window's draw list (foreground of the window being built). */
  static window(): Draw {
    return new Draw(ImGui.GetWindowDrawList());
  }

  /** Wrap the current viewport's foreground draw list (drawn over all windows). */
  static foreground(): Draw {
    return new Draw(ImGui.GetForegroundDrawList());
  }

  rectFilled(min: Vec2, max: Vec2, col: number, rounding = 0, flags = 0): void {
    this.dl.AddRectFilled(v(min), v(max), col, rounding, flags);
  }

  rect(min: Vec2, max: Vec2, col: number, rounding = 0, thickness = 1): void {
    this.dl.AddRect(v(min), v(max), col, rounding, thickness);
  }

  line(a: Vec2, b: Vec2, col: number, thickness = 1): void {
    this.dl.AddLine(v(a), v(b), col, thickness);
  }

  text(pos: Vec2, col: number, value: string): void {
    // The binding's draw-list text overloads are unusable (the bare one renders a
    // zero-length range; the font-ptr one has an unbound clip-rect arg), so draw
    // through a native colored Text at an absolute position and restore the
    // cursor. The trailing zero Dummy submits an item so ImGui's cursor-boundary
    // guard doesn't flag the restoring SetCursorScreenPos.
    const prev = ImGui.GetCursorScreenPos();
    ImGui.SetCursorScreenPos(v(pos));
    ImGui.PushStyleColor(ImGuiCol.Text, col);
    ImGui.Text(value);
    ImGui.PopStyleColor(1);
    ImGui.SetCursorScreenPos(prev);
    ImGui.Dummy(ZERO);
  }

  circleFilled(center: Vec2, radius: number, col: number, segments = 0): void {
    this.dl.AddCircleFilled(v(center), radius, col, segments);
  }

  circle(center: Vec2, radius: number, col: number, thickness = 1, segments = 0): void {
    this.dl.AddCircle(v(center), radius, col, segments, thickness);
  }

  triFilled(a: Vec2, b: Vec2, c: Vec2, col: number): void {
    this.dl.AddTriangleFilled(v(a), v(b), v(c), col);
  }

  quadFilled(a: Vec2, b: Vec2, c: Vec2, d: Vec2, col: number): void {
    this.dl.AddQuadFilled(v(a), v(b), v(c), v(d), col);
  }

  /** A 4-color gradient rect (used for skybox / terrain asset previews). */
  rectFilledMultiColor(min: Vec2, max: Vec2, tl: number, tr: number, br: number, bl: number): void {
    this.dl.AddRectFilledMultiColor(v(min), v(max), tl, tr, br, bl);
  }

  /** A two-tone checkerboard, the transparency backdrop for texture/sprite tiles. */
  checkerboard(min: Vec2, max: Vec2, cell: number, light: number, dark: number): void {
    this.rectFilled(min, max, dark);
    const cols = Math.ceil((max[0] - min[0]) / cell);
    const rows = Math.ceil((max[1] - min[1]) / cell);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if ((x + y) % 2 === 0) continue;
        const x0 = min[0] + x * cell;
        const y0 = min[1] + y * cell;
        this.rectFilled([x0, y0], [Math.min(x0 + cell, max[0]), Math.min(y0 + cell, max[1])], light);
      }
    }
  }

  /**
   * The Retro Engine logo mark — an isometric entity cube with a bright node pip,
   * top-lit (top face brightest, right mid, left darkest). `box` is the top-left
   * corner, `size` the square edge in pixels; coordinates scale linearly from the
   * 64×64 design box.
   */
  logoCube(box: Vec2, size: number): void {
    const s = size / 64;
    const p = (x: number, y: number): Vec2 => [box[0] + x * s, box[1] + y * s];
    const top = packU32(0x5c, 0xf0, 0x9a);
    const left = packU32(0x18, 0xa4, 0x55);
    const right = packU32(0x21, 0xc4, 0x66);
    const edge = packU32(0x04, 0x14, 0x0a);
    const pip = packU32(0xaa, 0xff, 0xcc);
    this.quadFilled(p(32, 6), p(57, 20), p(32, 34), p(7, 20), top);
    this.quadFilled(p(7, 20), p(32, 34), p(32, 60), p(7, 46), left);
    this.quadFilled(p(57, 20), p(32, 34), p(32, 60), p(57, 46), right);
    // Inner seams meeting at the center.
    this.line(p(32, 34), p(32, 60), edge, 1.5);
    this.line(p(32, 34), p(7, 20), edge, 1.5);
    this.line(p(32, 34), p(57, 20), edge, 1.5);
    this.rectFilled(p(29.5, 3.5), p(34.5, 8.5), pip);
  }
}
