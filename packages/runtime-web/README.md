# @retro-engine/runtime-web

Browser runtime host for Retro Engine. Turns a project's `ProjectDefinition`
(from `@retro-engine/project`) into a running `App` with a WebGPU backend — the
shipped-game counterpart to the studio's editor host.

```ts
import definition from './game';
import { bootWebGame } from '@retro-engine/runtime-web';

await bootWebGame(definition, { canvas: 'game' });
```

`bootWebGame` resolves the render canvas, creates a renderer (WebGPU by default,
injectable), constructs the `App`, adds every project plugin in order, and starts
the frame loop. The web export pipeline (`@retro-engine/build`) generates a boot
entry that calls this for you.
