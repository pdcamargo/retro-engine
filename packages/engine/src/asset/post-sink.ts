import type { AssetSink } from '@retro-engine/assets';

/**
 * A browser {@link AssetSink} that writes each file by `fetch`-ing it to a write
 * endpoint — the write-side mirror of {@link FetchAssetSource}. Pairs with a dev
 * server (or studio backend) that accepts the request and persists the body to
 * disk, so a project saved here can be read straight back through
 * `FetchAssetSource`. Uses only `fetch`; no Node or Tauri API.
 *
 * `write` resolves each location against an optional `baseUrl` (so relative
 * locations share a write root) and checks the HTTP status — `fetch` only
 * rejects on network failure, not on `4xx`/`5xx`, so an `ok` check is mandatory.
 */
export class HttpPostAssetSink implements AssetSink {
  private readonly baseUrl: string | undefined;
  private readonly method: 'POST' | 'PUT';

  constructor(options: { readonly baseUrl?: string; readonly method?: 'POST' | 'PUT' } = {}) {
    this.baseUrl = options.baseUrl;
    this.method = options.method ?? 'PUT';
  }

  /**
   * Write `bytes` to `location`. Rejects if the network request fails or the
   * response status is not in the 2xx range.
   */
  async write(location: string, bytes: Uint8Array): Promise<void> {
    const url = this.baseUrl === undefined ? location : new URL(location, this.baseUrl).href;
    const res = await fetch(url, { method: this.method, body: bytes as BodyInit });
    if (!res.ok) {
      throw new Error(`HttpPostAssetSink: ${res.status} ${res.statusText} for '${url}'.`);
    }
  }
}
