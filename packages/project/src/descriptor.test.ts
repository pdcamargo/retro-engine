import { describe, expect, it } from 'bun:test';

import { parseProjectDescriptor } from './descriptor';

const FULL = `formatVersion = 2
projectId = "abc-123"

[project]
name = "My Game"
version = "0.2.0"
engine = "0.0.0"

[build]
entry = "src/game.ts"
editorEntry = "src/editor.ts"

[run]
startupScene = "guid-of-main-scene"
`;

describe('parseProjectDescriptor', () => {
  it('parses a full descriptor', () => {
    const d = parseProjectDescriptor(FULL);
    expect(d).toEqual({
      formatVersion: 2,
      projectId: 'abc-123',
      name: 'My Game',
      version: '0.2.0',
      engine: '0.0.0',
      buildEntry: 'src/game.ts',
      editorEntry: 'src/editor.ts',
      startupScene: 'guid-of-main-scene',
    });
  });

  it('falls back to defaults for a minimal descriptor', () => {
    const d = parseProjectDescriptor('projectId = "x"\n');
    expect(d.formatVersion).toBe(0);
    expect(d.projectId).toBe('x');
    expect(d.version).toBe('0.0.0');
    expect(d.buildEntry).toBe('src/game.ts');
    expect(d.editorEntry).toBeNull();
    expect(d.startupScene).toBeNull();
  });

  it('treats an empty startupScene as null', () => {
    const d = parseProjectDescriptor('[run]\nstartupScene = ""\n');
    expect(d.startupScene).toBeNull();
  });
});
