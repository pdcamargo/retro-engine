import { afterEach, describe, expect, it } from 'bun:test';

import { MemoryAssetSink, MemoryAssetSource } from './memory-sink';
import { HttpPostAssetSink } from './post-sink';

describe('HttpPostAssetSink', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('writes bytes to the baseUrl-resolved location and resolves on 2xx', async () => {
    const calls: { url: string; method: string | undefined }[] = [];
    globalThis.fetch = ((input: unknown, init?: { method?: string }) => {
      calls.push({ url: String(input), method: init?.method });
      return Promise.resolve(new Response(null, { status: 204 }));
    }) as unknown as typeof fetch;

    const sink = new HttpPostAssetSink({ baseUrl: 'http://localhost:5173/save/' });
    await sink.write('assets/a.rmesh', new Uint8Array([1, 2, 3]));

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('http://localhost:5173/save/assets/a.rmesh');
    expect(calls[0]!.method).toBe('PUT');
  });

  it('rejects on a non-2xx response', async () => {
    globalThis.fetch = (() =>
      Promise.resolve(new Response('nope', { status: 500 }))) as unknown as typeof fetch;
    const sink = new HttpPostAssetSink();
    await expect(sink.write('x', new Uint8Array())).rejects.toThrow(/500/);
  });
});

describe('MemoryAssetSink + MemoryAssetSource', () => {
  it('round-trips written bytes and rejects a missing location', async () => {
    const sink = new MemoryAssetSink();
    await sink.write('a/b.json', new Uint8Array([9, 8, 7]));

    const source = new MemoryAssetSource(sink.files);
    expect(Array.from(await source.read('a/b.json'))).toEqual([9, 8, 7]);
    await expect(source.read('missing')).rejects.toThrow(/no file/);
  });
});
