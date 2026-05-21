# @retro-engine/math

Math primitives for Retro Engine. Wraps [`wgpu-matrix`](https://wgpu-matrix.org/) (Float32Array-backed, WGSL-aligned matrices) and adds engine-specific helpers (`Color`, named colors).

```sh
bun add @retro-engine/math
```

See [ADR-0001](../../docs/adr/ADR-0001-architecture-foundations.md). This package is a leaf — no other internal deps.
