import type { Handle } from '@retro-engine/assets';
import type { Vec2, Vec4 } from '@retro-engine/math';
import { vec2, vec4 } from '@retro-engine/math';

import { Transform, GlobalTransform } from '../transform';
import { InheritedVisibility, ViewVisibility, Visibility } from '../visibility';

import type { Font } from './font-asset';
import type { TextAlign } from './text-layout';

/** Options accepted by the {@link Text2d} constructor. All fields are optional. */
export interface Text2dOptions {
  /** The string to render. Default `''`. */
  text?: string;
  /** Font asset. `undefined` renders nothing until one is assigned. */
  font?: Handle<Font>;
  /** Rendered em height, in pixels. Default `16`. */
  fontSize?: number;
  /** RGBA tint multiplied with the glyph coverage. Default `(1, 1, 1, 1)`. */
  color?: Vec4;
  /** Horizontal alignment of wrapped/multi-line text. Default `'left'`. */
  align?: TextAlign;
  /** Line spacing override in pixels. Omit to use the font's own line height. */
  lineHeight?: number;
  /** Wrap width in pixels. Omit to break lines only on explicit `\n`. */
  maxWidth?: number;
  /** Extra spacing after every glyph, in pixels. Default `0`. */
  letterSpacing?: number;
  /**
   * Normalised pivot within the text block: `(0, 0)` places the block's
   * top-left at the entity origin, `(1, 1)` its bottom-right, `(0.5, 0.5)` its
   * centre. Default `(0.5, 0.5)`.
   */
  anchor?: Vec2;
}

/**
 * ECS component that renders a string as camera-facing MSDF glyph quads. The
 * entity's `GlobalTransform` controls position, rotation, and scale; glyphs are
 * shaped from the referenced {@link Font} and its atlas.
 *
 * `Text2d` requires `Transform`, `GlobalTransform`, `Visibility`,
 * `InheritedVisibility`, and `ViewVisibility` — spawning `new Text2d(...)` alone
 * auto-attaches the rest via required-component resolution.
 *
 * @example
 * ```ts
 * const font = world.getResource(AssetServer)!.load<Font>('fonts/Roboto.font');
 * cmd.spawn(new Text2d({ text: 'Hello\nworld', font, fontSize: 24, align: 'center' }));
 * ```
 */
export class Text2d {
  text: string;
  font: Handle<Font> | undefined;
  fontSize: number;
  color: Vec4;
  align: TextAlign;
  lineHeight: number | undefined;
  maxWidth: number | undefined;
  letterSpacing: number;
  anchor: Vec2;

  constructor(options: Text2dOptions = {}) {
    this.text = options.text ?? '';
    this.font = options.font;
    this.fontSize = options.fontSize ?? 16;
    this.color = options.color ?? vec4.create(1, 1, 1, 1);
    this.align = options.align ?? 'left';
    this.lineHeight = options.lineHeight;
    this.maxWidth = options.maxWidth;
    this.letterSpacing = options.letterSpacing ?? 0;
    this.anchor = options.anchor ?? vec2.create(0.5, 0.5);
  }

  static readonly requires = [
    Transform,
    GlobalTransform,
    Visibility,
    InheritedVisibility,
    ViewVisibility,
  ];
}
