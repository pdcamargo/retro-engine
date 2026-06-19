import { ImGuiImplWeb, type ImTextureRef } from '@mori2003/jsimgui';
import type { AssetSource } from '@retro-engine/assets';
import { type Renderer, type Texture, TextureUsage } from '@retro-engine/renderer-core';
import { GPU_TEXTURE, type InternalTexture } from '@retro-engine/renderer-webgpu';

/** Side of the square master thumbnail; ImGui samples it down for every zoom size. */
const SIZE = 256;
const RGBA = 4;

/**
 * Decode an encoded image (`png`/`jpg`/…) into a centered, aspect-preserved
 * `SIZE×SIZE` RGBA8 buffer via the webview's `createImageBitmap` + `OffscreenCanvas`.
 */
const decodeToSquare = async (bytes: Uint8Array): Promise<Uint8Array> => {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]));
  try {
    const canvas = new OffscreenCanvas(SIZE, SIZE);
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('OffscreenCanvas 2D context unavailable');
    const scale = Math.min(SIZE / bitmap.width, SIZE / bitmap.height);
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    ctx.drawImage(bitmap, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
    return new Uint8Array(ctx.getImageData(0, 0, SIZE, SIZE).data.buffer);
  } finally {
    bitmap.close();
  }
};

/**
 * Generates and caches asset-browser preview textures, keyed by asset GUID. One
 * `SIZE`-px master is rendered per asset and an {@link ImTextureRef} cached for
 * it; the browser samples that single texture at whatever tile size is shown
 * (list → lg). Generation is async and off the frame path: {@link get} returns
 * `undefined` until the master is ready, so the card shows its procedural
 * placeholder meanwhile.
 *
 * v1 generates image thumbnails (decode + downscale). Rendered previews for
 * meshes / scenes / prefabs (an offscreen GPU pass) and a persistent on-disk
 * cache are a follow-up — the `get` contract is unchanged when they land.
 */
export class ThumbnailService {
  private readonly cache = new Map<string, ImTextureRef>();
  private readonly inflight = new Set<string>();
  // Hold the GPU textures so their handles stay valid for the registered refs.
  private readonly textures: Texture[] = [];

  constructor(
    private readonly renderer: Renderer,
    private readonly source: AssetSource,
  ) {}

  /**
   * The cached preview for an asset, or `undefined` while it generates (kicking
   * generation on the first miss). Call from the panel draw each frame.
   */
  get(guid: string, location: string): ImTextureRef | undefined {
    const hit = this.cache.get(guid);
    if (hit !== undefined) return hit;
    if (!this.inflight.has(guid)) {
      this.inflight.add(guid);
      void this.generate(guid, location);
    }
    return undefined;
  }

  private async generate(guid: string, location: string): Promise<void> {
    try {
      const pixels = await decodeToSquare(await this.source.read(location));
      const texture = this.renderer.createTexture({
        width: SIZE,
        height: SIZE,
        format: 'rgba8unorm',
        usage: TextureUsage.TEXTURE_BINDING | TextureUsage.COPY_DST,
        label: `thumb-${guid}`,
      });
      this.renderer.writeTexture(
        { texture },
        pixels as BufferSource,
        { bytesPerRow: SIZE * RGBA, rowsPerImage: SIZE },
        { width: SIZE, height: SIZE, depthOrArrayLayers: 1 },
      );
      this.textures.push(texture);
      this.cache.set(guid, ImGuiImplWeb.RegisterTexture((texture as InternalTexture)[GPU_TEXTURE]));
      console.log(`[studio] thumbnail ready: ${location}`);
    } catch (err) {
      console.warn(`[studio] thumbnail generation failed for ${location}`, err);
    } finally {
      this.inflight.delete(guid);
    }
  }
}
