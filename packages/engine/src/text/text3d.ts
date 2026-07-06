import type { Handle } from '@retro-engine/assets';
import type { Vec2, Vec4 } from '@retro-engine/math';
import { vec2, vec4 } from '@retro-engine/math';

import { Transform, GlobalTransform } from '../transform';
import { InheritedVisibility, ViewVisibility, Visibility } from '../visibility';

import type { Font } from './font-asset';
import type { TextAlign } from './text-layout';

/** Options accepted by the {@link Text} constructor. All fields are optional. */
export interface TextOptions {
  /** The string to render. Default `''`. */
  text?: string;
  /** Font asset. `undefined` renders nothing until one is assigned. */
  font?: Handle<Font>;
  /**
   * Rendered em height, in the entity's local units. Text is laid out in "pixel"
   * units then placed on the entity's plane, so pair a large `fontSize` with a
   * small `Transform` scale (e.g. `fontSize: 64`, `scale: 0.01`) for world text.
   * Default `16`.
   */
  fontSize?: number;
  /** RGBA tint multiplied with the glyph coverage. Default `(1, 1, 1, 1)`. */
  color?: Vec4;
  /** Horizontal alignment of wrapped/multi-line text. Default `'left'`. */
  align?: TextAlign;
  /** Line spacing override. Omit to use the font's own line height. */
  lineHeight?: number;
  /** Wrap width. Omit to break lines only on explicit `\n`. */
  maxWidth?: number;
  /** Extra spacing after every glyph. Default `0`. */
  letterSpacing?: number;
  /**
   * Normalised pivot within the text block: `(0, 0)` places the block's
   * top-left at the entity origin, `(0.5, 0.5)` its centre. Default `(0.5, 0.5)`.
   */
  anchor?: Vec2;
}

/**
 * ECS component that renders a string as MSDF glyph quads in the **3D world**.
 * The entity's `GlobalTransform` positions and orients the text on its local
 * plane (local +X = reading direction, local +Y = up); it is drawn through a 3D
 * (perspective) camera and depth-tested against the scene, so a label behind
 * geometry is occluded. For screen-space 2D text use `Text2d`; for in-game UI use
 * `@retro-engine/ui`'s `UiText`.
 *
 * Requires `Transform`, `GlobalTransform`, `Visibility`, `InheritedVisibility`,
 * and `ViewVisibility` — spawning `new Text(...)` alone auto-attaches the rest.
 *
 * @example
 * ```ts
 * cmd.spawn(
 *   new Text({ text: 'SIGN', font, fontSize: 64, anchor: vec2.create(0.5, 0.5) }),
 *   new Transform(vec3.create(0, 1, -3), quat.identity(), vec3.create(0.01, 0.01, 0.01)),
 * );
 * ```
 */
export class Text {
  text: string;
  font: Handle<Font> | undefined;
  fontSize: number;
  color: Vec4;
  align: TextAlign;
  lineHeight: number | undefined;
  maxWidth: number | undefined;
  letterSpacing: number;
  anchor: Vec2;

  constructor(options: TextOptions = {}) {
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
