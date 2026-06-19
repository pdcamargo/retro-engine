# ADR-0098: Editor hint + tool systems (run user code in the editor)

- **Status:** Accepted
- **Date:** 2026-06-19

## Context

The studio gates a project's gameplay systems behind the play state (ADR-0091/0097), so
editing is static. But authoring tools need to run *while editing* — procedural preview,
gizmo drawing, in-editor validation — the way Godot's `@tool` scripts and Unity's
`[ExecuteAlways]` do, with `Engine.is_editor_hint()` / `Application.isEditor` to branch
editor-only behavior. Two orthogonal needs: *run this system even in Edit*, and *know
whether I'm in the editor at all*.

## Decision

Two small primitives in `@retro-engine/project` (the package user code already imports),
keeping the engine editor-agnostic:

- **`isEditorHint(): boolean`** — true when running inside the studio (Edit *or* Play),
  false in a shipped standalone runtime. Backed by a global the studio sets at boot
  (`globalThis.__retroEditorHint`), so it's callable anywhere with no ECS param plumbing
  and is naturally `false` when the same project runs standalone. Mirrors
  `Engine.is_editor_hint()`.
- **`runInEditor(systemFn)`** — tags a system function (via a `Symbol.for` key) so the
  studio's play-state gate **skips** it: it runs in Edit as well as Play. Returns the same
  function for inline use at registration. In a standalone runtime there is no gate, so the
  tag is inert and the system runs regardless — the same code behaves correctly in both.
- **`isRunInEditor(fn)`** — the host-side predicate the studio's `applyProject` gate-injector
  reads to decide whether to skip a system. Not needed by game code.

The engine gains nothing editor-specific: the gate lives entirely in the studio
(`applyProject`), the hint is a global, and the tag is a project-package symbol the studio
recognizes.

## Consequences

- Tool systems (preview, gizmos, validation) run while editing; gameplay stays play-gated
  by default. A tool system uses `isEditorHint()` to do editor-only work and defer the real
  logic to a game. The per-system enable checkbox still applies on top.
- The two concepts are independent: `runInEditor` controls *when a system runs*;
  `isEditorHint()` controls *what it does*. A system can use either or both.
- The hint is process-global, matching Godot's model; a future standalone runtime simply
  never sets it. `Symbol.for` keys the tag in the global registry, so it survives any
  module-instance duplication.

## Implementation

- `packages/project/src/editor-hint.ts` — `isEditorHint`, `runInEditor`, `isRunInEditor`
- `apps/studio/src/main.ts` — sets `globalThis.__retroEditorHint = true` at boot
- `apps/studio/src/project/load-project.ts` — gate-injector skips `isRunInEditor(fn)` systems
- `packages/project/src/editor-hint.test.ts`, `apps/studio/src/project/load-project.test.ts` — coverage
- `../retro-game-sample/assets/health.ts` — `health-clamp` tool system demonstrating both
