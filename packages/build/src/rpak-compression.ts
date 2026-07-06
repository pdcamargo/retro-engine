/**
 * gzip helpers with a portable backend: the Web Streams
 * `CompressionStream`/`DecompressionStream` when present (browsers, newer
 * runtimes) — so the browser asset runtime decompresses natively — falling back
 * to `node:zlib` under Bun/Node (build time + tests) where Web Streams
 * compression is not yet global. The `node:zlib` branch never runs in a browser
 * (its `DecompressionStream` is defined), so the web bundler externalizes it.
 */

const streamFromBytes = (bytes: Uint8Array): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });

const collect = async (stream: ReadableStream<Uint8Array>): Promise<Uint8Array> => {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value !== undefined) {
      chunks.push(value);
      total += value.length;
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
};

// The DOM lib types a (De)CompressionStream as a `BufferSource`-in transform,
// which doesn't unify with our `ReadableStream<Uint8Array>`; a structural cast to
// a Uint8Array pair bridges it without disabling checks elsewhere.
type BytePair = ReadableWritablePair<Uint8Array, Uint8Array>;

/** gzip-compress `bytes`. */
export const gzip = async (bytes: Uint8Array): Promise<Uint8Array> => {
  if (typeof CompressionStream !== 'undefined') {
    const transform = new CompressionStream('gzip') as unknown as BytePair;
    return collect(streamFromBytes(bytes).pipeThrough(transform));
  }
  const zlib = await import('node:zlib');
  return new Uint8Array(zlib.gzipSync(bytes));
};

/** gzip-decompress `bytes` produced by {@link gzip}. */
export const gunzip = async (bytes: Uint8Array): Promise<Uint8Array> => {
  if (typeof DecompressionStream !== 'undefined') {
    const transform = new DecompressionStream('gzip') as unknown as BytePair;
    return collect(streamFromBytes(bytes).pipeThrough(transform));
  }
  const zlib = await import('node:zlib');
  return new Uint8Array(zlib.gunzipSync(bytes));
};
