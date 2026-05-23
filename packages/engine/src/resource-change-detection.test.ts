import { describe, expect, it } from 'bun:test';

import type {
  CommandEncoder,
  Renderer,
  RendererCapabilities,
  RenderPipeline,
  ShaderModule,
  Surface,
  TextureFormat,
} from '@retro-engine/renderer-core';

import {
  App,
  ChangedRes,
  Commands,
  ResAdded,
  ResMut,
  RunCondition,
} from './index';

const fail = (msg: string): never => {
  throw new Error(`stub renderer: ${msg} not implemented`);
};

const baseCapabilities: RendererCapabilities = {
  computeShaders: false,
  storageTextures: false,
  timestampQueries: false,
  indirectDraw: false,
  bgra8UnormStorage: false,
};

const makeHeadlessRenderer = (): Renderer => ({
  capabilities: baseCapabilities,
  init: () => Promise.resolve(),
  destroy: () => undefined,
  getPreferredSurfaceFormat: (): TextureFormat => 'rgba8unorm',
  createSurface: (): Surface => fail('createSurface'),
  createShaderModule: (): ShaderModule => fail('createShaderModule'),
  createRenderPipeline: (): RenderPipeline => fail('createRenderPipeline'),
  createCommandEncoder: (): CommandEncoder => fail('createCommandEncoder'),
  submit: (): void => fail('submit'),
});

describe('ChangedRes', () => {
  it('a fresh observer sees the existing insert as a change on first run', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    class Counter {
      value = 0;
    }
    app.insertResource(new Counter());

    const observations: boolean[] = [];
    app.addSystem('update', [ChangedRes(Counter)], (didChange) => {
      observations.push(didChange);
    });

    app.advanceFrame(0);
    expect(observations).toEqual([true]);
  });

  it('returns true on the frame markResourceChanged was called for a downstream observer', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    class Counter {
      value = 0;
    }
    app.insertResource(new Counter());
    // Drive Time forward so the insert's stamp is in the past and the
    // observer's lastSeenFrame is established before the mark.
    app.advanceFrame(0);
    app.advanceFrame(16);

    const observations: boolean[] = [];
    app.addSystem('last', [ChangedRes(Counter)], (didChange) => {
      observations.push(didChange);
    });

    // Observer's first run with no mark this frame (insert's stamp is older
    // than lastSeenFrame = -1 sees, but no fresh changes since "the start
    // of time" for this system).
    app.advanceFrame(32);
    expect(observations[observations.length - 1]).toBe(true); // insert still visible

    // Mark in 'first' of the next frame; observer in 'last' sees true.
    let markedOnce = false;
    app.addSystem('first', [], () => {
      if (markedOnce) return;
      app.markResourceChanged(Counter);
      markedOnce = true;
    });
    const before = observations.length;
    app.advanceFrame(48);
    expect(observations[before]).toBe(true);

    // Drive a few more frames with no further marks; observer eventually
    // settles into `false`.
    app.advanceFrame(64);
    app.advanceFrame(80);
    expect(observations[observations.length - 1]).toBe(false);
  });

  it('returns false for a never-inserted resource', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    class Missing {
      value = 0;
    }
    const observations: boolean[] = [];
    app.addSystem('update', [ChangedRes(Missing)], (didChange) => {
      observations.push(didChange);
    });
    app.advanceFrame(0);
    app.advanceFrame(16);
    expect(observations.every((b) => b === false)).toBe(true);
  });

  it('cmd.markResourceChanged makes a same-frame downstream observer see true', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    class Counter {
      value = 0;
    }
    app.insertResource(new Counter());
    app.advanceFrame(0);
    app.advanceFrame(16);

    const observations: boolean[] = [];
    app.addSystem('last', [ChangedRes(Counter)], (didChange) => {
      observations.push(didChange);
    });

    // Establish observer's lastSeenFrame baseline on a quiet frame.
    app.advanceFrame(32);

    let markedOnce = false;
    app.addSystem('update', [Commands, ResMut(Counter)], (cmd, c) => {
      if (markedOnce) return;
      c.value += 1;
      cmd.markResourceChanged(Counter);
      markedOnce = true;
    });

    const before = observations.length;
    app.advanceFrame(48);
    expect(observations[before]).toBe(true);
  });

  it('runIf-gated observer accumulates a mark across the frames it skipped', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    class Counter {
      value = 0;
    }
    app.insertResource(new Counter());
    app.advanceFrame(0);
    app.advanceFrame(16);
    app.advanceFrame(32);

    let gateOpen = false;
    const observations: { frame: number; didChange: boolean }[] = [];
    app.addSystem(
      'last',
      [ChangedRes(Counter)],
      (didChange) => {
        observations.push({ frame: app.currentFrameNumber(), didChange });
      },
      { runIf: new RunCondition(() => gateOpen) },
    );

    // Frame 4: observer gated open, no mark yet. Establish baseline.
    gateOpen = true;
    app.advanceFrame(48);
    gateOpen = false;

    // Frames 5, 6: gated out. Mark during frame 5 from outside any system.
    app.advanceFrame(64);
    app.markResourceChanged(Counter);
    app.advanceFrame(80);

    // Frame 7: gate back open. The mark made during a skipped frame must
    // still be visible — lastSeenFrame stays at frame 4's value.
    gateOpen = true;
    const before = observations.length;
    app.advanceFrame(96);
    expect(observations[before]?.didChange).toBe(true);
  });
});

describe('ResAdded', () => {
  it('returns true on the frame insertResource was first called for a downstream observer', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    class Counter {
      value = 0;
    }
    const observations: boolean[] = [];
    app.addSystem('last', [ResAdded(Counter)], (justAdded) => {
      observations.push(justAdded);
    });

    // Observer runs once with Counter not yet present → false.
    app.advanceFrame(0);
    expect(observations[observations.length - 1]).toBe(false);

    // Insert via a 'first' system inside the next frame. Observer in 'last'
    // sees ResAdded true.
    let insertedOnce = false;
    app.addSystem('first', [], () => {
      if (insertedOnce) return;
      app.insertResource(new Counter());
      insertedOnce = true;
    });
    const before = observations.length;
    app.advanceFrame(16);
    expect(observations[before]).toBe(true);
  });

  it('returns false on a frame where markResourceChanged fires but insertResource does not', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    class Counter {
      value = 0;
    }
    app.insertResource(new Counter());
    app.advanceFrame(0);
    app.advanceFrame(16);

    const observations: { changed: boolean; added: boolean }[] = [];
    app.addSystem('last', [ChangedRes(Counter), ResAdded(Counter)], (changed, added) => {
      observations.push({ changed, added });
    });

    // Establish observer's lastSeenFrame baseline.
    app.advanceFrame(32);

    let markedOnce = false;
    app.addSystem('first', [], () => {
      if (markedOnce) return;
      app.markResourceChanged(Counter);
      markedOnce = true;
    });
    const before = observations.length;
    app.advanceFrame(48);
    expect(observations[before]?.changed).toBe(true);
    expect(observations[before]?.added).toBe(false);
  });

  it('returns false on a re-insertion of an already-registered resource', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    class Counter {
      value = 0;
    }
    app.insertResource(new Counter());
    app.advanceFrame(0);
    app.advanceFrame(16);

    const observations: { changed: boolean; added: boolean }[] = [];
    app.addSystem('last', [ChangedRes(Counter), ResAdded(Counter)], (changed, added) => {
      observations.push({ changed, added });
    });
    app.advanceFrame(32);

    let reinsertedOnce = false;
    app.addSystem('first', [], () => {
      if (reinsertedOnce) return;
      app.insertResource(new Counter());
      reinsertedOnce = true;
    });
    const before = observations.length;
    app.advanceFrame(48);
    // Re-insert bumps the change-frame but not the added-frame.
    expect(observations[before]?.changed).toBe(true);
    expect(observations[before]?.added).toBe(false);
  });

  it('returns true again after a remove + re-insert', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    class Counter {
      value = 0;
    }
    app.insertResource(new Counter());
    app.advanceFrame(0);
    app.advanceFrame(16);

    const observations: boolean[] = [];
    app.addSystem('last', [ResAdded(Counter)], (justAdded) => {
      observations.push(justAdded);
    });
    app.advanceFrame(32);

    let cycled = false;
    app.addSystem('first', [], () => {
      if (cycled) return;
      app.removeResource(Counter);
      app.insertResource(new Counter());
      cycled = true;
    });
    const before = observations.length;
    app.advanceFrame(48);
    expect(observations[before]).toBe(true);
  });

  it('ChangedRes and ResAdded resolve independently from the same lastSeenFrame', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    class Counter {
      value = 0;
    }
    const seen: { changed: boolean; added: boolean }[] = [];
    app.addSystem('update', [ChangedRes(Counter), ResAdded(Counter)], (c, a) => {
      seen.push({ changed: c, added: a });
    });

    app.advanceFrame(0); // resource absent
    expect(seen[seen.length - 1]).toEqual({ changed: false, added: false });

    let insertedOnce = false;
    app.addSystem('first', [], () => {
      if (insertedOnce) return;
      app.insertResource(new Counter());
      insertedOnce = true;
    });
    app.advanceFrame(16);
    expect(seen[seen.length - 1]).toEqual({ changed: true, added: true });
  });
});
