import { describe, expect, it } from 'bun:test';

import { DiagnosticsStore } from '@retro-engine/engine';

import { DiagnosticsText, formatDiagnostics } from './diagnostics-overlay';
import { UiNode } from './ui-node';
import { UiText } from './ui-text';

describe('formatDiagnostics', () => {
  it('formats a compact FPS / frame-time / entity / asset line', () => {
    const store = new DiagnosticsStore();
    store.fps = 59.6;
    store.frameTimeMs = 16.78;
    store.entityCount = 42;
    store.assetCount = 12;
    expect(formatDiagnostics(store)).toBe('FPS 60  16.8ms  ents 42  assets 12');
  });

  it('handles the cold-start zero state', () => {
    expect(formatDiagnostics(new DiagnosticsStore())).toBe('FPS 0  0.0ms  ents 0  assets 0');
  });
});

describe('DiagnosticsText', () => {
  it('is a bare marker meant to sit on a UiText node', () => {
    expect(new DiagnosticsText()).toBeInstanceOf(DiagnosticsText);
    // A diagnostics readout is a text node; UiText auto-attaches a UiNode.
    expect(UiText.requires).toContain(UiNode);
  });
});
