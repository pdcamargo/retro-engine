// Playground dev server.
//
// Serves the playground HTML (with client HMR) AND a project-save write endpoint
// so the `?mode=save` showcase can persist a project to disk and read it straight
// back through the engine's `FetchAssetSource`:
//
//   PUT/POST /save/<location>  → writes bytes under apps/playground/saved/
//   GET      /saved/<location> → serves those bytes back (what FetchAssetSource reads)
//
// App-layer only — this file may use Bun/Node APIs (`Bun.write` / `Bun.file`).
// The engine and assets packages never do; the write happens here, behind the
// `AssetSink` seam, exactly the way the studio's native sink eventually will.
//
// NOTE: restart this server after engine edits — the engine is a workspace
// dependency bundled on demand and is not hot-reloaded (only the playground's own
// source HMR-reloads).

import homepage from './index.html';

const PORT = 5173;
const SAVE_ROOT = `${import.meta.dir}/saved`;

/**
 * The request's path under `prefix`, or `undefined` if it doesn't match or would
 * escape SAVE_ROOT. Derived from the URL pathname rather than a route param, so
 * it doesn't depend on Bun's wildcard-param key.
 */
const subUnder = (req: Request, prefix: string): string | undefined => {
  const path = decodeURIComponent(new URL(req.url).pathname);
  if (!path.startsWith(prefix)) return undefined;
  const sub = path.slice(prefix.length);
  if (sub.length === 0 || sub.includes('..')) return undefined;
  return sub;
};

Bun.serve({
  port: PORT,
  development: { hmr: true },
  routes: {
    '/': homepage,
    '/save/*': async (req) => {
      if (req.method !== 'PUT' && req.method !== 'POST') {
        return new Response('method not allowed', { status: 405 });
      }
      const sub = subUnder(req, '/save/');
      if (sub === undefined) return new Response('forbidden', { status: 403 });
      await Bun.write(`${SAVE_ROOT}/${sub}`, await req.arrayBuffer());
      return new Response(null, { status: 204 });
    },
    '/saved/*': (req) => {
      const sub = subUnder(req, '/saved/');
      if (sub === undefined) return new Response('forbidden', { status: 403 });
      return new Response(Bun.file(`${SAVE_ROOT}/${sub}`));
    },
  },
});

// eslint-disable-next-line no-console
console.log(`[playground] dev server on http://localhost:${PORT} — save root: ${SAVE_ROOT}`);
