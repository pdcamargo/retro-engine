/// <reference types="@webgpu/types" />

import type {
  SurfaceConfiguration,
  TextureFormat,
  TextureView,
} from '@retro-engine/renderer-core';
import { srgbVariantOf } from '@retro-engine/renderer-core';

import { wrapTextureView } from './resources';
import { GPU_SURFACE_CONTEXT, type InternalSurface } from './symbols';

export const makeSurface = (device: GPUDevice, canvas: HTMLCanvasElement): InternalSurface => {
  const context = canvas.getContext('webgpu');
  if (!context) throw new Error('Canvas does not support a WebGPU context');

  let viewFormat: TextureFormat | undefined;

  return {
    [GPU_SURFACE_CONTEXT]: context,
    configure(descriptor: SurfaceConfiguration): void {
      const storageFormat = descriptor.format;
      const srgbView = srgbVariantOf(storageFormat);
      context.configure({
        device,
        format: storageFormat,
        alphaMode: descriptor.alphaMode ?? 'opaque',
        viewFormats: [srgbView],
      });
      viewFormat = srgbView;
    },
    resize(width: number, height: number): void {
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
    },
    getCurrentTextureView(): TextureView {
      if (viewFormat === undefined) {
        throw new Error('Surface.getCurrentTextureView: surface has not been configured yet');
      }
      return wrapTextureView(context.getCurrentTexture().createView({ format: viewFormat }));
    },
    get format(): TextureFormat {
      if (viewFormat === undefined) {
        throw new Error('Surface.format: surface has not been configured yet');
      }
      return viewFormat;
    },
    get width(): number {
      return canvas.width;
    },
    get height(): number {
      return canvas.height;
    },
    destroy(): void {
      context.unconfigure();
    },
  };
};
