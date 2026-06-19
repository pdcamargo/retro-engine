---
'@retro-engine/reflect': minor
'@retro-engine/engine': minor
---

feat(reflect): reflection type names default to `ctor.name` (ADR-0088)

`RegisterOptions.name` is now optional across `registerType` / `registerComponent` /
`registerResource`. Resolution order is explicit `name` → static `typeName` → `ctor.name`;
registration throws only for a truly anonymous class. An explicit `name` is still
supported and is the right choice for namespacing (`"mygame/Player"`) or rename-safety.

`ctor.name` stability is now a build-configuration guarantee rather than a hand-written
string: component-producing builds keep identifier minification off (the studio bundle
uses `--minify-whitespace --minify-syntax`; engine packages ship name-stable via `tsc`).
Empirically, only `--minify-identifiers` mangles names, and Bun's `--keep-names` is a
no-op today (oven-sh/bun#25332). Existing explicit-name registrations are unchanged.
