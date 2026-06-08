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

/** A request sub-path is safe only if it cannot escape SAVE_ROOT. */
const isSafe = (sub: string | undefined): sub is string =>
  sub !== undefined && sub.length > 0 && !sub.includes('..');

Bun.serve({
  port: PORT,
  development: { hmr: true },
  routes: {
    '/': homepage,
    '/save/*': async (req) => {
      if (req.method !== 'PUT' && req.method !== 'POST') {
        return new Response('method not allowed', { status: 405 });
      }
      const sub = req.params['*'];
      if (!isSafe(sub)) return new Response('forbidden', { status: 403 });
      await Bun.write(`${SAVE_ROOT}/${sub}`, await req.arrayBuffer());
      return new Response(null, { status: 204 });
    },
    '/saved/*': (req) => {
      const sub = req.params['*'];
      if (!isSafe(sub)) return new Response('forbidden', { status: 403 });
      return new Response(Bun.file(`${SAVE_ROOT}/${sub}`));
    },
  },
});

// eslint-disable-next-line no-console
console.log(`[playground] dev server on http://localhost:${PORT} — save root: ${SAVE_ROOT}`);
