import { describe, expect, it } from 'bun:test';

import { decodeHeader, RPAK_MAGIC_BYTES } from './rpak-format';
import { gunzip, gzip } from './rpak-compression';
import { fnv1aHex } from './rpak-hash';
import { RangeRpakReader, type RangeFetch, RpakReader } from './rpak-reader';
import { writeRpak } from './rpak-writer';

const bytes = (s: string) => new TextEncoder().encode(s);
const str = (b: Uint8Array) => new TextDecoder().decode(b);

describe('rpak write/read round-trip', () => {
  it('reads every entry back by GUID (in-memory reader)', async () => {
    const archive = await writeRpak([
      { guid: 'a', data: bytes('alpha') },
      { guid: 'b', data: bytes('bravo'), codec: 'gzip' },
      { guid: 'c', data: bytes('charlie') },
    ]);
    const reader = new RpakReader(archive);
    expect(reader.guids.sort()).toEqual(['a', 'b', 'c']);
    expect(str(await reader.read('a'))).toBe('alpha');
    expect(str(await reader.read('b'))).toBe('bravo');
    expect(str(await reader.read('c'))).toBe('charlie');
  });

  it('starts with the RPAK magic and a valid header', async () => {
    const archive = await writeRpak([{ guid: 'x', data: bytes('hi') }]);
    expect(archive.subarray(0, 4)).toEqual(RPAK_MAGIC_BYTES);
    expect(decodeHeader(archive).version).toBe(1);
  });

  it('reports and rejects missing GUIDs', async () => {
    const reader = new RpakReader(await writeRpak([{ guid: 'a', data: bytes('a') }]));
    expect(reader.has('a')).toBe(true);
    expect(reader.has('z')).toBe(false);
    await expect(reader.read('z')).rejects.toThrow(/no asset/);
  });

  it('throws on a duplicate GUID at write time', async () => {
    await expect(
      writeRpak([
        { guid: 'dup', data: bytes('1') },
        { guid: 'dup', data: bytes('2') },
      ]),
    ).rejects.toThrow(/duplicate GUID/);
  });

  it('rejects a non-rpak buffer', () => {
    expect(() => new RpakReader(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toThrow(
      /bad magic/,
    );
  });
});

describe('rpak compression', () => {
  it('gzip actually shrinks compressible data and round-trips', async () => {
    const original = new Uint8Array(2000).fill(65); // highly compressible
    const packed = await gzip(original);
    expect(packed.length).toBeLessThan(original.length);
    expect(await gunzip(packed)).toEqual(original);
  });

  it('stores a gzip entry smaller than its raw size', async () => {
    const data = new Uint8Array(4096).fill(7);
    const archive = await writeRpak([{ guid: 'z', data, codec: 'gzip' }]);
    // The whole archive (header + TOC + compressed blob) beats the raw payload.
    expect(archive.length).toBeLessThan(data.length);
    expect(await new RpakReader(archive).read('z')).toEqual(data);
  });
});

describe('rpak integrity', () => {
  it('detects a corrupted blob via the content hash', async () => {
    const archive = await writeRpak([{ guid: 'a', data: bytes('trustworthy') }]);
    // Flip a byte in the blob region (past the header + TOC).
    const corrupted = archive.slice();
    corrupted[corrupted.length - 1] = corrupted[corrupted.length - 1]! ^ 0xff;
    await expect(new RpakReader(corrupted).read('a')).rejects.toThrow(/integrity check failed/);
  });

  it('fnv1a is stable and differs for different content', () => {
    expect(fnv1aHex(bytes('abc'))).toBe(fnv1aHex(bytes('abc')));
    expect(fnv1aHex(bytes('abc'))).not.toBe(fnv1aHex(bytes('abd')));
  });
});

describe('RangeRpakReader (lazy HTTP-Range streaming)', () => {
  const build = async () =>
    writeRpak([
      { guid: 'a', data: bytes('a'.repeat(500)) },
      { guid: 'b', data: bytes('b'.repeat(500)) },
      { guid: 'c', data: bytes('c'.repeat(500)) },
    ]);

  it('opens with only header+TOC fetches, then reads one entry range', async () => {
    const archive = await build();
    const calls: Array<[number, number]> = [];
    const fetch: RangeFetch = (start, end) => {
      calls.push([start, end]);
      return Promise.resolve(archive.subarray(start, end));
    };
    const reader = new RangeRpakReader(fetch);
    await reader.open();
    expect(calls).toHaveLength(2); // header, then TOC

    expect(str(await reader.read('b'))).toBe('b'.repeat(500));
    expect(calls).toHaveLength(3); // one more: entry b's byte range

    // It never downloaded the whole archive (a and c blobs were skipped).
    const fetched = calls.reduce((sum, [s, e]) => sum + (e - s), 0);
    expect(fetched).toBeLessThan(archive.length);
  });

  it('rejects reads before open()', async () => {
    const reader = new RangeRpakReader(() => Promise.resolve(new Uint8Array()));
    await expect(reader.read('a')).rejects.toThrow(/call open/);
  });
});
