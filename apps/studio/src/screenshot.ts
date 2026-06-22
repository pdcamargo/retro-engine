// Screenshot capture for the MCP `screenshot.*` commands. The editor renders into
// a single WebGPU canvas; the whole window is `canvas.toDataURL()`, and a panel is
// a crop of that canvas to the panel's last-drawn ImGui window rect.
//
// Capturing a docked, tabbed panel needs its tab active, so we focus it, render,
// crop, then restore whichever tab was active before — a screenshot never changes
// what the user is looking at.

import { ImGui } from '@mori2003/jsimgui';
import type { CaptureResult, CaptureService } from '@retro-engine/editor-mcp';
import type { Editor, EditorContext, PanelDef } from '@retro-engine/editor-sdk';
import type { App } from '@retro-engine/engine';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const DEFAULT_MAX_WIDTH = 1280;

/** A panel's window rectangle in canvas (physical) pixels, plus when it last rendered. */
export interface PanelRect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** `performance.now()` of the last frame this panel's body drew — only the active tab of a group draws. */
  seen: number;
}

/** Crop+scale a region of the source canvas into a base64 PNG (no data: prefix). */
const encodeRegion = (
  source: HTMLCanvasElement,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  maxWidth: number,
): CaptureResult => {
  const cap = maxWidth > 0 ? maxWidth : DEFAULT_MAX_WIDTH;
  const scale = sw > cap ? cap / sw : 1;
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));
  const out = document.createElement('canvas');
  out.width = dw;
  out.height = dh;
  const ctx2d = out.getContext('2d');
  if (ctx2d === null) throw new Error('screenshot: 2D context unavailable');
  ctx2d.drawImage(source, sx, sy, sw, sh, 0, 0, dw, dh);
  const url = out.toDataURL('image/png');
  return { image: url.slice(url.indexOf(',') + 1), mimeType: 'image/png', width: dw, height: dh };
};

const sameNode = (a: PanelRect, b: PanelRect): boolean =>
  Math.abs(a.x - b.x) < 4 && Math.abs(a.y - b.y) < 4 && Math.abs(a.w - b.w) < 4 && Math.abs(a.h - b.h) < 4;

/**
 * Build the {@link CaptureService} the MCP commands use. `rects` is populated each
 * frame by {@link recordPanelRect}. The editor canvas is captured whole; a panel is
 * focused (selecting its dock tab), cropped, then the previously-active tab in its
 * group is refocused so the user's view is left unchanged.
 */
export const createCaptureService = (
  canvas: HTMLCanvasElement,
  rects: Map<string, PanelRect>,
  editor: Editor,
  app: App,
): CaptureService => {
  // Render frames on demand. The engine's rAF loop is paused while the window is
  // backgrounded, so we step it ourselves to apply a focus change and refresh the
  // canvas, then let the GPU present before reading it back.
  const renderAndSettle = async (frames: number): Promise<void> => {
    for (let i = 0; i < frames; i += 1) app.advanceFrame();
    await sleep(40);
  };
  return {
    editor: async (maxWidth = DEFAULT_MAX_WIDTH): Promise<CaptureResult> => {
      await renderAndSettle(1);
      return encodeRegion(canvas, 0, 0, canvas.width, canvas.height, maxWidth);
    },
    panel: async (id, maxWidth = DEFAULT_MAX_WIDTH): Promise<CaptureResult | null> => {
      const targetRect = rects.get(id);
      if (targetRect === undefined) return null;
      // The tab currently active in this dock group is the group member that drew
      // most recently — remember it so we can put it back after capturing.
      const group = [...rects.entries()].filter(([, r]) => sameNode(r, targetRect));
      let priorActive = id;
      let newest = -1;
      for (const [pid, r] of group) {
        if (r.seen > newest) {
          newest = r.seen;
          priorActive = pid;
        }
      }
      editor.focusPanel(id);
      try {
        await renderAndSettle(2);
        const r = rects.get(id) ?? targetRect;
        const sx = Math.max(0, Math.round(r.x));
        const sy = Math.max(0, Math.round(r.y));
        const sw = Math.min(canvas.width - sx, Math.round(r.w));
        const sh = Math.min(canvas.height - sy, Math.round(r.h));
        if (sw <= 0 || sh <= 0) return null;
        return encodeRegion(canvas, sx, sy, sw, sh, maxWidth);
      } finally {
        if (priorActive !== id) {
          editor.focusPanel(priorActive);
          await renderAndSettle(1);
        }
      }
    },
    panelIds: () => [...rects.keys()],
  };
};

/**
 * Wrap a panel so it records its window rect (in canvas pixels) and render time
 * after drawing — the source of truth for panel screenshots and for which tab of a
 * group is active. ImGui reports logical coordinates; the canvas-to-display ratio
 * converts them to physical pixels.
 */
export const recordPanelRect = (def: PanelDef, rects: Map<string, PanelRect>, canvas: HTMLCanvasElement): PanelDef => ({
  ...def,
  render: (ctx: EditorContext): void => {
    def.render(ctx);
    const pos = ImGui.GetWindowPos();
    const size = ImGui.GetWindowSize();
    const io = ImGui.GetIO();
    const display = io.DisplaySize;
    const scaleX = display.x > 0 ? canvas.width / display.x : 1;
    const scaleY = display.y > 0 ? canvas.height / display.y : 1;
    rects.set(def.id, {
      x: pos.x * scaleX,
      y: pos.y * scaleY,
      w: size.x * scaleX,
      h: size.y * scaleY,
      seen: performance.now(),
    });
  },
});
