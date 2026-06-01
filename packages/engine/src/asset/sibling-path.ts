/**
 * Resolving a resource referenced relative to a loaded asset, for the importer
 * `read` capability. Resolution is string-based and source-agnostic on purpose:
 * it must work for fetch, disk, and bundle sources alike, so it never uses
 * `new URL` (which would assume a URL-shaped location). A source's own base
 * resolution (e.g. a fetch base URL) composes on top of the joined path.
 */

/** Whether `uri` is an inline `data:` URI rather than a location to read. */
export const isDataUri = (uri: string): boolean => uri.startsWith('data:');

/**
 * Decode the payload of a `data:` URI to raw bytes. Handles both base64
 * (`data:...;base64,<b64>`) and percent-encoded text (`data:...,<text>`)
 * payloads. Throws if `uri` is not a `data:` URI.
 */
export const decodeDataUri = (uri: string): Uint8Array => {
  if (!isDataUri(uri)) {
    throw new Error(`decodeDataUri: not a data URI: '${uri.slice(0, 32)}'.`);
  }
  const comma = uri.indexOf(',');
  if (comma < 0) {
    throw new Error(`decodeDataUri: malformed data URI (no comma): '${uri.slice(0, 32)}'.`);
  }
  const header = uri.slice('data:'.length, comma);
  const payload = uri.slice(comma + 1);
  if (header.endsWith(';base64')) {
    const binary = atob(payload);
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  }
  return new TextEncoder().encode(decodeURIComponent(payload));
};

/**
 * The directory portion of a load path — everything before the last `/`, or
 * `''` when the path has no directory component. String-only; no URL or
 * filesystem semantics.
 */
export const dirOf = (path: string): string => {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
};

/**
 * Resolve `relativePath` against the directory of `path` by string join.
 * `relativePath` is percent-decoded first (asset references are often
 * URI-encoded). No `..` normalization is applied — the source's own resolution
 * layer handles that — and `new URL` is deliberately not used.
 */
export const resolveSiblingPath = (path: string, relativePath: string): string => {
  const rel = decodeURIComponent(relativePath);
  const dir = dirOf(path);
  return dir === '' ? rel : `${dir}/${rel}`;
};
