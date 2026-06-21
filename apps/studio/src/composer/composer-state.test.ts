import { describe, expect, it } from 'bun:test';
import { App } from '@retro-engine/engine';
import { createWebGPURenderer } from '@retro-engine/renderer-webgpu';
import { t } from '@retro-engine/reflect';

import { buildComposerCatalog } from './composer-catalog';
import {
  type ComposerState,
  createComposerState,
  deriveComposition,
  ensureDrafts,
  expandAutoRequired,
} from './composer-state';

class TPos {
  x = 0;
}
class TVis {
  visible = true;
}
class TSpr {
  static requires = [TPos, TVis];
  tint = 1;
}

// OrthographicProjection / PerspectiveProjection are real engine components
// (registered by the camera plugin), so the test exercises the conflict table
// against them rather than redefining the names.

const newApp = (): App => {
  const app = new App({ renderer: createWebGPURenderer({} as HTMLCanvasElement) });
  app.registerComponent(TPos, { x: t.number }, { name: 'TPos' });
  app.registerComponent(TVis, { visible: t.boolean }, { name: 'TVis' });
  app.registerComponent(TSpr, { tint: t.number }, { name: 'TSpr' });
  return app;
};

describe('buildComposerCatalog', () => {
  it('lists registered attachable components and resolves static requires to names', () => {
    const app = newApp();
    const catalog = buildComposerCatalog(app);
    const spr = catalog.byName.get('TSpr');
    expect(spr).toBeDefined();
    expect([...spr!.requires].sort()).toEqual(['TPos', 'TVis']);
    expect(catalog.byName.get('OrthographicProjection')!.conflict).toBe('projection');
  });

  it('lists code-defined bundles with their component type names', () => {
    const app = newApp();
    app.registerBundle('Hero', [new TSpr(), new TPos()]);
    const catalog = buildComposerCatalog(app);
    const hero = catalog.bundles.find((b) => b.name === 'Hero');
    expect(hero?.comps).toEqual(['TSpr', 'TPos']);
  });
});

describe('expandAutoRequired', () => {
  it('pulls in transitive requires that are not already present', () => {
    const app = newApp();
    const catalog = buildComposerCatalog(app);
    const auto = expandAutoRequired(['TSpr'], new Set(), catalog);
    expect([...auto.keys()].sort()).toEqual(['TPos', 'TVis']);
    expect(auto.get('TPos')).toBe('TSpr');
  });

  it('does not auto-add components already on the entity', () => {
    const app = newApp();
    const catalog = buildComposerCatalog(app);
    const auto = expandAutoRequired(['TSpr'], new Set(['TPos']), catalog);
    expect(auto.has('TPos')).toBe(false);
    expect(auto.has('TVis')).toBe(true);
  });
});

const withSelection = (state: ComposerState, names: string[], bundles: string[] = []): ComposerState => {
  for (const n of names) state.selected.add(n);
  for (const b of bundles) state.activeBundles.add(b);
  return state;
};

describe('deriveComposition', () => {
  it('splits selected vs auto-required and lists every new component', () => {
    const app = newApp();
    const catalog = buildComposerCatalog(app);
    const state = withSelection(createComposerState(), ['TSpr']);
    const comp = deriveComposition(state, catalog, new Set());

    expect(comp.loose.map((e) => e.name)).toEqual(['TSpr']);
    expect(comp.auto.map((e) => e.name).sort()).toEqual(['TPos', 'TVis']);
    expect([...comp.newNames].sort()).toEqual(['TPos', 'TSpr', 'TVis']);
  });

  it('shows bundle members under their group, not in the loose list', () => {
    const app = newApp();
    app.registerBundle('Hero', [new TSpr(), new TPos()]);
    const catalog = buildComposerCatalog(app);
    const state = withSelection(createComposerState(), [], ['Hero']);
    const comp = deriveComposition(state, catalog, new Set());

    expect(comp.bundleGroups).toHaveLength(1);
    expect(comp.bundleGroups[0]!.members.map((m) => m.name)).toEqual(['TSpr', 'TPos']);
    expect(comp.loose).toHaveLength(0);
    // TVis is required by TSpr but not in the bundle → auto.
    expect(comp.auto.map((e) => e.name)).toEqual(['TVis']);
  });

  it('dedupes against components already on the entity (add mode)', () => {
    const app = newApp();
    const catalog = buildComposerCatalog(app);
    const state = withSelection(createComposerState(), ['TSpr']);
    const comp = deriveComposition(state, catalog, new Set(['TPos', 'TVis']));

    expect(comp.newNames).toEqual(['TSpr']);
    expect([...comp.onEntity].sort()).toEqual(['TPos', 'TVis']);
  });

  it('raises a conflict when >1 member of a group is present', () => {
    const app = newApp();
    const catalog = buildComposerCatalog(app);
    const state = withSelection(createComposerState(), ['OrthographicProjection', 'PerspectiveProjection']);
    const comp = deriveComposition(state, catalog, new Set());
    expect(comp.conflicts).toHaveLength(1);
    expect(comp.conflicts[0]).toContain('projection');
  });
});

describe('ensureDrafts', () => {
  it('creates a draft per new component and prunes removed ones', () => {
    const app = newApp();
    const catalog = buildComposerCatalog(app);
    const state = withSelection(createComposerState(), ['TSpr']);

    let comp = deriveComposition(state, catalog, new Set());
    ensureDrafts(app, state, catalog, comp);
    expect(new Set(state.drafts.keys())).toEqual(new Set(['TSpr', 'TPos', 'TVis']));
    expect(state.drafts.get('TSpr')).toBeInstanceOf(TSpr);

    state.selected.delete('TSpr');
    comp = deriveComposition(state, catalog, new Set());
    ensureDrafts(app, state, catalog, comp);
    expect(state.drafts.size).toBe(0);
  });

  it('seeds bundle-member drafts from the bundle defaults', () => {
    const app = newApp();
    app.registerBundle('Hero', [new TSpr(), (() => { const p = new TPos(); p.x = 9; return p; })()]);
    const catalog = buildComposerCatalog(app);
    const state = withSelection(createComposerState(), [], ['Hero']);
    const comp = deriveComposition(state, catalog, new Set());
    ensureDrafts(app, state, catalog, comp);
    expect((state.drafts.get('TPos') as TPos).x).toBe(9);
  });
});
