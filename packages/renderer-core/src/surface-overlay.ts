import type { Surface } from './surface';

/**
 * A backend-agnostic 2D overlay drawn on top of a {@link Surface} after the
 * engine's main render has been submitted for the frame.
 *
 * The overlay owns its own draw submission: implementations composite onto the
 * surface's current texture with a load (not clear) operation, so the engine's
 * frame is preserved underneath. Backends that need a graphics device or render
 * pass obtain them through their own internals; this contract exposes none of
 * that, so engine and tooling code stay backend-neutral and inject an overlay
 * the same way they inject a {@link Renderer}.
 *
 * The bracket is immediate-mode: between {@link beginFrame} and
 * {@link endFrame} the caller issues this frame's UI draw calls against the
 * shared UI context. An implementation backed by an immediate-mode UI library
 * is the expected case, but the contract does not name one.
 */
export interface SurfaceOverlay {
  /**
   * Prepare the overlay to render onto `canvas`. Resolves once the backend is
   * ready to accept per-frame draw calls. Call once, after the renderer it was
   * created from has finished its own initialization.
   */
  init(canvas: HTMLCanvasElement): Promise<void>;

  /**
   * Open a new overlay frame. Issue the frame's UI draw calls after this returns
   * and before {@link endFrame}.
   */
  beginFrame(): void;

  /**
   * Record and submit the overlay's draw for this frame, compositing it onto
   * `surface`'s current texture. Must be paired with a preceding
   * {@link beginFrame}.
   */
  endFrame(surface: Surface): void;

  /** Release backend resources held by the overlay. */
  destroy(): void;
}
