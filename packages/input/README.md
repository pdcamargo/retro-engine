# @retro-engine/input

Platform-agnostic input for Retro Engine — keyboard, mouse, gamepad, and touch,
read from ECS systems with no DOM knowledge in game code. The same API works in
the browser and inside the Tauri webview.

```sh
bun add @retro-engine/input
```

Add `InputPlugin` to your `App`, then read input through resources:

```ts
import { App, Res } from '@retro-engine/engine';
import { InputPlugin, KeyboardInput, MouseButtonInput } from '@retro-engine/input';

app.addPlugin(new InputPlugin());

app.addSystem('update', [Res(KeyboardInput)], (keys) => {
  if (keys.justPressed('Space')) jump();
  if (keys.pressed('KeyW')) moveForward();
});
```

The model mirrors Bevy: `ButtonInput<T>` exposes `pressed` / `justPressed` /
`justReleased`; `Axis<T>` holds analog values. Keys are bound by **physical
position** (`KeyboardEvent.code`, so WASD stays WASD on any layout).

Headless-safe: with no `window` present the plugin installs a no-op backend, so
tests and server-side worlds run unchanged.

See [ADR-0144](../../docs/adr/ADR-0144-input-system-architecture.md) for the
architecture. This package depends only on `@retro-engine/engine`.
