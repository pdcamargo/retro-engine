# ADR-0142: Animation assets use YAML text encoding

- **Status:** Accepted
- **Date:** 2026-07-01

## Context

ADR-0089 decided the on-disk text formats: **authored content → YAML** (scenes
`.rescene`, prefabs `.reprefab`), project descriptor/settings → TOML, and machine
state → JSON (including `.meta` sidecars and the generated manifest). The rationale
for YAML on authored content is that a human authors and version-controls those
files, and JSON is noisy to hand-edit and diff.

The animation assets predate that split and still encode as JSON:

- `.ranimctrl` (`AnimationController`) — `JSON.stringify`/`JSON.parse`.
- `.ranim` (`AnimationClip`) — JSON.
- `.ramask` (`AvatarMask`) — JSON.

An Animation Controller is authored content in exactly the sense ADR-0089 means —
edited in the studio, diffed, committed — yet it is JSON while scenes and prefabs are
YAML. Clips and masks are likewise authored/saved assets. The inconsistency has no
justification beyond "predates the ADR."

## Decision

**`.ranimctrl`, `.ranim`, and `.ramask` encode as UTF-8 YAML**, matching scenes and
prefabs. The serializers swap their text boundary from `JSON.stringify`/`JSON.parse`
to `stringify`/`parse` from the `yaml` package, mirroring
`packages/engine/src/scene/scene-importer.ts`. The serialized object shapes
(`AnimationControllerFile`, the clip file, the mask file) are unchanged — only the
text codec swaps, as ADR-0089 intends (the extension is the type tag; the encoding is
swappable behind it).

**No migration shim.** YAML is a superset of JSON, so `parse` reads the old JSON
payloads directly:

- `.ranim`/`.ramask` carry no breaking shape change, so their format versions are
  unchanged; old JSON files continue to load and are re-emitted as YAML on next save.
- `.ranimctrl` bumps to v3 for the layers addition (ADR-0141); an old v2 payload parses
  but fails the version guard with a clear error — the same clean-break stance as
  ADR-0140.

## Consequences

- Authored animation assets are human-readable and diff cleanly, consistent with the
  rest of the authored-content tier.
- One codec family (`yaml`) across authored assets; `.meta` sidecars stay JSON
  (machine state, per ADR-0089).
- `.ranim`/`.ramask` migrate transparently (JSON reads via the YAML parser, writes as
  YAML). `.ranimctrl` v2 files do not load — accepted (pre-0.1.0).

## Implementation

- `packages/engine/src/animation/animation-controller-asset.ts` — `encodeController`/
  `decodeController` via `yaml`.
- `packages/engine/src/animation/animation-clip-asset.ts` — clip encode/decode via
  `yaml`.
- `packages/engine/src/animation/avatar-mask-asset.ts` — mask encode/decode via `yaml`.
