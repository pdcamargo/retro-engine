import { describe, expect, test } from 'bun:test';

import { MCP_PROTOCOL_VERSION, RETRO_STUDIO_SKILL_MD, STUDIO_MCP_DEFAULT_PORT } from './index';

describe('mcp-protocol', () => {
  test('exposes stable constants', () => {
    expect(MCP_PROTOCOL_VERSION).toBeGreaterThan(0);
    expect(STUDIO_MCP_DEFAULT_PORT).toBe(8787);
  });

  test('skill doc carries Claude Code frontmatter', () => {
    expect(RETRO_STUDIO_SKILL_MD.startsWith('---')).toBe(true);
    expect(RETRO_STUDIO_SKILL_MD).toContain('name: retro-studio');
    expect(RETRO_STUDIO_SKILL_MD).toContain('description:');
  });
});
