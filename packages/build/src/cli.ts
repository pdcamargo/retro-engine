#!/usr/bin/env bun
// `retro build` — export a Retro Engine project to a deployable artifact.
//
// usage: retro-build [--project <dir>] [--target web] [--out <dir>] [--production]
//
// Reads <project>/project.retroengine, bundles the project through the web
// export target, and writes a static site to <out> (default <project>/dist/web).

import { resolve } from 'node:path';

import { runWebExport } from './run-export';

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const has = (name: string): boolean => argv.includes(name);

const target = flag('--target') ?? 'web';
if (target !== 'web') {
  process.stderr.write(`retro build: unknown target '${target}' (only 'web' is supported)\n`);
  process.exit(1);
}

const projectRoot = resolve(flag('--project') ?? process.cwd());
const outFlag = flag('--out');

try {
  const result = await runWebExport({
    projectRoot,
    ...(outFlag !== undefined ? { outDir: resolve(outFlag) } : {}),
    production: has('--production'),
  });
  process.stdout.write(
    `retro build: exported '${result.descriptor.name || projectRoot}' → ${result.outDir}\n`,
  );
  for (const output of result.outputs) process.stdout.write(`  ${output}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
