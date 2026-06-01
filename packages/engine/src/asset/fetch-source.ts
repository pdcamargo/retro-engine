import type { AssetSource } from '@retro-engine/assets';

/**
 * The runtime {@link AssetSource}: reads asset bytes over `fetch`. This is the
 * web/browser source; disk and bundle sources (loose files, pre-baked
 * archives) are separate implementations injected in their own environments.
 *
 * `read` resolves each location against an optional `baseUrl` (so relative
 * asset paths share a root), checks the HTTP status — `fetch` only rejects on
 * network failure, not on `404`/`500`, so an `ok` check is mandatory — and
 * returns the body as raw bytes.
 */
export class FetchAssetSource implements AssetSource {
  private readonly baseUrl: string | undefined;

  constructor(options: { readonly baseUrl?: string } = {}) {
    this.baseUrl = options.baseUrl;
  }

  /**
   * Fetch the bytes at `location`. Rejects if the network request fails or the
   * response status is not in the 2xx range.
   *
   * Request cancellation (`AbortSignal`) is not wired here yet.
   */
  async read(location: string): Promise<Uint8Array> {
    const url = this.baseUrl === undefined ? location : new URL(location, this.baseUrl).href;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`FetchAssetSource: ${res.status} ${res.statusText} for '${url}'.`);
    }
    return new Uint8Array(await res.arrayBuffer());
  }
}
