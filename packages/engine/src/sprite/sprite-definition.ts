import type { Vec2 } from '@retro-engine/math';
import { vec2 } from '@retro-engine/math';

import type { SpriteAnchor } from './sprite';
import type { BorderRect } from './texture-slicer';
import {
  TextureAtlasLayout,
  type TextureAtlasRect,
} from './texture-atlas-layout';

/** Default pixels-per-unit — 100px = 1 world unit, matching the common 2D convention. */
export const DEFAULT_PPU = 100;

/** Grid slicing source for a {@link SpriteDefinition} (see `TextureAtlasLayout.fromGrid`). */
export interface SpriteGridSource {
  readonly kind: 'grid';
  readonly tileSize: Vec2;
  readonly columns: number;
  readonly rows: number;
  readonly padding?: Vec2;
  readonly offset?: Vec2;
}

/** Manual pixel-rect slicing source for a {@link SpriteDefinition} (see `TextureAtlasLayout.fromRects`). */
export interface SpriteRectsSource {
  readonly kind: 'rects';
  readonly size: Vec2;
  readonly rects: readonly TextureAtlasRect[];
}

/** Per-slice authoring overrides, indexed to match the layout's rect order. */
export interface SpriteSliceDef {
  /** Identifier for the slice (sub-asset label); defaults to its index. */
  readonly name?: string;
  /** Pivot / anchor for this slice; defaults to `'center'`. */
  readonly pivot?: SpriteAnchor;
  /** 9-slice border, in source pixels; omitted means no 9-slicing. */
  readonly border?: BorderRect;
}

/**
 * How a texture is carved into sprites — the serializable `.meta` shape a Sprite
 * Editor authors. `mode` mirrors Unity's Single / Multiple. `source` picks grid
 * or manual-rect slicing; `ppu` sizes each slice into world units
 * (`pixelSize / ppu`); `slices` carries per-sprite pivot / border / name.
 */
export interface SpriteDefinition {
  readonly mode: 'single' | 'multiple';
  readonly source: SpriteGridSource | SpriteRectsSource;
  /** Pixels per world unit. Default {@link DEFAULT_PPU}. */
  readonly ppu?: number;
  /** Per-slice overrides, indexed like the resolved layout. */
  readonly slices?: readonly SpriteSliceDef[];
}

/** One resolved sprite: its layout index metadata, world-size inputs, and authoring props. */
export interface ResolvedSprite {
  readonly name: string;
  readonly pivot: SpriteAnchor;
  readonly ppu: number;
  /** Slice dimensions in source pixels — divide by `ppu` for the world `customSize`. */
  readonly pixelSize: Vec2;
  readonly border?: BorderRect;
}

/** The layout carving a definition plus its per-sprite resolved metadata (index-aligned). */
export interface ResolvedSpriteDefinition {
  readonly layout: TextureAtlasLayout;
  readonly sprites: readonly ResolvedSprite[];
}

/**
 * Resolve a {@link SpriteDefinition} into a {@link TextureAtlasLayout} (via
 * `fromGrid` / `fromRects`) plus one {@link ResolvedSprite} per slice, carrying
 * the pivot, ppu, pixel size (for `customSize = pixelSize / ppu`), and any
 * 9-slice border. Pure — the authoring / sub-asset-minting layer's core, and
 * validation (positive dims) is delegated to the layout factories.
 */
export const resolveSpriteDefinition = (def: SpriteDefinition): ResolvedSpriteDefinition => {
  const layout =
    def.source.kind === 'grid'
      ? TextureAtlasLayout.fromGrid(def.source)
      : TextureAtlasLayout.fromRects(def.source);
  const ppu = def.ppu ?? DEFAULT_PPU;
  const size = layout.size;
  const sprites: ResolvedSprite[] = layout.textures.map((rect, i) => {
    const slice = def.slices?.[i];
    const pixelSize = vec2.create(
      ((rect.max[0] as number) - (rect.min[0] as number)) * (size[0] as number),
      ((rect.max[1] as number) - (rect.min[1] as number)) * (size[1] as number),
    );
    return {
      name: slice?.name ?? `${i}`,
      pivot: slice?.pivot ?? 'center',
      ppu,
      pixelSize,
      ...(slice?.border !== undefined ? { border: slice.border } : {}),
    };
  });
  return { layout, sprites };
};
