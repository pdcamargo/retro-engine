import { ImGuiImplWeb, type ImTextureRef } from '@mori2003/jsimgui';
import {
  type Renderer,
  type Texture,
  type TextureFormat,
  TextureUsage,
} from '@retro-engine/renderer-core';
import { GPU_TEXTURE, type InternalTexture } from '@retro-engine/renderer-webgpu';

/** Pixel size a viewport starts at before its panel reports a real content size. */
const DEFAULT_W = 1280;
const DEFAULT_H = 720;

/**
 * An offscreen color target a 3D camera renders into, surfaced inside an ImGui
 * panel via {@link ImTextureRef}. One instance backs one editor viewport (the
 * Scene tab gets one, the Game tab another), so the tabs are independent views.
 *
 * The texture is (re)allocated to match the panel's content region; the owning
 * camera's render target is swapped to the new texture by a resize system that
 * polls {@link consumeResized}. `localMouse` / `visibleThisFrame` are written by
 * the panel each frame and exist for a future viewport ray-pick (panel-local
 * cursor → world ray); nothing consumes them yet.
 */
export class ViewportTarget {
  /** The current render-target texture, or `null` until {@link init} runs. */
  texture: Texture | null = null;
  /** The ImGui handle for {@link texture}, or `null` until first registered. */
  ref: ImTextureRef | null = null;
  width = DEFAULT_W;
  height = DEFAULT_H;
  /** Set true by the panel on any frame its body runs (i.e. the tab is visible). */
  visibleThisFrame = false;
  /** Cursor position relative to the panel's top-left, or `null` when outside. */
  localMouse: readonly [number, number] | null = null;

  private renderer: Renderer | null = null;
  private format: TextureFormat = 'rgba8unorm';
  private stale: Texture | null = null;

  /**
   * Allocate the first texture. Call once after the renderer's device is ready
   * (e.g. from a startup system) and before spawning the camera that targets it.
   */
  init(renderer: Renderer): void {
    this.renderer = renderer;
    this.format = renderer.getPreferredSurfaceFormat();
    this.allocate();
  }

  /**
   * Match the texture to the panel's content size. Call every frame from the
   * panel body with the integer pixel size from `ui.contentAvail()`. No-ops when
   * the size is unchanged; registers the ImGui handle lazily on first sight (the
   * ImGui frame must be active, which it is inside a panel draw).
   */
  ensureSize(w: number, h: number): void {
    if (this.renderer === null) return;
    if (w > 0 && h > 0 && (w !== this.width || h !== this.height)) {
      this.width = w;
      this.height = h;
      this.allocate();
    }
    if (this.ref === null && this.texture !== null) {
      this.ref = ImGuiImplWeb.RegisterTexture(
        (this.texture as InternalTexture)[GPU_TEXTURE],
      );
    }
  }

  /**
   * The pre-resize texture, returned exactly once after a reallocation (then
   * cleared). A redirect system uses it to re-point whichever camera was
   * rendering into this viewport at the new {@link texture}, identifying the
   * camera by the texture it holds rather than by any editor-owned marker.
   */
  takeStale(): Texture | null {
    const s = this.stale;
    this.stale = null;
    return s;
  }

  private allocate(): void {
    const renderer = this.renderer;
    if (renderer === null) return;
    const previous = this.texture;
    this.texture = renderer.createTexture({
      width: this.width,
      height: this.height,
      format: this.format,
      usage: TextureUsage.RENDER_ATTACHMENT | TextureUsage.TEXTURE_BINDING,
      label: 'studio-viewport',
    });
    // Force a fresh ImGui handle for the new GPUTexture on the next ensureSize.
    this.ref = null;
    if (previous !== null) {
      // Keep the prior texture's identity for one cycle so the redirect system
      // can match the camera still pointing at it; the GPU resource is freed.
      this.stale = previous;
      previous.destroy();
    }
  }
}
