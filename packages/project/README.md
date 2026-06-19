# @retro-engine/project

Entry-point contract for a Retro Engine game project.

- `defineProject({ plugins, meta })` — default-export from your game's entry module
  (`src/game.ts`). Lists the plugins that compose the game.
- `defineEditorExtensions({ setup })` — default-export from your optional editor entry
  module (`src/editor.ts`), imported from `@retro-engine/project/editor`. Customizes how
  the studio presents your components. Never ships in a game build.

```ts
// src/game.ts
import { defineProject } from '@retro-engine/project';
import { PlayerPlugin } from './player';

export default defineProject({
  plugins: [new PlayerPlugin()],
  meta: { name: 'My Game' },
});
```
