import type { App } from '@retro-engine/engine';

import {
  createModelSubAssetService,
  type ModelSubAssetService,
} from '../project/model-subassets';
import type { BrowserAsset, ProjectBrowser } from '../project/project-browser';

// One sub-asset service per App, so the picker's enumeration shares the cache
// across frames (and across the field renderer) instead of re-scanning models.
const services = new WeakMap<App, ModelSubAssetService>();

const serviceFor = (app: App): ModelSubAssetService => {
  let svc = services.get(app);
  if (svc === undefined) {
    svc = createModelSubAssetService(app);
    services.set(app, svc);
  }
  return svc;
};

/**
 * The browsable pool for the asset picker: the project's top-level assets plus
 * the **assignable** derived children — a model's animation clips, which carry a
 * sub-asset GUID the `AssetServer` can resolve. Mesh/material children are shown
 * in the Assets panel but are not yet assignable, so they are not offered here.
 */
export const augmentedAssets = (app: App, browser: ProjectBrowser | null): BrowserAsset[] => {
  if (browser === null) return [];
  const out = [...browser.assets];
  for (const asset of browser.assets) {
    if (asset.type !== 'model') continue;
    const subs = serviceFor(app).subsFor(asset);
    if (subs === undefined) continue;
    for (const sub of subs) {
      if (sub.type === 'animation') out.push(sub);
    }
  }
  return out;
};

/**
 * A {@link ProjectBrowser} view whose `assets` include assignable sub-assets,
 * delegating thumbnails to the real browser. `null` when no project is open.
 */
export const pickerBrowser = (app: App, browser: ProjectBrowser | null): ProjectBrowser | null =>
  browser === null ? null : { assets: augmentedAssets(app, browser), thumbnails: browser.thumbnails };
