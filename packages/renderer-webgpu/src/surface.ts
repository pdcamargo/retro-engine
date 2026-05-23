/// <reference types="@webgpu/types" />

import type {
  Surface,
  SurfaceConfiguration,
  TextureFormat,
  TextureView,
} from '@retro-engine/renderer-core';

import { wrapTextureView } from './resources';

export const makeSurface = (device: GPUDevice, canvas: HTMLCanvasElement): Surface => {
  const context = canvas.getContext('webgpu');
  if (!context) throw new Error('Canvas does not support a WebGPU context');

  let configuredFormat: TextureFormat | undefined;

  return {
    configure(descriptor: SurfaceConfiguration): void {
      context.configure({
        device,
        format: descriptor.format,
        alphaMode: descriptor.alphaMode ?? 'opaque',
      });
      configuredFormat = descriptor.format;
    },
    resize(width: number, height: number): void {
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
    },
    getCurrentTextureView(): TextureView {
      return wrapTextureView(context.getCurrentTexture().createView());
    },
    get format(): TextureFormat {
      if (configuredFormat === undefined) {
        throw new Error('Surface.format: surface has not been configured yet');
      }
      return configuredFormat;
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
