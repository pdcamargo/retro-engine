import type { Logger } from '../log';

import type { AssetServer } from './asset-server';

/**
 * Commit every completed load into its store and drain recorded failures.
 *
 * `AssetPlugin` runs this as a `PreUpdate` system. Because `PreUpdate` precedes
 * the render stage, a load that finished this frame is in its store before
 * extraction reads it. `store.insert` queues the store's `added` event for a
 * fresh slot or `modified` for a reload, so downstream prepare steps pick the
 * change up through the same path they already use.
 *
 * `logger` (when provided) reports failures at `warn`; they are also kept on
 * the server for tooling to pull via `drainFailures`.
 */
export const applyCompletedLoads = (server: AssetServer, logger?: Logger): void => {
  for (const { store, handle, value } of server.drainCompleted()) {
    store.insert(handle, value);
  }
  if (logger !== undefined) {
    for (const failure of server.drainFailures()) {
      logger.warn(`asset load failed for '${failure.path}': ${String(failure.error)}`);
    }
  }
};
