import type { AssetSink, AssetSource } from '@retro-engine/assets';

import type { App } from '../index';
import type { PluginObject } from '../plugin';
import { ResMut } from '../system-param';

import { AssetServer } from './asset-server';
import { FetchAssetSource } from './fetch-source';
import { applyCompletedLoads } from './load-drain';
import { ProjectSaveSink } from './project-save-sink';

/**
 * Installs the asset-loading layer.
 *
 * On `build`:
 *
 * - Inserts an {@link AssetServer} bound to the injected {@link AssetSource}
 *   (defaulting to a {@link FetchAssetSource}). Pass a source — a disk or
 *   bundle reader, or a test stub — through the constructor to swap backends
 *   without touching call sites, the same way the renderer backend is injected.
 * - Registers the `'preUpdate'` load-drain system (labelled `'asset-load-drain'`).
 *   It commits loads that finished off-schedule into their stores. Running in
 *   `PreUpdate` puts a load completed this frame in its store before the render
 *   stage extracts it.
 * - If a write {@link AssetSink} is injected, holds it in a {@link ProjectSaveSink}
 *   resource for the save layer to write a project through — the write mirror of
 *   the injected read `source`. The disk/native sink drops in here too.
 *
 * Loaders are registered separately, by whichever plugin owns an asset type, via
 * {@link AssetServer.registerLoader}.
 *
 * Unique — re-adding manually throws.
 */
export class AssetPlugin implements PluginObject {
  private readonly source: AssetSource | undefined;
  private readonly sink: AssetSink | undefined;

  constructor(options: { readonly source?: AssetSource; readonly sink?: AssetSink } = {}) {
    this.source = options.source;
    this.sink = options.sink;
  }

  name(): string {
    return 'AssetPlugin';
  }

  build(app: App): void {
    const logger = app.logger.child('asset');
    if (app.getResource(AssetServer) === undefined) {
      app.insertResource(new AssetServer({ source: this.source ?? new FetchAssetSource(), logger }));
    }
    if (this.sink !== undefined && app.getResource(ProjectSaveSink) === undefined) {
      app.insertResource(new ProjectSaveSink(this.sink));
    }

    app.addSystem(
      'preUpdate',
      [ResMut(AssetServer)],
      (server) => {
        applyCompletedLoads(server, logger);
      },
      { label: 'asset-load-drain' },
    );
  }
}
