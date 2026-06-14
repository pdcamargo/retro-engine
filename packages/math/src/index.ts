export * from 'wgpu-matrix';

export * from './aabb';
export * from './frustum';
export * from './plane';
export * from './ray';
export * from './screen-scale';

/** sRGB color with linear alpha. Channels in [0, 1]. */
export interface Color {
  r: number;
  g: number;
  b: number;
  a: number;
}

export const color = (r: number, g: number, b: number, a = 1): Color => ({ r, g, b, a });

export const Colors = {
  black: { r: 0, g: 0, b: 0, a: 1 },
  white: { r: 1, g: 1, b: 1, a: 1 },
  transparent: { r: 0, g: 0, b: 0, a: 0 },
} as const satisfies Record<string, Color>;
