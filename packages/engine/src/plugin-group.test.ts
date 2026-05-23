import { describe, expect, it } from 'bun:test';

import type { App, PluginGroup, PluginObject } from './index';
import { App as AppClass, PluginGroupBuilder } from './index';
import { makeHeadlessRenderer } from './test-utils';

const makeApp = (): App => new AppClass({ renderer: makeHeadlessRenderer() });

class LogPlugin implements PluginObject {
  name(): string {
    return 'Log';
  }
  build(_app: App): void {}
}

class TimePlugin implements PluginObject {
  name(): string {
    return 'TimePluginUser';
  }
  build(_app: App): void {}
}

class InputPlugin implements PluginObject {
  name(): string {
    return 'Input';
  }
  build(_app: App): void {}
}

class AltLogPlugin implements PluginObject {
  name(): string {
    return 'AltLog';
  }
  build(_app: App): void {}
}

describe('PluginGroupBuilder', () => {
  it('.add preserves registration order in .build()', () => {
    const builder = new PluginGroupBuilder()
      .add(new LogPlugin())
      .add(new TimePlugin())
      .add(new InputPlugin());
    const out = builder.build();
    expect(out.map((p) => p.name())).toEqual(['Log', 'TimePluginUser', 'Input']);
  });

  it('.disable<T> removes by class identity', () => {
    const builder = new PluginGroupBuilder()
      .add(new LogPlugin())
      .add(new TimePlugin())
      .add(new InputPlugin())
      .disable(TimePlugin);
    const out = builder.build();
    expect(out.map((p) => p.name())).toEqual(['Log', 'Input']);
  });

  it('.disable is a no-op when no entry matches', () => {
    const builder = new PluginGroupBuilder().add(new LogPlugin()).disable(InputPlugin);
    const out = builder.build();
    expect(out.map((p) => p.name())).toEqual(['Log']);
  });

  it('.set<T> replaces by class identity at the original position', () => {
    const builder = new PluginGroupBuilder()
      .add(new LogPlugin())
      .add(new TimePlugin())
      .add(new InputPlugin())
      .set(LogPlugin, new AltLogPlugin());
    const out = builder.build();
    expect(out.map((p) => p.name())).toEqual(['AltLog', 'TimePluginUser', 'Input']);
  });

  it('.set throws when no entry matches the given constructor', () => {
    const builder = new PluginGroupBuilder().add(new LogPlugin());
    expect(() => builder.set(InputPlugin, new InputPlugin())).toThrow(
      /no plugin of type 'InputPlugin' in this group/,
    );
  });

  it('.build returns an independent copy — mutating after build does not affect the snapshot', () => {
    const builder = new PluginGroupBuilder().add(new LogPlugin());
    const snapshot = builder.build();
    builder.add(new TimePlugin());
    expect(snapshot.map((p) => p.name())).toEqual(['Log']);
  });
});

describe('App.addPlugins', () => {
  it('registers a Plugin[] in order', () => {
    const app = makeApp();
    app.addPlugins([new LogPlugin(), new TimePlugin(), new InputPlugin()]);
    app.advanceFrame(0);
    expect(app.pluginsState).toBe('Cleaned');
  });

  it('registers a PluginGroupBuilder in order', () => {
    const app = makeApp();
    app.addPlugins(new PluginGroupBuilder().add(new LogPlugin()).add(new InputPlugin()));
    app.advanceFrame(0);
    expect(app.pluginsState).toBe('Cleaned');
  });

  it('registers a PluginGroup via the double-build path', () => {
    class DefaultPlugins implements PluginGroup {
      build(): PluginGroupBuilder {
        return new PluginGroupBuilder().add(new LogPlugin()).add(new TimePlugin());
      }
    }
    const app = makeApp();
    app.addPlugins(new DefaultPlugins());
    app.advanceFrame(0);
    expect(app.pluginsState).toBe('Cleaned');
  });

  it('honors uniqueness when adding a group that collides with a prior plugin', () => {
    const app = makeApp();
    app.addPlugin(new LogPlugin());
    expect(() => app.addPlugins([new LogPlugin()])).toThrow(
      /plugin 'Log' is unique and already registered/,
    );
  });
});
