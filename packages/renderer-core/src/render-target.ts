import type { TextureFormat } from './formats';
import type { Texture, TextureView, TextureViewDescriptor } from './resources';
import type { Surface } from './surface';

/**
 * Where a camera (or any render-pass producer) draws to.
 *
 * Phase 1 ships all three variants; cameras and offscreen passes consume the
 * `texture` and `view` variants in later phases. The `surface` variant
 * targets the swapchain — the common case until offscreen rendering lands.
 *
 * Each variant resolves through {@link Renderer.resolveRenderTarget} to a
 * {@link ResolvedRenderTarget} carrying the actual GPU view plus the metadata
 * a render pass needs (format, dimensions).
 */
export type RenderTarget =
  | { readonly kind: 'surface'; readonly surface: Surface }
  | {
      readonly kind: 'texture';
      readonly texture: Texture;
      readonly viewDescriptor?: TextureViewDescriptor;
    }
  | {
      readonly kind: 'view';
      readonly view: TextureView;
      readonly format: TextureFormat;
      readonly width: number;
      readonly height: number;
    };

/**
 * The result of resolving a {@link RenderTarget} for the current frame.
 *
 * `view` is valid for the frame the resolve happened on; do not retain across
 * frames. For surface variants, `view` is freshly acquired each call.
 */
export interface ResolvedRenderTarget {
  readonly view: TextureView;
  readonly format: TextureFormat;
  readonly width: number;
  readonly height: number;
}
