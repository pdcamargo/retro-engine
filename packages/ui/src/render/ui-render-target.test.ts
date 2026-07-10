import { describe, expect, it } from 'bun:test';
import type { App, CameraView } from '@retro-engine/engine';
import type { ResolvedRenderTarget, Surface, TextureView } from '@retro-engine/renderer-core';

import { pickUiCameraView, uiTargetView, UiRenderTargetState } from './ui-render-target';

const view = (sourceEntity: number): CameraView => ({ sourceEntity }) as unknown as CameraView;
const resolved = (tag: string): ResolvedRenderTarget =>
  ({ view: tag as unknown as TextureView, format: 'rgba8unorm', width: 1, height: 1 }) as ResolvedRenderTarget;

describe('pickUiCameraView', () => {
  const views = [view(10), view(11), view(12)];

  it('returns the marked camera that is also the main camera', () => {
    const chosen = pickUiCameraView(new Set([11, 12]), new Set([12]), views);
    expect(chosen?.sourceEntity).toBe(12);
  });

  it('prefers a main UI camera over an earlier non-main one', () => {
    // 10 is marked (earlier in dispatch) but 12 is the main camera → 12 wins.
    const chosen = pickUiCameraView(new Set([10, 12]), new Set([12]), views);
    expect(chosen?.sourceEntity).toBe(12);
  });

  it('falls back to the first marked camera in dispatch order when none is main', () => {
    const chosen = pickUiCameraView(new Set([12, 11]), new Set(), views);
    expect(chosen?.sourceEntity).toBe(11);
  });

  it('returns undefined when no camera is marked', () => {
    expect(pickUiCameraView(new Set(), new Set(), views)).toBeUndefined();
  });

  it('ignores marked entities that have no view this frame', () => {
    expect(pickUiCameraView(new Set([99]), new Set([99]), views)).toBeUndefined();
  });
});

describe('uiTargetView', () => {
  const surfaceView = 'surface-view' as unknown as TextureView;
  const fakeApp = (state: UiRenderTargetState | undefined, hasSurface: boolean): App =>
    ({
      getResource: (ctor: unknown) => (ctor === UiRenderTargetState ? state : undefined),
      getSurface: () => (hasSurface ? ({ getCurrentTextureView: () => surfaceView } as unknown as Surface) : undefined),
    }) as unknown as App;

  it('returns the resolved UI target view when one is set', () => {
    const state = new UiRenderTargetState();
    state.target = resolved('camera-view');
    expect(uiTargetView(fakeApp(state, true))).toBe('camera-view' as unknown as TextureView);
  });

  it('falls back to the surface when no target and overlay fallback is on', () => {
    const state = new UiRenderTargetState(); // overlayFallback defaults true
    expect(uiTargetView(fakeApp(state, true))).toBe(surfaceView);
  });

  it('draws nothing when no target and overlay fallback is off', () => {
    const state = new UiRenderTargetState();
    state.overlayFallback = false;
    expect(uiTargetView(fakeApp(state, true))).toBeUndefined();
  });

  it('draws nothing when the fallback is on but there is no surface (headless)', () => {
    expect(uiTargetView(fakeApp(new UiRenderTargetState(), false))).toBeUndefined();
  });
});
