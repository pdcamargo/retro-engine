import { ImGuiImplWeb, type ImTextureRef } from '@mori2003/jsimgui';
import type { AssetSource } from '@retro-engine/assets';
import { createMeshImporter, decodeRadianceHdrPreview } from '@retro-engine/engine';
import { type Renderer, type Texture, TextureUsage } from '@retro-engine/renderer-core';
import { GPU_TEXTURE, type InternalTexture } from '@retro-engine/renderer-webgpu';

import { renderGltfThumbnail } from './gltf-thumbnail';
import { type PreviewTexture, renderMaterialThumbnail } from './material-thumbnail';
import { renderMeshThumbnail } from './mesh-thumbnail';
import { renderPrefabThumbnail } from './prefab-thumbnail';
import type { ThumbnailRenderService } from './thumbnail-render-service';

/** Side of the square master thumbnail; ImGui samples it down for every zoom size. */
const SIZE = 256;
const RGBA = 4;

const MESH_EXT = /\.rmesh$/i;
const MATERIAL_EXT = /\.remat$/i;
const HDR_EXT = /\.hdr$/i;
const GLTF_EXT = /\.(glb|gltf)$/i;
const PREFAB_EXT = /\.prefab$/i;

/** Manifest kind for a renderable asset location, or undefined if the CPU path owns it. */
const renderKindFor = (location: string): string | undefined => {
  if (PREFAB_EXT.test(location)) return 'Prefab';
  if (GLTF_EXT.test(location)) return 'Gltf';
  if (MESH_EXT.test(location)) return 'Mesh';
  return undefined;
};

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

/** Decode an `ImageBitmap` to RGBA8 pixels (downscaled, aspect-preserved) for CPU sampling. */
const bitmapToRgba = (bitmap: ImageBitmap, maxSide = 192): PreviewTexture => {
  try {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (ctx === null) throw new Error('OffscreenCanvas 2D context unavailable');
    ctx.drawImage(bitmap, 0, 0, width, height);
    return { data: new Uint8Array(ctx.getImageData(0, 0, width, height).data.buffer), width, height };
  } finally {
    bitmap.close();
  }
};

/** The `baseColorTexture` GUID a `.remat` references, or `undefined`. */
const baseColorTextureGuid = (bytes: Uint8Array): string | undefined => {
  try {
    const file = JSON.parse(new TextDecoder().decode(bytes)) as { material?: { data?: Record<string, unknown> } };
    const g = file.material?.data?.baseColorTexture;
    return typeof g === 'string' && g.length > 0 ? g : undefined;
  } catch {
    return undefined;
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
    /** Resolve an asset GUID to its project location — lets a material thumbnail show its base-color texture. */
    private readonly resolveLocation?: (guid: string) => string | undefined,
    /** Renders prefab/model/mesh previews in-engine (materials + lighting); CPU path is the fallback. */
    private readonly render?: ThumbnailRenderService,
  ) {}

  /**
   * Drop a cached thumbnail so the next {@link get} regenerates it — call when an
   * asset's bytes change (e.g. a material edited + saved), so its preview refreshes.
   */
  invalidate(guid: string): void {
    this.cache.delete(guid);
    this.failed.delete(guid);
    this.dims.delete(guid);
    this.inflight.delete(guid);
  }

  /**
   * The cached preview for an asset, or `undefined` while it generates (kicking
   * generation on the first miss). Call from the panel draw each frame.
   */
  get(guid: string, location: string): ImTextureRef | undefined {
    // Prefer the in-engine render (real materials + lighting) for renderable
    // kinds; while it renders, fall through to the CPU thumbnail as a placeholder.
    if (this.render !== undefined) {
      const kind = renderKindFor(location);
      if (kind !== undefined) {
        const rendered = this.render.get(guid, kind);
        if (rendered !== undefined) return rendered;
      }
    }
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
      } else if (PREFAB_EXT.test(location)) {
        const rendered = await renderPrefabThumbnail(
          bytes,
          SIZE,
          (loc) => this.source.read(loc),
          (g) => this.resolveLocation?.(g),
        );
        if (rendered === null) {
          this.failed.add(guid);
          return;
        }
        pixels = rendered;
      } else if (MATERIAL_EXT.test(location)) {
        pixels = await this.materialPreview(bytes);
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

  /**
   * A `.remat` preview: the analytic material sphere, with its base-color texture
   * sampled onto the sphere when it has one (so it reads as the same kind of
   * preview as an untextured material, just textured — not the raw flat image).
   */
  private async materialPreview(bytes: Uint8Array): Promise<Uint8Array> {
    const texGuid = baseColorTextureGuid(bytes);
    const texLocation = texGuid !== undefined ? this.resolveLocation?.(texGuid) : undefined;
    let texture: PreviewTexture | undefined;
    if (texLocation !== undefined) {
      try {
        texture = bitmapToRgba(await bitmapFor(texLocation, await this.source.read(texLocation)));
      } catch {
        // Texture unreadable/undecodable — render the untextured sphere.
      }
    }
    return renderMaterialThumbnail(bytes, SIZE, texture);
  }
}
