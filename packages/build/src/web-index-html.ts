/** Options for {@link emitIndexHtml}. */
export interface IndexHtmlOptions {
  /** Document title. Default `'Retro Engine Game'`. */
  readonly title?: string;
  /** Path (relative to the HTML) of the ESM entry bundle to load. */
  readonly bundlePath: string;
  /** Path of the `.rpak` asset archive to preload, if any. */
  readonly rpakPath?: string;
  /** Id of the full-viewport canvas the engine renders into. Default `'game'`. */
  readonly canvasId?: string;
}

const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/**
 * Produce the `index.html` for a web-exported game: a full-viewport canvas and a
 * module `<script>` that boots the user bundle, optionally preloading the
 * `.rpak` asset archive. Pure and deterministic.
 */
export const emitIndexHtml = (options: IndexHtmlOptions): string => {
  const title = escapeHtml(options.title ?? 'Retro Engine Game');
  const canvasId = options.canvasId ?? 'game';
  const preload =
    options.rpakPath !== undefined
      ? `\n    <link rel="preload" href="${options.rpakPath}" as="fetch" crossorigin="anonymous" />`
      : '';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>${preload}
    <style>
      html,
      body {
        margin: 0;
        height: 100%;
        background: #000;
        overflow: hidden;
      }
      #${canvasId} {
        display: block;
        width: 100vw;
        height: 100vh;
      }
    </style>
  </head>
  <body>
    <canvas id="${canvasId}"></canvas>
    <script type="module" src="${options.bundlePath}"></script>
  </body>
</html>
`;
};
