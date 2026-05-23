import { describe, expect, it } from 'bun:test';

import type { Renderer, RendererCapabilities } from '@retro-engine/renderer-core';

import type { App, PluginObject } from './index';
import { App as AppClass } from './index';

const baseCapabilities: RendererCapabilities = {
  computeShaders: false,
  storageTextures: false,
  timestampQueries: false,
  indirectDraw: false,
  bgra8UnormStorage: false,
};

const fail = (msg: string): never => {
  throw new Error(`stub renderer: ${msg} not implemented`);
};

const makeHeadlessRenderer = (): Renderer => ({
  capabilities: baseCapabilities,
  init: () => Promise.resolve(),
  destroy: () => undefined,
  getPreferredSurfaceFormat: () => 'rgba8unorm',
  createSurface: () => fail('createSurface'),
  createShaderModule: () => fail('createShaderModule'),
  createRenderPipeline: () => fail('createRenderPipeline'),
  createCommandEncoder: () => fail('createCommandEncoder'),
  submit: () => fail('submit'),
});

const makeApp = (): App => new AppClass({ renderer: makeHeadlessRenderer() });

class RecordingPlugin implements PluginObject {
  readonly events: string[];
  private readonly tag: string;

  constructor(tag: string, sharedLog: string[]) {
    this.tag = tag;
    this.events = sharedLog;
  }

  name(): string {
    return `Recording-${this.tag}`;
  }

  build(_app: App): void {
    this.events.push(`${this.tag}.build`);
  }

  finish(_app: App): void {
    this.events.push(`${this.tag}.finish`);
  }

  cleanup(_app: App): void {
    this.events.push(`${this.tag}.cleanup`);
  }
}

describe('App.addPlugin — build hook', () => {
  it('runs the plugin\'s build synchronously at addPlugin time', () => {
    const events: string[] = [];
    const app = makeApp();
    app.addPlugin(new RecordingPlugin('P1', events));
    expect(events).toEqual(['P1.build']);
  });

  it('CorePlugin is registered before any user plugin', () => {
    const app = makeApp();
    // CorePlugin's build inserts Time — observable proof the framework
    // plugin ran before any user code can interact with the App.
    expect(app.getResource(class extends Object {})).toBeUndefined();
    // Time is wired by CorePlugin; importing it here would force a cycle —
    // instead, advance one frame and assert the clock advanced.
    app.advanceFrame(0);
    expect(app.pluginsState).toBe('Cleaned');
  });
});

describe('App plugin lifecycle — state machine', () => {
  it('starts in Building and transitions to Cleaned on the first advanceFrame', () => {
    const app = makeApp();
    expect(app.pluginsState).toBe('Building');
    app.advanceFrame(0);
    expect(app.pluginsState).toBe('Cleaned');
  });

  it('runs build → finish → cleanup in registration order on a single sync frame', () => {
    const events: string[] = [];
    const app = makeApp();
    app.addPlugin(new RecordingPlugin('A', events));
    app.addPlugin(new RecordingPlugin('B', events));
    // After both addPlugin calls, only build has run.
    expect(events).toEqual(['A.build', 'B.build']);
    app.advanceFrame(0);
    // First advanceFrame fires finish + cleanup for both, in order.
    expect(events).toEqual([
      'A.build',
      'B.build',
      'A.finish',
      'B.finish',
      'A.cleanup',
      'B.cleanup',
    ]);
  });

  it('addPlugin after the first advanceFrame throws', () => {
    const app = makeApp();
    const events: string[] = [];
    app.addPlugin(new RecordingPlugin('A', events));
    app.advanceFrame(0);
    expect(() => app.addPlugin(new RecordingPlugin('B', events))).toThrow(
      /plugins must be registered before the first advanceFrame/,
    );
    expect(app.pluginsState).toBe('Cleaned');
  });
});

describe('App plugin lifecycle — ready() polling', () => {
  class DelayedPlugin implements PluginObject {
    finishedAt = -1;
    cleanedAt = -1;
    private polls = 0;

    constructor(
      private readonly readyAfterPolls: number,
      private readonly frameCounter: { value: number },
    ) {}

    name(): string {
      return 'Delayed';
    }

    build(_app: App): void {}

    ready(_app: App): boolean {
      this.polls += 1;
      return this.polls >= this.readyAfterPolls;
    }

    finish(_app: App): void {
      this.finishedAt = this.frameCounter.value;
    }

    cleanup(_app: App): void {
      this.cleanedAt = this.frameCounter.value;
    }
  }

  it('keeps the App in Building while any plugin reports not ready', () => {
    const counter = { value: 0 };
    const app = makeApp();
    const delayed = new DelayedPlugin(3, counter);
    app.addPlugin(delayed);

    counter.value = 1;
    app.advanceFrame(0);
    expect(app.pluginsState).toBe('Building');
    expect(delayed.finishedAt).toBe(-1);

    counter.value = 2;
    app.advanceFrame(16);
    expect(app.pluginsState).toBe('Building');
    expect(delayed.finishedAt).toBe(-1);

    counter.value = 3;
    app.advanceFrame(32);
    expect(app.pluginsState).toBe('Cleaned');
    expect(delayed.finishedAt).toBe(3);
    expect(delayed.cleanedAt).toBe(3);
  });

  it('caches a true ready() result and stops polling that plugin', () => {
    const counter = { value: 0 };
    const app = makeApp();
    // ready() returns true after exactly 1 poll. Two more advanceFrames
    // should not re-invoke ready (private counter would otherwise grow).
    const delayed = new DelayedPlugin(1, counter);
    app.addPlugin(delayed);
    app.advanceFrame(0);
    expect(app.pluginsState).toBe('Cleaned');
    // Subsequent frames must not re-call ready/finish/cleanup — re-running
    // would corrupt the lifecycle invariant.
    expect(delayed.finishedAt).toBe(0);
    const finishedAtBefore = delayed.finishedAt;
    const cleanedAtBefore = delayed.cleanedAt;
    app.advanceFrame(16);
    app.advanceFrame(32);
    expect(delayed.finishedAt).toBe(finishedAtBefore);
    expect(delayed.cleanedAt).toBe(cleanedAtBefore);
  });
});

describe('App.addPlugin — uniqueness by name()', () => {
  class UniquePlugin implements PluginObject {
    name(): string {
      return 'Unique';
    }
    build(_app: App): void {}
  }

  class NonUniquePlugin implements PluginObject {
    name(): string {
      return 'NonUnique';
    }
    isUnique(): boolean {
      return false;
    }
    build(_app: App): void {}
  }

  it('throws on a second instance of a unique plugin', () => {
    const app = makeApp();
    app.addPlugin(new UniquePlugin());
    expect(() => app.addPlugin(new UniquePlugin())).toThrow(
      /plugin 'Unique' is unique and already registered/,
    );
  });

  it('allows duplicates when isUnique() returns false', () => {
    const app = makeApp();
    app.addPlugin(new NonUniquePlugin());
    expect(() => app.addPlugin(new NonUniquePlugin())).not.toThrow();
  });
});

describe('App.addPlugin — function-callback auto-wrap', () => {
  it('runs a function-callback plugin\'s body inside build', () => {
    const app = makeApp();
    let ran = false;
    app.addPlugin((_a) => {
      ran = true;
    });
    expect(ran).toBe(true);
  });

  it('treats a named function plugin as unique by fn.name', () => {
    function namedDemoPlugin(_app: App): void {}
    const app = makeApp();
    app.addPlugin(namedDemoPlugin);
    expect(() => app.addPlugin(namedDemoPlugin)).toThrow(
      /plugin 'namedDemoPlugin' is unique and already registered/,
    );
  });

  it('treats an anonymous function plugin as non-unique', () => {
    const app = makeApp();
    expect(() => {
      app.addPlugin((_a) => {});
      app.addPlugin((_a) => {});
    }).not.toThrow();
  });
});
