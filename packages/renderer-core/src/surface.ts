import type { TextureFormat } from './formats';
import type { TextureView } from './resources';

/**
 * A presentable surface tied to a canvas. Must be configured before use.
 *
 * The renderer creates this; engine code drives it. After {@link Surface.configure},
 * the surface exposes its current pixel format and backing canvas size so the
 * render-target layer can resolve a surface-backed target without re-reading
 * the canvas.
 */
export interface Surface {
  /** Apply (or re-apply) swapchain configuration. Required before {@link Surface.getCurrentTextureView}. */
  configure(descriptor: SurfaceConfiguration): void;

  /** Resize the backing canvas's swapchain to `width × height` pixels. No-op if unchanged. */
  resize(width: number, height: number): void;

  /** Acquire a view onto the swapchain's current texture. Valid for one frame; do not retain. */
  getCurrentTextureView(): TextureView;

  /** Pixel format the surface was last configured with. Throws if `configure` has not been called. */
  readonly format: TextureFormat;

  /** Current backing canvas width in pixels. */
  readonly width: number;

  /** Current backing canvas height in pixels. */
  readonly height: number;

  destroy(): void;
}

export interface SurfaceConfiguration {
  /** Swapchain texture format. Use {@link Renderer.getPreferredSurfaceFormat} unless you have a reason not to. */
  format: TextureFormat;
  /** How alpha is interpreted when compositing the canvas. Defaults to `'opaque'`. */
  alphaMode?: 'opaque' | 'premultiplied';
}
