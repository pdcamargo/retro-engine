# @retro-engine/audio

Audio for Retro Engine — sound effects and music, played from ECS through the
Web Audio API. The same API works in the browser and inside the Tauri webview.

```sh
bun add @retro-engine/audio
```

Add `AudioPlugin`, load an `AudioClip`, and play it through the `Audio` resource:

```ts
import { App, ResMut, AssetServer } from '@retro-engine/engine';
import { AudioPlugin, Audio, AudioClip } from '@retro-engine/audio';

app.addPlugin(new AudioPlugin());

const shot = app.getResource(AssetServer)!.load<AudioClip>('sfx/shot.wav');

app.addSystem('update', [ResMut(Audio)], (audio) => {
  if (shouldFire) audio.play(shot, { volume: 0.8 });
});
```

Clips hold their **encoded** bytes; the backend decodes lazily on first play and
caches the result. The Web Audio autoplay policy is handled automatically — the
backend resumes its context on the first pointer/key event.

Headless-safe: with no `AudioContext` present the plugin installs a no-op backend,
so tests and server-side worlds run unchanged.

See [ADR-0147](../../docs/adr/ADR-0147-audio-architecture.md). This package
depends only on `@retro-engine/engine`.
