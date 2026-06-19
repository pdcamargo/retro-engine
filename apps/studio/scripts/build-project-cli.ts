#!/usr/bin/env bun
// CLI wrapper the Bun sidecar runs to build a project's user code into a
// host-resolved ESM bundle. Bundled to a single self-contained resource for the
// shipped studio (so it has no studio-src imports at runtime); runnable directly
// under `bun` in dev. Prints the bundle to stdout, or writes it with --out.
//
// usage: bun build-project-cli.ts --entry <abs path to src/game.ts> [--out <path>]

import { buildProject } from '../src/project/build-project';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const entry = flag('--entry');
if (entry === undefined || entry.length === 0) {
  process.stderr.write('usage: build-project-cli --entry <path> [--out <path>]\n');
  process.exit(1);
}

const { code } = await buildProject({ entrypoint: entry });
const out = flag('--out');
if (out !== undefined && out.length > 0) {
  await Bun.write(out, code);
  process.stdout.write(`wrote ${out}\n`);
} else {
  process.stdout.write(code);
}
