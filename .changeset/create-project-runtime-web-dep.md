---
'@retro-engine/create-project': minor
---

feat(create-project): scaffold `@retro-engine/runtime-web` as a project dependency

The web export bundles from the project tree, and its generated boot entry
imports `@retro-engine/runtime-web` (`bootWebGame`). New projects now list it as
a dependency so `retro build --target web` (and the studio "Build → Web" menu)
resolve it out of the box.
