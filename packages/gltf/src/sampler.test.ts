import { describe, expect, it } from 'bun:test';

import { mapSampler } from './sampler';

describe('mapSampler', () => {
  it('defaults to repeat addressing + linear filtering when absent', () => {
    expect(mapSampler()).toEqual({
      addressModeU: 'repeat',
      addressModeV: 'repeat',
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
    });
  });

  it('maps wrap enums', () => {
    expect(mapSampler({ wrapS: 33071, wrapT: 33648 })).toMatchObject({
      addressModeU: 'clamp-to-edge',
      addressModeV: 'mirror-repeat',
    });
    expect(mapSampler({ wrapS: 10497 })).toMatchObject({ addressModeU: 'repeat' });
  });

  it('maps mag filter enums', () => {
    expect(mapSampler({ magFilter: 9728 }).magFilter).toBe('nearest');
    expect(mapSampler({ magFilter: 9729 }).magFilter).toBe('linear');
  });

  it('splits min-filter enums into min + mipmap filters', () => {
    expect(mapSampler({ minFilter: 9728 })).toMatchObject({
      minFilter: 'nearest',
      mipmapFilter: 'linear',
    });
    expect(mapSampler({ minFilter: 9984 })).toMatchObject({
      minFilter: 'nearest',
      mipmapFilter: 'nearest',
    });
    expect(mapSampler({ minFilter: 9985 })).toMatchObject({
      minFilter: 'linear',
      mipmapFilter: 'nearest',
    });
    expect(mapSampler({ minFilter: 9986 })).toMatchObject({
      minFilter: 'nearest',
      mipmapFilter: 'linear',
    });
    expect(mapSampler({ minFilter: 9987 })).toMatchObject({
      minFilter: 'linear',
      mipmapFilter: 'linear',
    });
  });
});
