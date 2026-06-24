import { ImGuiImplWeb, type ImTextureRef } from '@mori2003/jsimgui';
import type { AssetSource } from '@retro-engine/assets';
import { createMeshImporter, decodeRadianceHdrPreview } from '@retro-engine/engine';
import { type Renderer, type Texture, TextureUsage } from '@retro-engine/renderer-core';
import { GPU_TEXTURE, type InternalTexture } from '@retro-engine/renderer-webgpu';

import { renderGltfThumbnail } from './gltf-thumbnail';
import { renderMaterialThumbnail } from './material-thumbnail';
import { renderMeshThumbnail } from './mesh-thumbnail';

/** Side of the square master thumbnail; ImGui samples it down for every zoom size. */
const SIZE = 256;
const RGBA = 4;

const MESH_EXT = /\.rmesh$/i;
const MATERIAL_EXT = /\.remat$/i;
const HDR_EXT = /\.hdr$/i;
const GLTF_EXT = /\.(glb|gltf)$/i;

/** Center an `ImageBitmap` into an aspect-preserved `SIZE×SIZE` RGBA8 buffer. */
const fitToSquare = (bitmap: ImageBitmap): Uint8Array => {
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

/** A bitmap for the source bytes: encoded images decode natively; `.hdr` is
 * decoded + Reinhard-tonemapped to an LDR preview first (floats can't go through
 * `createImageBitmap`). */
const bitmapFor = async (location: string, bytes: Uint8Array): Promise<ImageBitmap> => {
  if (HDR_EXT.test(location)) {
    const p = decodeRadianceHdrPreview(bytes, SIZE);
    return createImageBitmap(new ImageData(new Uint8ClampedArray(p.data), p.width, p.height));
  }
  return createImageBitmap(new Blob([bytes as BlobPart]));
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
  // Guids whose generation threw — kept so a broken asset isn't re-attempted on
  // every frame (the panel calls get() per visible tile each frame).
  private readonly failed = new Set<string>();
  // Hold the GPU textures so their handles stay valid for the registered refs.
  private readonly textures: Texture[] = [];
  // Decoded source pixel dimensions, recorded for image assets as a side effect
  // of generation (the asset picker shows them; the browser does not need them).
  private readonly dims = new Map<string, { w: number; h: number }>();

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
    if (!this.inflight.has(guid) && !this.failed.has(guid)) {
      this.inflight.add(guid);
      void this.generate(guid, location);
    }
    return undefined;
  }

  /** Decoded source pixel size for an image asset, once generated; `undefined` otherwise. */
  dimensionsOf(guid: string): { w: number; h: number } | undefined {
    return this.dims.get(guid);
  }

  private async generate(guid: string, location: string): Promise<void> {
    try {
      const bytes = await this.source.read(location);
      // A `.rmesh` renders a flat-shaded mesh preview, a `.remat` a shaded-sphere
      // material preview; everything else decodes as an image. All paths produce a
      // SIZE×SIZE RGBA8 buffer for the shared upload.
      let pixels: Uint8Array;
      if (MESH_EXT.test(location)) {
        pixels = renderMeshThumbnail(await createMeshImporter()(bytes, undefined as never), SIZE);
      } else if (GLTF_EXT.test(location)) {
        const rendered = await renderGltfThumbnail(location, bytes, SIZE, (loc) => this.source.read(loc));
        // null = a mesh-less glTF (e.g. an animation clip); nothing to preview, so
        // record it as no-preview (the card shows the model icon) without retrying.
        if (rendered === null) {
          this.failed.add(guid);
          return;
        }
        pixels = rendered;
      } else if (MATERIAL_EXT.test(location)) {
        pixels = renderMaterialThumbnail(bytes, SIZE);
      } else {
        const bitmap = await bitmapFor(location, bytes);
        this.dims.set(guid, { w: bitmap.width, h: bitmap.height });
        pixels = fitToSquare(bitmap);
      }
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
      // Mark failed so the per-frame get() doesn't retry (and re-log) endlessly.
      this.failed.add(guid);
      console.warn(`[studio] thumbnail generation failed for ${location}`, err);
    } finally {
      this.inflight.delete(guid);
    }
  }
}
