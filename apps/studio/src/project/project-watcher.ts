import { classifyChange } from './watch-router';

/** Reactions the studio wires to project file changes. */
export interface WatchHandlers {
  /** A code file changed — re-bundle user code and rebuild the App. */
  onRebuild(): void;
  /** A scene/prefab changed on disk — offer to reload (may clobber unsaved edits). */
  onReloadScene(path: string): void;
  /** A `.meta`/asset changed — re-scan the manifest and reload affected assets. */
  onReindex(): void;
}

/** A `WatchEvent` from the fs plugin — only the changed paths are needed here. */
interface FsWatchEvent {
  readonly paths?: readonly string[];
}

/**
 * Watch the project root for changes and route each to a handler, coalescing one
 * event's paths (a code change wins over a re-index). Native only — returns a
 * stop function; in a plain browser (no fs watch) it is a no-op and the studio
 * falls back to a manual Reload. Cross-event debouncing and rename tracking are
 * deferred.
 */
export const watchProject = async (root: string, handlers: WatchHandlers): Promise<() => void> => {
  const { watchImmediate } = await import('@tauri-apps/plugin-fs');
  return watchImmediate(
    root,
    (event: FsWatchEvent) => {
      let rebuild = false;
      let reindex = false;
      for (const path of event.paths ?? []) {
        const reaction = classifyChange(path);
        if (reaction === 'rebuild') rebuild = true;
        else if (reaction === 'reindex') reindex = true;
        else if (reaction === 'reload-scene') handlers.onReloadScene(path);
      }
      if (rebuild) handlers.onRebuild();
      else if (reindex) handlers.onReindex();
    },
    { recursive: true },
  );
};
