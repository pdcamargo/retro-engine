import { afterEach, describe, expect, it } from 'bun:test';

import { FetchAssetSource } from './fetch-source';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('FetchAssetSource', () => {
  it('reads bytes from a successful response', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(new Response(new Uint8Array([1, 2, 3]), { status: 200 }))) as unknown as typeof fetch;

    const out = await new FetchAssetSource().read('x.bin');
    expect([...out]).toEqual([1, 2, 3]);
  });

  it('throws on a non-ok response', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response('nope', { status: 404, statusText: 'Not Found' }),
      )) as unknown as typeof fetch;

    await expect(new FetchAssetSource().read('missing.bin')).rejects.toThrow(/404/);
  });

  it('resolves locations against baseUrl', async () => {
    let requested = '';
    globalThis.fetch = ((input: string | URL | Request) => {
      requested = String(input);
      return Promise.resolve(new Response(new Uint8Array(), { status: 200 }));
    }) as unknown as typeof fetch;

    await new FetchAssetSource({ baseUrl: 'https://cdn.example/assets/' }).read('tex/a.png');
    expect(requested).toBe('https://cdn.example/assets/tex/a.png');
  });
});
