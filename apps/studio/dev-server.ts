// Studio browser dev server (for running the editor shell outside Tauri — used
// by the design fidelity check). Serves the HTML with client HMR plus the editor
// fonts (JetBrains Mono, the Lucide icon font, Silkscreen) that main.ts fetches.
//
// App-layer only — may use Bun APIs. The Tauri `dev` script (`bun index.html`)
// stays as-is; this is a separate entry for plain-browser runs.

import homepage from './index.html';

const PORT = 1421;

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
    // Build a project's user code into a host-resolved ESM bundle (browser path;
    // the Tauri sidecar serves the same artifact natively).
    '/project/build': async (req) => {
      const dir = new URL(req.url).searchParams.get('dir');
      if (dir === null || dir.length === 0) return new Response('missing dir', { status: 400 });
      const { buildProject } = await import('./src/project/build-project');
      try {
        const { code } = await buildProject({ entrypoint: `${dir}/src/game.ts` });
        return new Response(code, { headers: { 'content-type': 'text/javascript' } });
      } catch (err) {
        return new Response(String(err), { status: 500 });
      }
    },
  },
});

// eslint-disable-next-line no-console
console.log(`[studio] dev server on http://localhost:${PORT}`);
