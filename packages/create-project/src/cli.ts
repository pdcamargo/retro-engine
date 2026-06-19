#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scaffoldProject } from './scaffold';

interface CliArgs {
  dir: string;
  name: string;
  engineVersion: string;
  dependencySpec?: string;
  install: boolean;
}

function parseArgs(argv: readonly string[], pkgVersion: string): CliArgs {
  let dir: string | undefined;
  let name: string | undefined;
  let dependencySpec: string | undefined;
  let install = true;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--name') name = argv[++i];
    else if (arg === '--dep-spec') dependencySpec = argv[++i];
    else if (arg === '--no-install') install = false;
    else if (arg && !arg.startsWith('-')) dir ??= arg;
  }
  if (!dir) throw new Error('usage: create-retro-project <dir> [--name <name>] [--dep-spec <spec>] [--no-install]');
  return {
    dir: resolve(dir),
    name: name ?? dir.replace(/.*[/\\]/, ''),
    engineVersion: pkgVersion,
    ...(dependencySpec !== undefined ? { dependencySpec } : {}),
    install,
  };
}

async function ownVersion(): Promise<string> {
  // package.json sits one level above this module (src/ in dev, dist/ when built).
  const here = dirname(fileURLToPath(import.meta.url));
  const pkg = JSON.parse(await readFile(join(here, '..', 'package.json'), 'utf8')) as { version: string };
  return pkg.version;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2), await ownVersion());

  const files = scaffoldProject({
    name: args.name,
    projectId: crypto.randomUUID(),
    engineVersion: args.engineVersion,
    ...(args.dependencySpec !== undefined ? { dependencySpec: args.dependencySpec } : {}),
  });

  for (const [rel, contents] of files) {
    const abs = join(args.dir, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, contents);
  }
  console.log(`Scaffolded ${args.name} at ${args.dir}`);

  if (args.install) {
    console.log('Running bun install…');
    const proc = Bun.spawn(['bun', 'install'], { cwd: args.dir, stdio: ['inherit', 'inherit', 'inherit'] });
    const code = await proc.exited;
    if (code !== 0) throw new Error(`bun install exited with ${code}`);
  }
}

await main();
