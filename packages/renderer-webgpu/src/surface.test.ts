/// <reference types="@webgpu/types" />

import { describe, expect, it } from 'bun:test';

import type { TextureFormat } from '@retro-engine/renderer-core';

import { makeSurface } from './surface';

interface CapturedConfigure {
  readonly format: GPUTextureFormat;
  readonly alphaMode: GPUCanvasAlphaMode | undefined;
  readonly viewFormats: readonly GPUTextureFormat[] | undefined;
}

interface CapturedCreateView {
  readonly format: GPUTextureFormat | undefined;
}

interface SurfaceTestRig {
  canvas: HTMLCanvasElement;
  configureCalls: CapturedConfigure[];
  createViewCalls: CapturedCreateView[];
}

const makeRig = (): SurfaceTestRig => {
  const configureCalls: CapturedConfigure[] = [];
  const createViewCalls: CapturedCreateView[] = [];

  const stubView = { destroy: (): void => undefined } as unknown as GPUTextureView;
  const stubTexture = {
    createView(descriptor?: GPUTextureViewDescriptor): GPUTextureView {
      createViewCalls.push({ format: descriptor?.format });
      return stubView;
    },
  } as unknown as GPUTexture;

  const context = {
    configure(descriptor: GPUCanvasConfiguration): void {
      configureCalls.push({
        format: descriptor.format,
        alphaMode: descriptor.alphaMode,
        viewFormats: descriptor.viewFormats === undefined ? undefined : [...descriptor.viewFormats],
      });
    },
    unconfigure(): void {},
    getCurrentTexture(): GPUTexture {
      return stubTexture;
    },
  } as unknown as GPUCanvasContext;

  const canvas = {
    width: 0,
    height: 0,
    getContext(kind: string): GPUCanvasContext | null {
      return kind === 'webgpu' ? context : null;
    },
  } as unknown as HTMLCanvasElement;

  return { canvas, configureCalls, createViewCalls };
};

const stubDevice = {} as unknown as GPUDevice;

const expectSurfaceConfiguredAs = (
  storageFormat: TextureFormat,
  viewFormat: TextureFormat,
): void => {
  const rig = makeRig();
  const surface = makeSurface(stubDevice, rig.canvas);

  surface.configure({ format: storageFormat });

  expect(rig.configureCalls).toHaveLength(1);
  expect(rig.configureCalls[0]!.format).toBe(storageFormat);
  expect(rig.configureCalls[0]!.alphaMode).toBe('opaque');
  expect(rig.configureCalls[0]!.viewFormats).toEqual([viewFormat]);
  expect(surface.format).toBe(viewFormat);

  surface.getCurrentTextureView();
  expect(rig.createViewCalls).toHaveLength(1);
  expect(rig.createViewCalls[0]!.format).toBe(viewFormat);
};

describe('makeSurface', () => {
  it('configures bgra8unorm storage with bgra8unorm-srgb view + viewFormats', () => {
    expectSurfaceConfiguredAs('bgra8unorm', 'bgra8unorm-srgb');
  });

  it('configures rgba8unorm storage with rgba8unorm-srgb view + viewFormats', () => {
    expectSurfaceConfiguredAs('rgba8unorm', 'rgba8unorm-srgb');
  });

  it('throws on format access before configure()', () => {
    const rig = makeRig();
    const surface = makeSurface(stubDevice, rig.canvas);
    expect(() => surface.format).toThrow(/has not been configured yet/);
  });

  it('throws on getCurrentTextureView before configure()', () => {
    const rig = makeRig();
    const surface = makeSurface(stubDevice, rig.canvas);
    expect(() => surface.getCurrentTextureView()).toThrow(/has not been configured yet/);
  });

  it('forwards alphaMode override to context.configure', () => {
    const rig = makeRig();
    const surface = makeSurface(stubDevice, rig.canvas);
    surface.configure({ format: 'bgra8unorm', alphaMode: 'premultiplied' });
    expect(rig.configureCalls[0]!.alphaMode).toBe('premultiplied');
  });
});
