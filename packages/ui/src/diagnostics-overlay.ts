import type { Entity } from '@retro-engine/ecs';
import type { App, DiagnosticsStore as DiagnosticsStoreType, PluginObject } from '@retro-engine/engine';
import { DiagnosticsStore, Query, Res } from '@retro-engine/engine';

import { UiText } from './ui-text';

/**
 * Marks a {@link UiText} node as a live diagnostics readout. The
 * {@link DiagnosticsOverlayPlugin} rewrites the node's `text` each frame from the
 * {@link DiagnosticsStore}. Attach it to a `UiText` you have positioned and given
 * a font — the widget owns the text, you own the placement and styling. Authored
 * marker, reflection-registered.
 */
export class DiagnosticsText {}

/**
 * Format a diagnostics snapshot into a compact single line, e.g.
 * `FPS 60  16.7ms  ents 42  assets 12`. FPS is rounded; frame time keeps one
 * decimal. Pure — the overlay system's only formatting logic, unit-tested.
 */
export const formatDiagnostics = (store: DiagnosticsStoreType): string => {
  const fps = Math.round(store.fps);
  const ms = store.frameTimeMs.toFixed(1);
  return `FPS ${fps}  ${ms}ms  ents ${store.entityCount}  assets ${store.assetCount}`;
};

/**
 * Opt-in plugin that keeps every {@link DiagnosticsText}-tagged {@link UiText}
 * node showing the current {@link DiagnosticsStore} readout (FPS / frame time /
 * entity + asset counts), updated in `last` after the store's own update.
 *
 * Requires the engine's `DiagnosticsPlugin` (for the `DiagnosticsStore` resource)
 * and the `UiPlugin` (to lay out + render the text). Spawn a `UiText` with a font
 * plus a `DiagnosticsText`, position it (e.g. absolute top-left), and it tracks
 * live stats.
 *
 * @example
 * ```ts
 * app.addPlugin(new DiagnosticsPlugin());
 * app.addPlugin(new DiagnosticsOverlayPlugin());
 * cmd.spawn(new UiNode({ position: 'absolute', left: 8, top: 8 }),
 *   new UiText({ text: '', font: monoFont }), new DiagnosticsText());
 * ```
 */
export class DiagnosticsOverlayPlugin implements PluginObject {
  name(): string {
    return 'DiagnosticsOverlayPlugin';
  }

  build(app: App): void {
    app.registerComponent(DiagnosticsText, {}, { name: 'DiagnosticsText', make: () => new DiagnosticsText() });
    app.addSystem(
      'last',
      [Query([UiText, DiagnosticsText]), Res(DiagnosticsStore)],
      (nodes, store) => {
        const text = formatDiagnostics(store as DiagnosticsStoreType);
        for (const row of (nodes as { entries(): Iterable<readonly unknown[]> }).entries()) {
          const entity = row[0] as Entity;
          const ui = row[1] as UiText;
          if (ui.text !== text) {
            ui.text = text;
            app.world.markChanged(entity, UiText);
          }
        }
      },
      { label: 'diagnostics-overlay', after: ['diagnostics-update'] },
    );
  }
}
