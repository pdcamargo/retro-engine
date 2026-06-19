// Derives the Systems panel's view model from the live engine schedule. Groups
// registered systems into Engine / Editor / User buckets, keeping same-plugin
// systems adjacent so the panel reads as category-then-plugin.

import type { App, SystemInfo, SystemOrigin } from '@retro-engine/engine';

/** One origin bucket of systems, ready to render. */
export interface CategoryRows {
  readonly origin: SystemOrigin;
  readonly label: string;
  /** Systems in this bucket, ordered so same-plugin systems are contiguous. */
  readonly systems: SystemInfo[];
  /** Total systems in the bucket. */
  readonly total: number;
  /** How many are currently enabled. */
  readonly enabled: number;
}

const CATEGORY_ORDER: readonly { origin: SystemOrigin; label: string }[] = [
  { origin: 'engine', label: 'Engine' },
  { origin: 'editor', label: 'Editor' },
  { origin: 'user', label: 'User' },
];

/** Every registered system, flattened across stages in execution order. */
export const flattenSystems = (app: App): SystemInfo[] => app.describeSchedule().flatMap((g) => g.systems);

/** Count of enabled systems — drives the Systems tab badge and the status bar. */
export const enabledSystemCount = (app: App): number =>
  flattenSystems(app).reduce((n, s) => n + (s.enabled ? 1 : 0), 0);

/** Summed rolling per-frame cost of the enabled systems, in milliseconds. */
export const systemsFrameMs = (app: App): number =>
  flattenSystems(app).reduce((acc, s) => acc + (s.enabled ? (s.avgMs ?? 0) : 0), 0);

/** Display name for a system's plugin, or a marker for systems registered directly on the App. */
export const pluginLabel = (info: SystemInfo): string => info.originPlugin ?? '(app)';

/** Group the schedule into Engine / Editor / User buckets, plugin-contiguous within each. */
export const groupSystems = (app: App): CategoryRows[] => {
  const flat = flattenSystems(app);
  return CATEGORY_ORDER.map(({ origin, label }) => {
    const inCat = flat.filter((s) => s.origin === origin);
    const order: string[] = [];
    const byPlugin = new Map<string, SystemInfo[]>();
    for (const s of inCat) {
      const key = pluginLabel(s);
      let arr = byPlugin.get(key);
      if (arr === undefined) {
        arr = [];
        byPlugin.set(key, arr);
        order.push(key);
      }
      arr.push(s);
    }
    return {
      origin,
      label,
      systems: order.flatMap((p) => byPlugin.get(p)!),
      total: inCat.length,
      enabled: inCat.reduce((n, s) => n + (s.enabled ? 1 : 0), 0),
    };
  });
};
