# @retro-engine/engine

Retro Engine — `App`, plugins, schedules. The surface a game targets.

```sh
bun add @retro-engine/engine @retro-engine/renderer-webgpu
```

```ts
import { App } from '@retro-engine/engine';
import { createWebGPURenderer } from '@retro-engine/renderer-webgpu';

const renderer = createWebGPURenderer(document.querySelector('canvas')!);
const app = new App({ renderer });

app.addPlugin((a) => {
  a.addSystem('startup', () => {
    // ...spawn entities, add resources, etc.
  });
});

await app.run();
```

Architecture: [ADR-0001](../../docs/adr/ADR-0001-architecture-foundations.md). The engine never imports concrete renderer backends — they're injected.
