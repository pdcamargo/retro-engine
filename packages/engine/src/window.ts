import type { App } from './index';
import { MessageWriter } from './messages';
import type { PluginObject } from './plugin';
import { ResMut } from './system-param';

/**
 * The application window / drawing surface as the engine sees it, kept in sync
 * with the canvas each frame by {@link WindowPlugin}. Read through `Res(Window)`
 * for the logical size (to drive camera aspect, UI layout, pointer math) without
 * reaching for DOM globals — which also keeps game code headless-safe.
 *
 * Runtime state mirrored from the surface (not authored), so it is not serialized.
 * Single-window for now; multi-window is a later follow-up.
 */
export class Window {
  /** Logical (CSS) width in pixels. */
  width = 0;
  /** Logical (CSS) height in pixels. */
  height = 0;
  /** Physical (backing-store) width in pixels — `width × devicePixelRatio`. */
  physicalWidth = 0;
  /** Physical (backing-store) height in pixels. */
  physicalHeight = 0;
  /** Backing pixels per logical pixel. */
  devicePixelRatio = 1;
}

/**
 * Emitted on the frame the window's **logical** size changes (including the
 * first frame it becomes known). Read with `MessageReader(WindowResized)` to
 * react to resizes — reflow UI, recompute a render target, re-letterbox.
 */
export class WindowResized {
  constructor(
    /** New logical width in pixels. */
    readonly width: number,
    /** New logical height in pixels. */
    readonly height: number,
  ) {}
}

/**
 * Fold the surface's physical dimensions + device-pixel-ratio into `window`.
 * Returns `true` when the **logical** size changed (so the caller emits a
 * {@link WindowResized}). Pure; the plugin calls it each frame.
 */
export const syncWindow = (
  window: Window,
  physicalWidth: number,
  physicalHeight: number,
  devicePixelRatio: number,
): boolean => {
  const dpr = devicePixelRatio > 0 ? devicePixelRatio : 1;
  const logicalWidth = Math.max(1, Math.round(physicalWidth / dpr));
  const logicalHeight = Math.max(1, Math.round(physicalHeight / dpr));
  window.physicalWidth = physicalWidth;
  window.physicalHeight = physicalHeight;
  window.devicePixelRatio = dpr;
  if (window.width === logicalWidth && window.height === logicalHeight) return false;
  window.width = logicalWidth;
  window.height = logicalHeight;
  return true;
};

const currentDevicePixelRatio = (): number =>
  typeof globalThis.window !== 'undefined' && globalThis.window.devicePixelRatio > 0
    ? globalThis.window.devicePixelRatio
    : 1;

/**
 * Opt-in plugin that inserts a {@link Window} resource and keeps it in sync with
 * the drawing surface every frame (a `'first'`-stage system, before gameplay
 * reads it), emitting {@link WindowResized} whenever the logical size changes.
 * Headless-safe: with no surface the system no-ops and the resource stays at its
 * defaults.
 */
export class WindowPlugin implements PluginObject {
  name(): string {
    return 'WindowPlugin';
  }

  build(app: App): void {
    if (app.getResource(Window) === undefined) app.insertResource(new Window());
    app.addMessage(WindowResized);
    app.addSystem(
      'first',
      [ResMut(Window), MessageWriter(WindowResized)],
      (win, resized) => {
        const surface = app.getSurface();
        if (surface === undefined) return;
        const w = win as Window;
        if (syncWindow(w, surface.width, surface.height, currentDevicePixelRatio())) {
          (resized as { write(m: WindowResized): void }).write(new WindowResized(w.width, w.height));
        }
      },
      { label: 'window-sync' },
    );
  }
}
