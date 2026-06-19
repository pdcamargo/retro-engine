# ADR-0094: Project model + index

- **Status:** Accepted
- **Date:** 2026-06-19

## Context

To present a project the studio must know what's in it: its descriptor, its assets and
scenes, and the systems/components/resources/editors its code defines. These come from two
fundamentally different sources — files on disk, and a built+applied App — and must not be
conflated.

## Decision

- **The `project.retroengine` descriptor parses to a `ProjectDescriptor`** via `smol-toml`
  (`parseProjectDescriptor`): format version, project id, name/version/engine, build +
  editor entries, startup scene.
- **The index splits by knowability.**
  - **File-derived** (`buildFileIndex`, no App): the scanned `.meta` manifest
    (`scanMetaManifest`, ADR-0089), with scenes (`kind: Scene`) and prefabs (`kind:
    Prefab`) classified out. Renders a project before its code is built.
  - **Code-derived** (`buildCodeIndex`, after the project's plugins are applied): user
    systems (`describeSchedule()` entries with `origin: 'user'`), the components/resources
    registered beyond a captured engine+editor **baseline** (`captureBaseline`), and the
    components the editor extensions customize.
- **`InspectorRegistry.describe()` is the new enumeration surface** (editor-sdk): which
  components have a custom whole-component editor, per-field renderers, or amendments —
  feeding the index's editor list. Global kind/widget/type renderers are not per-component
  and are not reported.
- **The studio captures the baseline before `applyProject` and builds the code index
  after**, exposing it via a `__studioProjectIndex` probe. The two halves carry separate
  freshness: files re-scan on disk change, code re-introspects on rebuild.

## Consequences

- The hierarchy/inspector/Systems panels already read the live `AppTypeRegistry` and
  schedule, so user components/systems surface with no extra wiring; the index adds the
  *project-scoped* view (what's mine vs the engine's) and the file-only view.
- The code index needs the project applied (an App-rebuild, ADR-0091); the file index does
  not. Verified headless: descriptor parsing, scene/prefab classification, and
  "components beyond baseline" all asserted against a built+applied fixture project.
- The disk file-listing + host-backed scene-load-into-world wiring (vs the in-memory
  showcase) rides on the native I/O (ADR-0093) and is completed with the save/load split.

## Implementation

- `apps/studio/src/project/project-index.ts` — `parseProjectDescriptor`, `buildFileIndex`, `buildCodeIndex`, `captureBaseline`, `ProjectIndex`
- `apps/studio/src/main.ts` — baseline capture + code-index build + `__studioProjectIndex` probe
- `packages/editor-sdk/src/inspector/inspector-registry.ts` — `InspectorRegistry.describe`, `InspectorCustomization`
- `apps/studio/src/project/project-index.test.ts` — descriptor/file/code index coverage
