import { describe, expect, it } from 'bun:test';

import { emitIndexHtml } from './web-index-html';

describe('emitIndexHtml', () => {
  it('emits a canvas + module script pointing at the bundle', () => {
    const html = emitIndexHtml({ bundlePath: 'main.js' });
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<canvas id="game">');
    expect(html).toContain('<script type="module" src="main.js">');
    expect(html).toContain('Retro Engine Game'); // default title
  });

  it('preloads the .rpak only when a path is given', () => {
    const withRpak = emitIndexHtml({ bundlePath: 'main.js', rpakPath: 'assets.rpak' });
    expect(withRpak).toContain('rel="preload"');
    expect(withRpak).toContain('href="assets.rpak"');

    const without = emitIndexHtml({ bundlePath: 'main.js' });
    expect(without).not.toContain('rel="preload"');
  });

  it('honors a custom title and canvas id, escaping the title', () => {
    const html = emitIndexHtml({ bundlePath: 'a.js', title: 'Tom & <Jerry>', canvasId: 'view' });
    expect(html).toContain('<title>Tom &amp; &lt;Jerry&gt;</title>');
    expect(html).toContain('<canvas id="view">');
  });
});
