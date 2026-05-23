// Resource change detection — markResourceChanged throughput and ChangedRes
// param resolution cost across many frames. See docs/adr/ADR-0017.

import { bench, summary } from 'mitata';

import { App, ChangedRes, Commands, ResMut } from '@retro-engine/engine';

import { makeHeadlessRenderer, silentLogger } from './helpers';

class Counter {
  value = 0;
}

class Flag {
  set = false;
}

summary(() => {
  bench('markResourceChanged 10k calls (direct on App)', function* () {
    const app = new App({ renderer: makeHeadlessRenderer(), logger: silentLogger });
    app.insertResource(new Counter());
    yield () => {
      for (let i = 0; i < 10_000; i += 1) app.markResourceChanged(Counter);
    };
  });

  bench('cmd.markResourceChanged 10k ops via advanceFrame', function* () {
    yield () => {
      const app = new App({ renderer: makeHeadlessRenderer(), logger: silentLogger });
      app.insertResource(new Counter());
      app.addSystem('update', [Commands], (cmd) => {
        for (let i = 0; i < 10_000; i += 1) cmd.markResourceChanged(Counter);
      });
      app.advanceFrame(0);
    };
  });
});

summary(() => {
  bench('ChangedRes param resolution: 1k advanceFrame ticks, no marks', function* () {
    const app = new App({ renderer: makeHeadlessRenderer(), logger: silentLogger });
    app.insertResource(new Counter());
    let observed = 0;
    app.addSystem('update', [ResMut(Counter), ChangedRes(Counter)], (c, didChange) => {
      c.value += 1;
      if (didChange) observed += 1;
    });
    yield () => {
      for (let i = 0; i < 1_000; i += 1) app.advanceFrame(i);
      return observed;
    };
  });

  bench('ChangedRes param resolution: 1k advanceFrame ticks, mark every frame', function* () {
    const app = new App({ renderer: makeHeadlessRenderer(), logger: silentLogger });
    app.insertResource(new Counter());
    app.insertResource(new Flag());
    let observed = 0;
    app.addSystem(
      'update',
      [ResMut(Counter), ChangedRes(Counter), Commands],
      (c, didChange, cmd) => {
        c.value += 1;
        cmd.markResourceChanged(Counter);
        if (didChange) observed += 1;
      },
    );
    yield () => {
      for (let i = 0; i < 1_000; i += 1) app.advanceFrame(i);
      return observed;
    };
  });
});
