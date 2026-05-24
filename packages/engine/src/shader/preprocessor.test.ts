import { describe, expect, it } from 'bun:test';

import { preprocessWgsl } from './preprocessor';
import { ShaderRegistry } from './shader-registry';

const trim = (s: string): string => s.trim();

describe('preprocessWgsl — #import', () => {
  it('inlines a registered module at the directive site', () => {
    const registry = new ShaderRegistry();
    registry.register('test::view', 'const VIEW = 1;');
    const out = preprocessWgsl('#import test::view\nfn main() {}', registry);
    expect(trim(out)).toBe('const VIEW = 1;\nfn main() {}');
  });

  it('inlines each module at most once per top-level compile', () => {
    const registry = new ShaderRegistry();
    registry.register('test::common', 'const SHARED = 1;');
    const out = preprocessWgsl(
      '#import test::common\n#import test::common\nfn main() {}',
      registry,
    );
    // The second #import is silently elided after the first inlines the source.
    expect(out.match(/SHARED/g)?.length).toBe(1);
  });

  it('resolves nested imports', () => {
    const registry = new ShaderRegistry();
    registry.register('test::leaf', 'const LEAF = 1;');
    registry.register('test::branch', '#import test::leaf\nconst BRANCH = 2;');
    const out = preprocessWgsl('#import test::branch\nfn main() {}', registry);
    expect(out).toContain('const LEAF = 1;');
    expect(out).toContain('const BRANCH = 2;');
  });

  it('throws on unknown module', () => {
    const registry = new ShaderRegistry();
    expect(() => preprocessWgsl('#import test::missing\n', registry)).toThrow(
      /unknown shader module 'test::missing'/,
    );
  });

  it('throws on import cycle with the cycle chain in the message', () => {
    const registry = new ShaderRegistry();
    registry.register('test::a', '#import test::b\n');
    registry.register('test::b', '#import test::a\n');
    expect(() =>
      preprocessWgsl('#import test::a\n', registry, { shaderLabel: 'entry' }),
    ).toThrow(/import cycle: test::a -> test::b -> test::a/);
  });

  it('rejects bare #import with no module name', () => {
    const registry = new ShaderRegistry();
    expect(() => preprocessWgsl('#import\n', registry)).toThrow(/#import/);
  });
});

describe('preprocessWgsl — #define', () => {
  it('substitutes identifier tokens with their defined value', () => {
    const registry = new ShaderRegistry();
    const out = preprocessWgsl('#define MAX_LIGHTS 16\nconst N = MAX_LIGHTS;', registry);
    expect(out).toContain('const N = 16;');
  });

  it('respects word boundaries', () => {
    const registry = new ShaderRegistry();
    const out = preprocessWgsl(
      '#define MAX 16\nconst N = MAX;\nconst M = MAX_LIGHTS;',
      registry,
    );
    expect(out).toContain('const N = 16;');
    expect(out).toContain('const M = MAX_LIGHTS;');
  });

  it('merges external defines first', () => {
    const registry = new ShaderRegistry();
    const out = preprocessWgsl('const N = MAX_LIGHTS;', registry, {
      defines: { MAX_LIGHTS: 32 },
    });
    expect(out).toContain('const N = 32;');
  });

  it('lets in-source #define shadow external defines', () => {
    const registry = new ShaderRegistry();
    const out = preprocessWgsl('#define MAX 8\nconst N = MAX;', registry, {
      defines: { MAX: 32 },
    });
    expect(out).toContain('const N = 8;');
  });

  it('treats external `false` as not defined', () => {
    const registry = new ShaderRegistry();
    const out = preprocessWgsl(
      '#ifdef HDR\nconst MODE = "hdr";\n#else\nconst MODE = "sdr";\n#endif',
      registry,
      { defines: { HDR: false } },
    );
    expect(out).toContain('const MODE = "sdr";');
    expect(out).not.toContain('"hdr"');
  });

  it('treats external `true` as defined with empty replacement', () => {
    const registry = new ShaderRegistry();
    const out = preprocessWgsl(
      '#ifdef HDR\nconst MODE = "hdr";\n#endif\nconst FLAG = HDR;',
      registry,
      { defines: { HDR: true } },
    );
    expect(out).toContain('const MODE = "hdr";');
    expect(out).toContain('const FLAG = ;');
  });
});

describe('preprocessWgsl — #ifdef / #ifndef / #else / #endif', () => {
  it('emits the if-branch when the name is defined', () => {
    const registry = new ShaderRegistry();
    const out = preprocessWgsl(
      '#define A\n#ifdef A\nconst X = 1;\n#else\nconst X = 2;\n#endif',
      registry,
    );
    expect(out).toContain('const X = 1;');
    expect(out).not.toContain('const X = 2;');
  });

  it('emits the else-branch when the name is not defined', () => {
    const registry = new ShaderRegistry();
    const out = preprocessWgsl(
      '#ifdef A\nconst X = 1;\n#else\nconst X = 2;\n#endif',
      registry,
    );
    expect(out).not.toContain('const X = 1;');
    expect(out).toContain('const X = 2;');
  });

  it('honors #ifndef', () => {
    const registry = new ShaderRegistry();
    const out = preprocessWgsl(
      '#ifndef A\nconst X = 1;\n#else\nconst X = 2;\n#endif',
      registry,
    );
    expect(out).toContain('const X = 1;');
    expect(out).not.toContain('const X = 2;');
  });

  it('nests correctly — inner branch inherits outer dead state', () => {
    const registry = new ShaderRegistry();
    const out = preprocessWgsl(
      [
        '#ifdef OUTER',
        '#ifdef INNER',
        'const X = 1;',
        '#else',
        'const X = 2;',
        '#endif',
        '#else',
        'const X = 3;',
        '#endif',
      ].join('\n'),
      registry,
      { defines: { OUTER: true, INNER: false } },
    );
    expect(out).toContain('const X = 2;');
    expect(out).not.toContain('const X = 1;');
    expect(out).not.toContain('const X = 3;');
  });

  it('ignores #define inside a dead branch', () => {
    const registry = new ShaderRegistry();
    const out = preprocessWgsl(
      [
        '#ifdef NEVER',
        '#define VAL 99',
        '#endif',
        'const N = VAL;',
      ].join('\n'),
      registry,
    );
    expect(out).toContain('const N = VAL;'); // unsubstituted — define never ran
  });

  it('throws on #else without #ifdef', () => {
    const registry = new ShaderRegistry();
    expect(() => preprocessWgsl('#else\n#endif\n', registry)).toThrow(/#else without matching/);
  });

  it('throws on #endif without #ifdef', () => {
    const registry = new ShaderRegistry();
    expect(() => preprocessWgsl('#endif\n', registry)).toThrow(/#endif without matching/);
  });

  it('throws on unterminated #ifdef', () => {
    const registry = new ShaderRegistry();
    expect(() => preprocessWgsl('#ifdef A\nconst X = 1;\n', registry)).toThrow(/unterminated/);
  });
});
