import { describe, expect, test } from 'bun:test';

import { t, TypeRegistry } from '@retro-engine/reflect';

import { projectStateKey } from './project-state';
import { decodeSettingsToml, encodeSettingsToml } from './settings-toml';

class RenderSettings {
  clearColor = [0, 0, 0, 1];
  targetFps = 60;
  vsync = true;
}

describe('settings TOML codec', () => {
  test('round-trips a reflectable settings resource through human-readable TOML', () => {
    const registry = new TypeRegistry();
    const reg = registry.registerType(RenderSettings, {
      clearColor: t.array(t.number),
      targetFps: t.number,
      vsync: t.boolean,
    });

    const value = new RenderSettings();
    value.clearColor = [0.1, 0.2, 0.3, 1];
    value.targetFps = 30;
    value.vsync = false;

    const toml = encodeSettingsToml(reg, value, registry);
    expect(toml).toContain('targetFps = 30');
    expect(toml).toContain('vsync = false');

    const decoded = decodeSettingsToml(reg, toml, registry) as RenderSettings;
    expect(decoded.targetFps).toBe(30);
    expect(decoded.vsync).toBe(false);
    expect(decoded.clearColor).toEqual([0.1, 0.2, 0.3, 1]);
  });
});

describe('projectStateKey', () => {
  test('namespaces per-project state by project id', () => {
    expect(projectStateKey('abc-123', 'layout')).toBe('retro.studio.project.abc-123.layout');
  });
});
