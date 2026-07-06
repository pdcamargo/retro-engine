import { describe, expect, it } from 'bun:test';

import { emitWebBoot } from './web-boot';

describe('emitWebBoot', () => {
  it('imports the user entry as a default import and calls bootWebGame', () => {
    const src = emitWebBoot({ userEntry: './game.ts' });
    expect(src).toContain('import definition from "./game.ts";');
    expect(src).toContain("import { bootWebGame } from '@retro-engine/runtime-web';");
    expect(src).toContain('bootWebGame(definition, {"canvas":"game"})');
    expect(src).toContain('.catch(');
  });

  it('honors a custom canvas id and clear color', () => {
    const src = emitWebBoot({
      userEntry: '../src/game.ts',
      canvasId: 'screen',
      clearColor: { r: 0.1, g: 0.2, b: 0.3, a: 1 },
    });
    expect(src).toContain('"canvas":"screen"');
    expect(src).toContain('"clearColor":{"r":0.1,"g":0.2,"b":0.3,"a":1}');
  });

  it('safely quotes an entry path with special characters', () => {
    const src = emitWebBoot({ userEntry: './a"b.ts' });
    expect(src).toContain('import definition from "./a\\"b.ts";');
  });

  it('forwards asset URLs when the export packs a .rpak', () => {
    const src = emitWebBoot({
      userEntry: './game.ts',
      assets: { rpakUrl: 'assets.rpak', manifestUrl: 'manifest.json' },
    });
    expect(src).toContain('"assets":{"rpakUrl":"assets.rpak","manifestUrl":"manifest.json"}');
  });
});
