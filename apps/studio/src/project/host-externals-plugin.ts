import type { BunPlugin } from 'bun';

const RETRO_SCOPE = /^@retro-engine\//;
const HOST_NAMESPACE = 'retro-host';

/**
 * Bun build plugin: resolve every `@retro-engine/*` import in user code to the
 * studio's already-loaded module instances at runtime, instead of bundling a
 * second copy. For each such import it emits a tiny module that re-exports the
 * named bindings from `globalThis.__retroHost[<specifier>]` (published by the
 * studio's host bridge). This keeps class identity shared across the studio and
 * the loaded game — the ECS keys archetypes/queries on the constructor
 * reference, so a bundled second `Transform` would silently fail to match.
 *
 * Export names are enumerated by importing the real package at build time (the
 * builder has it installed), so the shim tracks the engine's exports
 * automatically. Third-party imports are left untouched and bundle normally.
 */
export const hostExternalsPlugin = (): BunPlugin => ({
  name: 'retro-host-externals',
  setup(build) {
    build.onResolve({ filter: RETRO_SCOPE }, (args) => ({ path: args.path, namespace: HOST_NAMESPACE }));

    build.onLoad({ filter: /.*/, namespace: HOST_NAMESPACE }, async (args) => {
      const ns = (await import(args.path)) as Record<string, unknown>;
      const spec = JSON.stringify(args.path);
      const lines = [
        `const ns = globalThis.__retroHost && globalThis.__retroHost[${spec}];`,
        `if (!ns) throw new Error(${JSON.stringify(`retro host package not published: ${args.path}`)});`,
      ];
      for (const name of Object.keys(ns)) {
        if (name === 'default') continue;
        lines.push(`export const ${name} = ns[${JSON.stringify(name)}];`);
      }
      if ('default' in ns) lines.push('export default ns["default"];');
      return { contents: lines.join('\n'), loader: 'js' };
    });
  },
});
