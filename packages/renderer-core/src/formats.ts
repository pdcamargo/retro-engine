/**
 * Texture / surface formats the HAL recognises.
 *
 * Expand as the engine needs them — every value added here must be mappable to
 * a concrete pixel format in every backend that ships.
 */
export type TextureFormat = 'rgba8unorm' | 'bgra8unorm' | 'rgba16float' | 'depth32float';

/**
 * RGBA clear / fill color, components in `[0, 1]`.
 *
 * Mirrors WebGPU's `GPUColorDict` so backends can pass it straight through.
 */
export interface ClearColor {
  r: number;
  g: number;
  b: number;
  a: number;
}
