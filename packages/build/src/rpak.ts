// Browser-safe `.rpak` subset of `@retro-engine/build`, exported as
// `@retro-engine/build/rpak`. Only the runtime reader + format + (Web
// Streams) compression + hash — no bundler / export-target / Node file I/O — so
// a browser runtime can import it without pulling the build-time code in.

export type { RpakCodec, RpakEntry, RpakToc } from './rpak-format';
export {
  blobRegionStart,
  decodeHeader,
  decodeToc,
  encodeHeader,
  RPAK_HEADER_SIZE,
  RPAK_MAGIC_BYTES,
  RPAK_VERSION,
} from './rpak-format';
export { fnv1aHex } from './rpak-hash';
export { gunzip, gzip } from './rpak-compression';
export type { RangeFetch } from './rpak-reader';
export { RangeRpakReader, RpakReader } from './rpak-reader';
export type { RpakInput } from './rpak-writer';
export { writeRpak } from './rpak-writer';
