#!/usr/bin/env bun
// CLI wrapper the Bun sidecar runs to export the open project to a deployable
// static web build. Bundled to a single self-contained resource for the shipped
// studio (so it has no studio-src imports at runtime); runnable directly under
// `bun` in dev. Prints a JSON summary `{ outDir, outputs }` to stdout.
//
// usage: bun build-web-export-cli.ts --project <abs dir> [--out <dir>] [--production]

import { runWebExport } from '@retro-engine/build';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const projectRoot = flag('--project');
if (projectRoot === undefined || projectRoot.length === 0) {
  process.stderr.write('usage: build-web-export-cli --project <dir> [--out <dir>] [--production]\n');
  process.exit(1);
}

try {
  const out = flag('--out');
  const result = await runWebExport({
    projectRoot,
    ...(out !== undefined && out.length > 0 ? { outDir: out } : {}),
    production: args.includes('--production'),
  });
  process.stdout.write(JSON.stringify({ outDir: result.outDir, outputs: result.outputs }));
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
