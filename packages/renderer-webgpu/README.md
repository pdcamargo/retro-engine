# @retro-engine/renderer-webgpu

WebGPU implementation of the Retro Engine renderer HAL ([`@retro-engine/renderer-core`](../renderer-core)).

```sh
bun add @retro-engine/renderer-webgpu
```

```ts
import { createWebGPURenderer } from '@retro-engine/renderer-webgpu';
import { App } from '@retro-engine/engine';

const renderer = createWebGPURenderer(document.querySelector('canvas')!);
const app = new App({ renderer });
await app.run();
```

Design: [ADR-0003](../../docs/adr/ADR-0003-renderer-hal.md).
