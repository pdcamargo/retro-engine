import { describe, expect, it } from 'bun:test';

import { ColorWrite } from './pipeline';
import type {
  BlendComponent,
  BlendState,
  ColorTargetState,
  ColorWriteFlags,
  DepthStencilState,
  StencilFaceState,
  StencilOperation,
} from './pipeline';

describe('ColorWrite', () => {
  it('exposes the four channel bits and an ALL alias', () => {
    expect(ColorWrite.RED).toBe(0x1);
    expect(ColorWrite.GREEN).toBe(0x2);
    expect(ColorWrite.BLUE).toBe(0x4);
    expect(ColorWrite.ALPHA).toBe(0x8);
    expect(ColorWrite.ALL).toBe(0xf);
  });

  it('combines via bitwise OR', () => {
    const rgbOnly: ColorWriteFlags = ColorWrite.RED | ColorWrite.GREEN | ColorWrite.BLUE;
    expect(rgbOnly & ColorWrite.RED).not.toBe(0);
    expect(rgbOnly & ColorWrite.ALPHA).toBe(0);
  });
});

describe('Pipeline descriptor structural shapes', () => {
  it('DepthStencilState accepts only the depth half (default opaque pipeline)', () => {
    const ds: DepthStencilState = {
      format: 'depth32float',
      depthWriteEnabled: true,
      depthCompare: 'less',
    };
    expect(ds.format).toBe('depth32float');
    expect(ds.stencilFront).toBeUndefined();
    expect(ds.depthBias).toBeUndefined();
  });

  it('DepthStencilState accepts the full stencil + depth-bias surface', () => {
    const front: StencilFaceState = {
      compare: 'equal',
      passOp: 'replace',
    };
    const op: StencilOperation = 'increment-clamp';
    const ds: DepthStencilState = {
      format: 'depth24plus-stencil8',
      depthWriteEnabled: false,
      depthCompare: 'less-equal',
      stencilFront: front,
      stencilBack: { compare: 'always', failOp: op },
      stencilReadMask: 0xff,
      stencilWriteMask: 0xff,
      depthBias: 4,
      depthBiasSlopeScale: 1.5,
      depthBiasClamp: 0,
    };
    expect(ds.stencilFront?.compare).toBe('equal');
    expect(ds.stencilBack?.failOp).toBe('increment-clamp');
    expect(ds.depthBiasSlopeScale).toBe(1.5);
  });

  it('ColorTargetState accepts the canonical premultiplied-alpha blend', () => {
    const blend: BlendState = {
      color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    };
    const target: ColorTargetState = {
      format: 'rgba8unorm',
      blend,
      writeMask: ColorWrite.ALL,
    };
    expect(target.blend?.color.dstFactor).toBe('one-minus-src-alpha');
    expect(target.writeMask).toBe(0xf);
  });

  it('BlendComponent defaults are inert ("no blend")', () => {
    const noop: BlendComponent = {};
    expect(noop.operation).toBeUndefined();
    expect(noop.srcFactor).toBeUndefined();
    expect(noop.dstFactor).toBeUndefined();
  });
});
