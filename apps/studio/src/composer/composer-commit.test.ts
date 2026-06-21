import { describe, expect, it } from 'bun:test';
import { App, AppBundleRegistry, AppTypeRegistry, type BundleDefinition, Name } from '@retro-engine/engine';
import type { Entity } from '@retro-engine/ecs';
import { History } from '@retro-engine/editor-sdk';
import { createWebGPURenderer } from '@retro-engine/renderer-webgpu';
import { t } from '@retro-engine/reflect';

import { buildComposerCatalog } from './composer-catalog';
import { composerCommit } from './composer-commit';
import { buildEcho } from './composer-echo';
import { createComposerState, deriveComposition, ensureDrafts } from './composer-state';

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

const newApp = (): App => {
  const app = new App({ renderer: createWebGPURenderer({} as HTMLCanvasElement) });
  app.registerComponent(TPos, { x: t.number }, { name: 'TPos' });
  app.registerComponent(TVis, { visible: t.boolean }, { name: 'TVis' });
  app.registerComponent(TSpr, { tint: t.number }, { name: 'TSpr' });
  return app;
};

const historyFor = (app: App): History =>
  new History({ world: app.world, registry: app.getResource(AppTypeRegistry)!.registry });

describe('buildEcho', () => {
  it('renders a spawn call with overridden fields as a struct literal', () => {
    const app = newApp();
    const catalog = buildComposerCatalog(app);
    const state = createComposerState();
    state.selected.add('TSpr');
    const comp = deriveComposition(state, catalog, new Set());
    ensureDrafts(app, state, catalog, comp);
    (state.drafts.get('TSpr') as TSpr).tint = 5;

    const echo = buildEcho('create', comp, catalog, state.drafts, { entityName: 'Hero' });
    expect(echo).toContain('const hero = world.spawn(');
    expect(echo).toContain('new TSpr({ tint: 5 })');
    expect(echo).toContain('new TPos(),'); // default → bare constructor
  });

  it('renders insert in add mode and a registerBundle call in bundle mode', () => {
    const app = newApp();
    const catalog = buildComposerCatalog(app);
    const state = createComposerState();
    state.selected.add('TPos');
    const comp = deriveComposition(state, catalog, new Set());
    ensureDrafts(app, state, catalog, comp);

    expect(buildEcho('add', comp, catalog, state.drafts, { targetId: 42 })).toContain('world.entity(42).insert(');
    expect(buildEcho('bundle', comp, catalog, state.drafts, { bundleName: 'P' })).toContain('app.registerBundle("P", [');
  });

  it('shows a placeholder when nothing is selected', () => {
    const app = newApp();
    const catalog = buildComposerCatalog(app);
    const comp = deriveComposition(createComposerState(), catalog, new Set());
    expect(buildEcho('create', comp, catalog, new Map())).toContain('// pick components');
  });
});

describe('composerCommit — add', () => {
  it('inserts the new components on the target as one undoable step', () => {
    const app = newApp();
    const target = app.world.spawn();
    const catalog = buildComposerCatalog(app);
    const history = historyFor(app);
    const state = createComposerState();
    state.mode = 'add';
    state.targetEntity = target;
    state.selected.add('TSpr');
    const comp = deriveComposition(state, catalog, new Set());
    ensureDrafts(app, state, catalog, comp);

    composerCommit({ app, history, state, catalog, composition: comp, select: () => {} });
    expect(app.world.has(target, TSpr)).toBe(true);
    expect(app.world.has(target, TPos)).toBe(true);

    history.undo();
    expect(app.world.has(target, TSpr)).toBe(false);
  });
});

describe('composerCommit — create', () => {
  it('spawns a named entity, selects it, and undo despawns it', () => {
    const app = newApp();
    const catalog = buildComposerCatalog(app);
    const history = historyFor(app);
    const state = createComposerState();
    state.mode = 'create';
    state.entityName = 'Hero';
    state.selected.add('TSpr');
    const comp = deriveComposition(state, catalog, new Set());
    ensureDrafts(app, state, catalog, comp);

    let selected: Entity | null = null;
    composerCommit({ app, history, state, catalog, composition: comp, select: (e) => (selected = e) });

    expect(selected).not.toBeNull();
    expect(app.world.has(selected!, TSpr)).toBe(true);
    expect(app.world.getComponent(selected!, Name)?.value).toBe('Hero');

    history.undo();
    expect(app.world.hasEntity(selected!)).toBe(false);
  });
});

describe('composerCommit — bundle', () => {
  it('registers the bundle and calls saveBundle with the encoded components', async () => {
    const app = newApp();
    const catalog = buildComposerCatalog(app);
    const history = historyFor(app);
    const state = createComposerState();
    state.mode = 'bundle';
    state.bundleName = 'Hero';
    state.selected.add('TSpr');
    const comp = deriveComposition(state, catalog, new Set());
    ensureDrafts(app, state, catalog, comp);
    (state.drafts.get('TSpr') as TSpr).tint = 7;

    let saved: BundleDefinition | null = null;
    await composerCommit({
      app,
      history,
      state,
      catalog,
      composition: comp,
      select: () => {},
      saveBundle: (def) => {
        saved = def;
        return Promise.resolve();
      },
    });

    const registered = app.getResource(AppBundleRegistry)!.get('Hero');
    expect(registered).toBeDefined();
    expect(saved).not.toBeNull();
    const sprEntry = saved!.components.find((c) => c.type === 'TSpr');
    expect(sprEntry?.data['tint']).toBe(7);
  });
});
