/**
 * FNV-1a hash of `bytes`, as an 8-char hex string. A fast, deterministic,
 * non-cryptographic content fingerprint used to detect a corrupted `.rpak` blob
 * on read — not a security primitive.
 */
export const fnv1aHex = (bytes: Uint8Array): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i]!;
    // FNV prime 0x01000193, kept in 32-bit range via Math.imul.
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};
