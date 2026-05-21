# @retro-engine/renderer-core

Hardware abstraction layer (HAL) for Retro Engine renderers. Pure types and interfaces — no runtime code.

Backends implement these interfaces:

- [`@retro-engine/renderer-webgpu`](../renderer-webgpu) — WebGPU.
- [`@retro-engine/renderer-webgl2`](../renderer-webgl2) — WebGL2 (stub; not yet implemented).

Design notes: [ADR-0003](../../docs/adr/ADR-0003-renderer-hal.md).

```sh
bun add @retro-engine/renderer-core
```
