/** An RGB triple, each channel in the `0..1` range. */
export type Rgb = readonly [r: number, g: number, b: number];

/** An RGBA quadruple, each channel in the `0..1` range. */
export type Rgba = readonly [r: number, g: number, b: number, a: number];

/** A 2D vector, typically a pixel size or offset. */
export type Vec2 = readonly [x: number, y: number];

/** An 8-bit sRGB color (each channel `0..255`), as used by the palette. */
export type Srgb8 = readonly [r: number, g: number, b: number];
