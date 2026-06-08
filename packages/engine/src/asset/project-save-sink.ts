import type { AssetSink } from '@retro-engine/assets';

/**
 * Holds the App's project-save {@link AssetSink} as a resource. App resources are
 * keyed by constructor and `AssetSink` is an interface, so the sink rides in this
 * holder — the same reason {@link AssetServer} wraps its source. Save-triggering
 * code (a studio command, a showcase) reads `getResource(ProjectSaveSink)?.sink`
 * and writes a {@link SavedProject}'s files through it; the engine never names a
 * concrete sink.
 */
export class ProjectSaveSink {
  constructor(readonly sink: AssetSink) {}
}
