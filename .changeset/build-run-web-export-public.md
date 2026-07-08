---
'@retro-engine/build': minor
---

feat(build): export `runWebExport` (+ its option/result types) as public API

`runWebExport` was internal to the `retro-build` CLI. Promote it to the package
entry point so hosts (e.g. the studio "Build → Web" menu) can run a web export
programmatically through the public API instead of reaching into `src/`.
