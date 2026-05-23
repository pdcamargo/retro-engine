import { describe, expect, it } from 'bun:test';


import {
  App,
  type Logger,
  MessageReader,
  MessageWriter,
  RunCondition,
} from './index';

import { makeHeadlessRenderer } from './test-utils';

const createSpyLogger = (): { logger: Logger; devWarns: string[] } => {
  const devWarns: string[] = [];
  const logger: Logger = {
    error: () => undefined,
    warn: () => undefined,
    info: () => undefined,
    debug: () => undefined,
    devWarn: (m) => {
      devWarns.push(m);
    },
    child: () => logger,
  };
  return { logger, devWarns };
};

class Death {
  constructor(public entity = 0) {}
}

class Roar {
  constructor(public volume = 0) {}
}

class Unregistered {}

describe('app.addMessage', () => {
  it('registers a message type idempotently — second call is a no-op', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.addMessage(Death);
    app.addMessage(Death);
    expect(app.messageRegistry.isRegistered(Death)).toBe(true);
  });
});

describe('MessageWriter / MessageReader round-trip', () => {
  it('writes are visible to a reader running later in the same frame', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.addMessage(Death);

    app.addSystem('update', [MessageWriter(Death)], (writer) => {
      writer.write(new Death(7));
      writer.write(new Death(8));
    });

    let received: number[] = [];
    app.addSystem('postUpdate', [MessageReader(Death)], (reader) => {
      received = [];
      for (const msg of reader) received.push(msg.entity);
    });

    app.advanceFrame(0);
    expect(received).toEqual([7, 8]);
  });

  it('multiple readers in the same frame each see every message', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.addMessage(Death);

    app.addSystem('first', [MessageWriter(Death)], (writer) => {
      writer.write(new Death(42));
    });

    let updateRead: number[] = [];
    let postRead: number[] = [];
    let lastRead: number[] = [];
    app.addSystem('update', [MessageReader(Death)], (reader) => {
      updateRead = [...reader].map((m) => m.entity);
    });
    app.addSystem('postUpdate', [MessageReader(Death)], (reader) => {
      postRead = [...reader].map((m) => m.entity);
    });
    app.addSystem('last', [MessageReader(Death)], (reader) => {
      lastRead = [...reader].map((m) => m.entity);
    });

    app.advanceFrame(0);
    expect(updateRead).toEqual([42]);
    expect(postRead).toEqual([42]);
    expect(lastRead).toEqual([42]);
  });

  it('drains at frame boundary — frame N messages are gone in frame N+1', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.addMessage(Death);

    let frame = 0;
    app.addSystem('update', [MessageWriter(Death)], (writer) => {
      if (frame === 0) writer.write(new Death(1));
      frame += 1;
    });

    let received: number[] = [];
    app.addSystem('last', [MessageReader(Death)], (reader) => {
      received = [...reader].map((m) => m.entity);
    });

    app.advanceFrame(0);
    expect(received).toEqual([1]);

    app.advanceFrame(16);
    expect(received).toEqual([]);
  });

  it('isolates types — Death buffer does not appear under Roar reader', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.addMessage(Death);
    app.addMessage(Roar);

    app.addSystem('update', [MessageWriter(Death)], (writer) => {
      writer.write(new Death(1));
    });

    let deathRead: number[] = [];
    let roarRead: number[] = [];
    app.addSystem(
      'postUpdate',
      [MessageReader(Death), MessageReader(Roar)],
      (deathReader, roarReader) => {
        deathRead = [...deathReader].map((m) => m.entity);
        roarRead = [...roarReader].map((m) => m.volume);
      },
    );

    app.advanceFrame(0);
    expect(deathRead).toEqual([1]);
    expect(roarRead).toEqual([]);
  });
});

describe('Unregistered message handling', () => {
  it('writer throws on .write against an unregistered type', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });

    let caught: Error | undefined;
    app.addSystem('update', [MessageWriter(Unregistered)], (writer) => {
      writer.write(new Unregistered());
    });

    try {
      app.advanceFrame(0);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeDefined();
    expect(caught?.message).toContain('Unregistered');
    expect(caught?.message).toContain('app.addMessage');
  });

  it('reader yields nothing for an unregistered type — silent, not thrown', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });

    let received: unknown[] = [];
    app.addSystem('update', [MessageReader(Unregistered)], (reader) => {
      received = [...reader];
    });

    expect(() => app.advanceFrame(0)).not.toThrow();
    expect(received).toEqual([]);
  });
});

describe('runIf-gated reader hazard (documented v1 limitation)', () => {
  it('a reader that runIf-skips a frame loses that frame\'s messages', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.addMessage(Death);

    let frame = 0;
    app.addSystem('update', [MessageWriter(Death)], (writer) => {
      if (frame === 0) writer.write(new Death(99));
      frame += 1;
    });

    let readerRan = false;
    let received: number[] = [];
    const gate = new RunCondition(() => readerRan);

    app.addSystem(
      'postUpdate',
      [MessageReader(Death)],
      (reader) => {
        received = [...reader].map((m) => m.entity);
      },
      { runIf: gate },
    );

    // Frame 0: writer writes, gated reader skips, buffer drains at end.
    app.advanceFrame(0);
    expect(received).toEqual([]);

    // Frame 1: reader runs but the prior frame's message is gone.
    readerRan = true;
    app.advanceFrame(16);
    expect(received).toEqual([]);
  });
});

describe('Writer is per-system; cache identity', () => {
  it('MessageWriter(Foo) === MessageWriter(Foo) — cached per ctor', () => {
    expect(MessageWriter(Death)).toBe(MessageWriter(Death));
    expect(MessageReader(Death)).toBe(MessageReader(Death));
  });
});

describe('Reader filters by lastSeenTick — pre-run snapshot semantics', () => {
  it('a reader running on its first frame sees writes from the same frame', () => {
    const app = new App({ renderer: makeHeadlessRenderer() });
    app.addMessage(Death);

    app.addSystem('update', [MessageWriter(Death)], (writer) => {
      writer.write(new Death(5));
    });

    let received: number[] = [];
    app.addSystem('postUpdate', [MessageReader(Death)], (reader) => {
      received = [...reader].map((m) => m.entity);
    });

    // lastSeenTick on first invocation is 0; the message tick is > 0.
    app.advanceFrame(0);
    expect(received).toEqual([5]);
  });
});

// Silence unused-import warnings during static analysis if the spy logger
// helper goes unreferenced in test variants.
void createSpyLogger;
