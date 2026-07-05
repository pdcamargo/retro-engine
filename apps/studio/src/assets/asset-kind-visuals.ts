import type { IconName, Tone } from '@retro-engine/editor-sdk';

/** An icon / tag / tone triple that overrides the browser-type defaults for a card. */
export interface KindVisual {
  readonly icon: IconName;
  readonly tag: string;
  readonly tone: Tone;
}

/**
 * Per-asset-kind card visuals, keyed by manifest kind (`BrowserAsset.meta`). Several
 * kinds share one browser {@link AssetType} bucket (animation controller, clip, and
 * mask all live under `'animation'`), so the type-derived icon/tag/tone alone can't
 * tell them apart. An entry here gives that kind a distinct look while it stays in
 * the same filter bucket.
 */
export const ASSET_KIND_VISUALS: Readonly<Record<string, KindVisual>> = {
  AnimationController: { icon: 'workflow', tag: 'CTRL', tone: 'accent' },
  AnimationClip: { icon: 'film', tag: 'CLIP', tone: 'warning' },
  AvatarMask: { icon: 'venetian-mask', tag: 'MASK', tone: 'info' },
};
