import { describe, expect, test } from 'bun:test';
import { scaffoldProject } from './scaffold';

const opts = {
  name: 'my-game',
  projectId: '00000000-0000-4000-8000-000000000000',
  engineVersion: '0.5.0',
};

describe('scaffoldProject', () => {
  test('emits the fixed layout', () => {
    const files = scaffoldProject(opts);
    for (const path of [
      'project.retroengine',
      'package.json',
      'tsconfig.json',
      'bunfig.toml',
      '.gitignore',
      '.vscode/settings.json',
      'src/game.ts',
      'src/editor.ts',
      'assets/.gitkeep',
    ]) {
      expect(files.has(path)).toBe(true);
    }
  });

  test('descriptor carries id, name, and engine pin', () => {
    const descriptor = scaffoldProject(opts).get('project.retroengine')!;
    expect(descriptor).toContain('projectId = "00000000-0000-4000-8000-000000000000"');
    expect(descriptor).toContain('name = "my-game"');
    expect(descriptor).toContain('engine = "0.5.0"');
    expect(descriptor).toContain('entry = "src/game.ts"');
  });

  test('package.json pins @retro-engine deps to the resolved spec', () => {
    const pkg = JSON.parse(scaffoldProject(opts).get('package.json')!);
    expect(pkg.dependencies['@retro-engine/engine']).toBe('^0.5.0');
    expect(pkg.dependencies['@retro-engine/project']).toBe('^0.5.0');
    expect(pkg.devDependencies['@retro-engine/tsconfig']).toBe('^0.5.0');
  });

  test('dependencySpec overrides the version range (local linking)', () => {
    const pkg = JSON.parse(scaffoldProject({ ...opts, dependencySpec: 'link:../../packages/engine' }).get('package.json')!);
    expect(pkg.dependencies['@retro-engine/engine']).toBe('link:../../packages/engine');
  });

  test('game entry default-exports defineProject', () => {
    const game = scaffoldProject(opts).get('src/game.ts')!;
    expect(game).toContain("from '@retro-engine/project'");
    expect(game).toContain('export default defineProject');
  });
});
