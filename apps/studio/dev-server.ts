// Studio browser dev server (for running the editor shell outside Tauri — used
// by the design fidelity check). Serves the HTML with client HMR plus the editor
// fonts (JetBrains Mono, the Lucide icon font, Silkscreen) that main.ts fetches.
//
// App-layer only — may use Bun APIs. The Tauri `dev` script (`bun index.html`)
// stays as-is; this is a separate entry for plain-browser runs.

import { mkdir, rename as fsRename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

import homepage from './index.html';

const PORT = 1421;

/** Reject `..` traversal in a project-relative path (mirrors the native `resolve_in_root` guard). */
const safeRel = (rel: string): boolean => rel.length > 0 && !rel.split('/').includes('..');

const fontUnder = (req: Request): string | undefined => {
  const path = decodeURIComponent(new URL(req.url).pathname);
  if (!path.startsWith('/fonts/')) return undefined;
  const sub = path.slice('/fonts/'.length);
  if (sub.length === 0 || sub.includes('..')) return undefined;
  return sub;
};

Bun.serve({
  port: PORT,
  development: { hmr: true },
  routes: {
    '/': homepage,
    '/fonts/*': (req) => {
      const sub = fontUnder(req);
      if (sub === undefined) return new Response('forbidden', { status: 403 });
      return new Response(Bun.file(`${import.meta.dir}/fonts/${sub}`));
    },
    // List every project file (browser fallback for the native project_read_dir).
    '/project-files': async () => {
      const projectDir = process.env.RETRO_PROJECT_DIR;
      if (projectDir === undefined || projectDir.length === 0) return Response.json([]);
      const files: string[] = [];
      for await (const f of new Bun.Glob('**/*').scan({ cwd: projectDir, onlyFiles: true })) files.push(f);
      return Response.json(files);
    },
    // Read/write a project's files (browser fallback for the native fs source/sink).
    // Scoped to RETRO_PROJECT_DIR; the native studio scopes to the opened root in Rust.
    '/project/*': async (req) => {
      const projectDir = process.env.RETRO_PROJECT_DIR;
      if (projectDir === undefined || projectDir.length === 0) {
        return new Response('RETRO_PROJECT_DIR not set', { status: 404 });
      }
      const rel = decodeURIComponent(new URL(req.url).pathname).slice('/project/'.length);
      if (!safeRel(rel)) return new Response('forbidden', { status: 403 });
      const abs = `${projectDir}/${rel}`;
      if (req.method === 'PUT') {
        await Bun.write(abs, await req.arrayBuffer());
        return new Response('ok');
      }
      if (req.method === 'DELETE') {
        await unlink(abs).catch((e: NodeJS.ErrnoException) => {
          if (e.code !== 'ENOENT') throw e; // idempotent: a missing file is fine
        });
        return new Response('ok');
      }
      const file = Bun.file(abs);
      if (!(await file.exists())) return new Response('not found', { status: 404 });
      return new Response(file);
    },
    // Rename/move a project file (browser fallback for the native project_rename_file).
    '/project-rename': async (req) => {
      const projectDir = process.env.RETRO_PROJECT_DIR;
      if (projectDir === undefined || projectDir.length === 0) {
        return new Response('RETRO_PROJECT_DIR not set', { status: 404 });
      }
      if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
      const { from, to } = (await req.json()) as { from?: string; to?: string };
      if (from === undefined || to === undefined || !safeRel(from) || !safeRel(to)) {
        return new Response('forbidden', { status: 403 });
      }
      const toAbs = `${projectDir}/${to}`;
      await mkdir(dirname(toAbs), { recursive: true });
      await fsRename(`${projectDir}/${from}`, toAbs);
      return new Response('ok');
    },
    // Build a project's user code into a host-resolved ESM bundle (browser path;
    // the Tauri sidecar serves the same artifact natively).
    '/project/build': async (req) => {
      const params = new URL(req.url).searchParams;
      const dir = params.get('dir');
      if (dir === null || dir.length === 0) return new Response('missing dir', { status: 400 });
      const entry = params.get('entry') ?? 'src/game.ts';
      if (entry.split('/').includes('..')) return new Response('forbidden', { status: 403 });
      const { buildProject } = await import('./src/project/build-project');
      try {
        const { code } = await buildProject({ entrypoint: `${dir}/${entry}` });
        return new Response(code, { headers: { 'content-type': 'text/javascript' } });
      } catch (err) {
        return new Response(String(err), { status: 500 });
      }
    },
    // Export a project to a deployable static web build (browser path; the Tauri
    // `project_export_web` command runs the same `runWebExport` natively).
    '/project/export-web': async (req) => {
      const params = new URL(req.url).searchParams;
      const dir = params.get('dir');
      if (dir === null || dir.length === 0) return new Response('missing dir', { status: 400 });
      const { runWebExport } = await import('@retro-engine/build');
      try {
        const result = await runWebExport({ projectRoot: dir, production: params.get('production') !== null });
        return Response.json({ outDir: result.outDir, outputs: result.outputs });
      } catch (err) {
        return new Response(err instanceof Error ? err.message : String(err), { status: 500 });
      }
    },
  },
});

// eslint-disable-next-line no-console
console.log(`[studio] dev server on http://localhost:${PORT}`);
