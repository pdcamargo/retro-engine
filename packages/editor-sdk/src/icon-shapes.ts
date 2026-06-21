import { Draw } from './draw';
import type { Vec2 } from './units';

/**
 * Procedural line-art icons drawn with the draw list. Used instead of an icon
 * font: the bundled glyph rasterizer renders many icon fonts as `.notdef`, and a
 * vector set is asset-free and crisp at any size. Each icon is drawn inside the
 * box `[min, min+size]` in a 2px-stroke Lucide-like style. Unknown names fall
 * back to a neutral rounded square so a missing icon still reads as a placeholder.
 */
export const drawIcon = (name: string, min: Vec2, size: number, col: number): void => {
  const dl = Draw.window();
  const t = Math.max(1, size * 0.085);
  const p = (x: number, y: number): Vec2 => [min[0] + x * size, min[1] + y * size];
  const line = (x0: number, y0: number, x1: number, y1: number): void => dl.line(p(x0, y0), p(x1, y1), col, t);
  const rect = (x0: number, y0: number, x1: number, y1: number, r = 0.1): void =>
    dl.rect(p(x0, y0), p(x1, y1), col, r * size, t);
  const circle = (cx: number, cy: number, r: number): void => dl.circle(p(cx, cy), r * size, col, t, 0);
  const dot = (cx: number, cy: number, r: number): void => dl.circleFilled(p(cx, cy), r * size, col, 0);
  const tri = (x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): void =>
    dl.triFilled(p(x0, y0), p(x1, y1), p(x2, y2), col);

  switch (name) {
    case 'box':
    case 'box-select':
      rect(0.18, 0.28, 0.82, 0.82, 0.08);
      line(0.18, 0.28, 0.5, 0.12);
      line(0.5, 0.12, 0.82, 0.28);
      line(0.5, 0.12, 0.5, 0.42);
      break;
    case 'move':
    case 'move-3d':
      line(0.5, 0.12, 0.5, 0.88);
      line(0.12, 0.5, 0.88, 0.5);
      tri(0.5, 0.06, 0.4, 0.2, 0.6, 0.2);
      tri(0.5, 0.94, 0.4, 0.8, 0.6, 0.8);
      tri(0.06, 0.5, 0.2, 0.4, 0.2, 0.6);
      tri(0.94, 0.5, 0.8, 0.4, 0.8, 0.6);
      break;
    case 'rotate-3d':
      dl.circle(p(0.5, 0.5), 0.34 * size, col, t, 0);
      tri(0.5, 0.1, 0.4, 0.24, 0.62, 0.2);
      break;
    case 'scaling':
      rect(0.16, 0.16, 0.62, 0.62, 0.08);
      line(0.62, 0.62, 0.86, 0.86);
      line(0.7, 0.86, 0.86, 0.86);
      line(0.86, 0.7, 0.86, 0.86);
      break;
    case 'mouse-pointer-2':
      tri(0.25, 0.15, 0.25, 0.78, 0.45, 0.6);
      line(0.45, 0.6, 0.62, 0.85);
      break;
    case 'grid-3x3':
      rect(0.15, 0.15, 0.85, 0.85, 0.06);
      line(0.38, 0.15, 0.38, 0.85);
      line(0.62, 0.15, 0.62, 0.85);
      line(0.15, 0.38, 0.85, 0.38);
      line(0.15, 0.62, 0.85, 0.62);
      break;
    case 'axis-3d':
      line(0.2, 0.8, 0.2, 0.2);
      line(0.2, 0.8, 0.8, 0.8);
      line(0.2, 0.8, 0.62, 0.42);
      break;
    case 'gauge':
      dl.circle(p(0.5, 0.55), 0.36 * size, col, t, 0);
      line(0.5, 0.55, 0.66, 0.36);
      dot(0.5, 0.55, 0.05);
      break;
    case 'play':
      tri(0.3, 0.2, 0.3, 0.8, 0.82, 0.5);
      break;
    case 'square':
      dl.rectFilled(p(0.24, 0.24), p(0.76, 0.76), col, 0.06 * size);
      break;
    case 'pause':
      dl.rectFilled(p(0.3, 0.2), p(0.44, 0.8), col, 0);
      dl.rectFilled(p(0.56, 0.2), p(0.7, 0.8), col, 0);
      break;
    case 'skip-forward':
      tri(0.22, 0.2, 0.22, 0.8, 0.62, 0.5);
      dl.rectFilled(p(0.66, 0.2), p(0.78, 0.8), col, 0);
      break;
    case 'layout-dashboard':
      rect(0.15, 0.15, 0.48, 0.55, 0.08);
      rect(0.15, 0.65, 0.48, 0.85, 0.08);
      rect(0.52, 0.15, 0.85, 0.45, 0.08);
      rect(0.52, 0.55, 0.85, 0.85, 0.08);
      break;
    case 'settings':
      circle(0.5, 0.5, 0.18);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const c = Math.cos(a);
        const s = Math.sin(a);
        line(0.5 + c * 0.26, 0.5 + s * 0.26, 0.5 + c * 0.4, 0.5 + s * 0.4);
      }
      break;
    case 'terminal':
      rect(0.12, 0.2, 0.88, 0.8, 0.08);
      line(0.26, 0.4, 0.42, 0.5);
      line(0.42, 0.5, 0.26, 0.6);
      line(0.52, 0.62, 0.72, 0.62);
      break;
    case 'folder':
    case 'folder-open':
      line(0.14, 0.3, 0.42, 0.3);
      line(0.42, 0.3, 0.5, 0.4);
      rect(0.14, 0.3, 0.86, 0.78, 0.08);
      break;
    case 'workflow':
      rect(0.14, 0.14, 0.44, 0.4, 0.1);
      rect(0.56, 0.6, 0.86, 0.86, 0.1);
      line(0.44, 0.27, 0.71, 0.27);
      line(0.71, 0.27, 0.71, 0.6);
      break;
    case 'gamepad-2':
      rect(0.12, 0.34, 0.88, 0.74, 0.2);
      line(0.26, 0.46, 0.26, 0.62);
      line(0.18, 0.54, 0.34, 0.54);
      dot(0.68, 0.5, 0.05);
      dot(0.78, 0.6, 0.05);
      break;
    case 'video':
    case 'video-off':
      rect(0.12, 0.32, 0.62, 0.68, 0.12);
      tri(0.66, 0.4, 0.66, 0.6, 0.86, 0.7);
      tri(0.66, 0.4, 0.86, 0.3, 0.86, 0.7);
      break;
    case 'sun':
      circle(0.5, 0.5, 0.2);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const c = Math.cos(a);
        const s = Math.sin(a);
        line(0.5 + c * 0.32, 0.5 + s * 0.32, 0.5 + c * 0.44, 0.5 + s * 0.44);
      }
      break;
    case 'clapperboard':
      rect(0.12, 0.38, 0.88, 0.84, 0.06);
      line(0.12, 0.5, 0.88, 0.5);
      line(0.28, 0.5, 0.36, 0.38);
      line(0.5, 0.5, 0.58, 0.38);
      break;
    case 'image':
      rect(0.14, 0.18, 0.86, 0.82, 0.08);
      circle(0.36, 0.38, 0.07);
      line(0.2, 0.76, 0.44, 0.52);
      line(0.44, 0.52, 0.8, 0.78);
      break;
    case 'file-code':
      rect(0.22, 0.1, 0.78, 0.9, 0.06);
      line(0.42, 0.45, 0.34, 0.55);
      line(0.34, 0.55, 0.42, 0.65);
      line(0.58, 0.45, 0.66, 0.55);
      line(0.66, 0.55, 0.58, 0.65);
      break;
    case 'audio-lines':
      line(0.2, 0.42, 0.2, 0.58);
      line(0.37, 0.28, 0.37, 0.72);
      line(0.54, 0.16, 0.54, 0.84);
      line(0.71, 0.34, 0.71, 0.66);
      line(0.85, 0.44, 0.85, 0.56);
      break;
    case 'circle-dot':
      circle(0.5, 0.5, 0.34);
      dot(0.5, 0.5, 0.1);
      break;
    case 'circle-check':
      circle(0.5, 0.5, 0.34);
      line(0.36, 0.5, 0.46, 0.62);
      line(0.46, 0.62, 0.66, 0.38);
      break;
    case 'sliders-horizontal':
      line(0.14, 0.34, 0.86, 0.34);
      line(0.14, 0.66, 0.86, 0.66);
      dot(0.64, 0.34, 0.09);
      dot(0.36, 0.66, 0.09);
      break;
    case 'list-tree':
      line(0.2, 0.22, 0.86, 0.22);
      line(0.42, 0.5, 0.86, 0.5);
      line(0.42, 0.78, 0.86, 0.78);
      line(0.28, 0.22, 0.28, 0.78);
      line(0.28, 0.5, 0.42, 0.5);
      line(0.28, 0.78, 0.42, 0.78);
      break;
    case 'list-filter':
      line(0.16, 0.26, 0.84, 0.26);
      line(0.28, 0.5, 0.72, 0.5);
      line(0.4, 0.74, 0.6, 0.74);
      break;
    case 'plus':
      line(0.5, 0.2, 0.5, 0.8);
      line(0.2, 0.5, 0.8, 0.5);
      break;
    case 'x':
      line(0.26, 0.26, 0.74, 0.74);
      line(0.74, 0.26, 0.26, 0.74);
      break;
    case 'check':
      line(0.22, 0.52, 0.42, 0.72);
      line(0.42, 0.72, 0.78, 0.3);
      break;
    case 'search':
      circle(0.42, 0.42, 0.24);
      line(0.6, 0.6, 0.82, 0.82);
      break;
    case 'chevron-down':
      line(0.28, 0.4, 0.5, 0.62);
      line(0.5, 0.62, 0.72, 0.4);
      break;
    case 'chevron-right':
      line(0.4, 0.28, 0.62, 0.5);
      line(0.62, 0.5, 0.4, 0.72);
      break;
    case 'chevrons-down-up':
      line(0.28, 0.56, 0.5, 0.74);
      line(0.5, 0.74, 0.72, 0.56);
      line(0.28, 0.44, 0.5, 0.26);
      line(0.5, 0.26, 0.72, 0.44);
      break;
    case 'git-branch':
      line(0.32, 0.18, 0.32, 0.82);
      circle(0.32, 0.18, 0.1);
      circle(0.32, 0.82, 0.1);
      circle(0.7, 0.34, 0.1);
      line(0.32, 0.55, 0.7, 0.44);
      break;
    case 'cpu':
      rect(0.26, 0.26, 0.74, 0.74, 0.08);
      rect(0.4, 0.4, 0.6, 0.6, 0.05);
      for (const x of [0.4, 0.5, 0.6]) {
        line(x, 0.16, x, 0.26);
        line(x, 0.74, x, 0.84);
      }
      for (const y of [0.4, 0.5, 0.6]) {
        line(0.16, y, 0.26, y);
        line(0.74, y, 0.84, y);
      }
      break;
    case 'zap':
      tri(0.56, 0.12, 0.28, 0.56, 0.52, 0.56);
      tri(0.44, 0.88, 0.72, 0.44, 0.48, 0.44);
      break;
    case 'activity':
      line(0.12, 0.5, 0.32, 0.5);
      line(0.32, 0.5, 0.44, 0.22);
      line(0.44, 0.22, 0.58, 0.78);
      line(0.58, 0.78, 0.68, 0.5);
      line(0.68, 0.5, 0.88, 0.5);
      break;
    case 'maximize':
      line(0.2, 0.34, 0.2, 0.2);
      line(0.2, 0.2, 0.34, 0.2);
      line(0.66, 0.2, 0.8, 0.2);
      line(0.8, 0.2, 0.8, 0.34);
      line(0.8, 0.66, 0.8, 0.8);
      line(0.8, 0.8, 0.66, 0.8);
      line(0.34, 0.8, 0.2, 0.8);
      line(0.2, 0.8, 0.2, 0.66);
      break;
    case 'trash-2':
      line(0.18, 0.28, 0.82, 0.28);
      rect(0.26, 0.28, 0.74, 0.86, 0.06);
      line(0.4, 0.2, 0.6, 0.2);
      break;
    case 'eye':
      dl.circle(p(0.5, 0.5), 0.32 * size, col, t, 0);
      dot(0.5, 0.5, 0.1);
      break;
    case 'eye-off':
      dl.circle(p(0.5, 0.5), 0.3 * size, col, t, 0);
      line(0.22, 0.22, 0.78, 0.78);
      break;
    case 'copy':
      rect(0.3, 0.3, 0.82, 0.82, 0.08);
      rect(0.18, 0.18, 0.66, 0.66, 0.08);
      break;
    case 'pencil':
      line(0.22, 0.78, 0.7, 0.3);
      line(0.7, 0.3, 0.82, 0.42);
      line(0.82, 0.42, 0.34, 0.9);
      break;
    case 'square-arrow-out-up-right':
      rect(0.16, 0.34, 0.66, 0.84, 0.08);
      line(0.52, 0.48, 0.84, 0.16);
      line(0.62, 0.16, 0.84, 0.16);
      line(0.84, 0.16, 0.84, 0.38);
      break;
    case 'mountain':
      tri(0.5, 0.2, 0.16, 0.82, 0.84, 0.82);
      break;
    case 'cloud':
      dl.circle(p(0.4, 0.55), 0.18 * size, col, t, 0);
      dl.circle(p(0.62, 0.5), 0.2 * size, col, t, 0);
      line(0.24, 0.72, 0.78, 0.72);
      break;
    case 'component':
      tri(0.5, 0.14, 0.34, 0.32, 0.66, 0.32);
      tri(0.5, 0.86, 0.34, 0.68, 0.66, 0.68);
      tri(0.14, 0.5, 0.32, 0.34, 0.32, 0.66);
      tri(0.86, 0.5, 0.68, 0.34, 0.68, 0.66);
      break;
    case 'film':
      rect(0.16, 0.2, 0.84, 0.8, 0.06);
      line(0.32, 0.2, 0.32, 0.8);
      line(0.68, 0.2, 0.68, 0.8);
      break;
    case 'type':
      line(0.24, 0.26, 0.76, 0.26);
      line(0.5, 0.26, 0.5, 0.78);
      break;
    case 'sparkles':
      tri(0.36, 0.16, 0.26, 0.42, 0.46, 0.42);
      tri(0.36, 0.66, 0.26, 0.42, 0.46, 0.42);
      dot(0.7, 0.66, 0.08);
      break;
    case 'undo-2':
      line(0.22, 0.42, 0.36, 0.3);
      line(0.22, 0.42, 0.36, 0.54);
      line(0.22, 0.42, 0.58, 0.42);
      line(0.58, 0.42, 0.72, 0.52);
      line(0.72, 0.52, 0.74, 0.7);
      break;
    case 'redo-2':
      line(0.78, 0.42, 0.64, 0.3);
      line(0.78, 0.42, 0.64, 0.54);
      line(0.78, 0.42, 0.42, 0.42);
      line(0.42, 0.42, 0.28, 0.52);
      line(0.28, 0.52, 0.26, 0.7);
      break;
    case 'history':
      dl.circle(p(0.54, 0.54), 0.3 * size, col, t, 0);
      line(0.54, 0.54, 0.54, 0.38);
      line(0.54, 0.54, 0.66, 0.6);
      line(0.18, 0.34, 0.3, 0.28);
      line(0.18, 0.34, 0.22, 0.46);
      break;
    case 'layers':
      line(0.5, 0.16, 0.84, 0.36);
      line(0.84, 0.36, 0.5, 0.56);
      line(0.5, 0.56, 0.16, 0.36);
      line(0.16, 0.36, 0.5, 0.16);
      line(0.16, 0.52, 0.5, 0.72);
      line(0.5, 0.72, 0.84, 0.52);
      break;
    case 'star': {
      // Filled five-point star (favorite). Triangle-fan from the center to each
      // perimeter point — a star is star-shaped about its center, so the fan fills it.
      const cx = 0.5;
      const cy = 0.54;
      const outer = 0.44;
      const inner = 0.18;
      const pts: Vec2[] = [];
      for (let i = 0; i < 10; i++) {
        const ang = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 === 0 ? outer : inner;
        pts.push(p(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r));
      }
      const c = p(cx, cy);
      for (let i = 0; i < 10; i++) dl.triFilled(c, pts[i]!, pts[(i + 1) % 10]!, col);
      break;
    }
    case 'package':
      rect(0.18, 0.32, 0.82, 0.84, 0.06);
      line(0.5, 0.16, 0.18, 0.32);
      line(0.5, 0.16, 0.82, 0.32);
      line(0.5, 0.16, 0.5, 0.58);
      line(0.18, 0.45, 0.82, 0.45);
      break;
    case 'triangle-alert':
      line(0.5, 0.14, 0.1, 0.85);
      line(0.5, 0.14, 0.9, 0.85);
      line(0.1, 0.85, 0.9, 0.85);
      line(0.5, 0.4, 0.5, 0.63);
      dot(0.5, 0.74, 0.045);
      break;
    default:
      dl.rect(p(0.22, 0.22), p(0.78, 0.78), col, 0.12 * size, t);
      dot(0.5, 0.5, 0.06);
      break;
  }
};
