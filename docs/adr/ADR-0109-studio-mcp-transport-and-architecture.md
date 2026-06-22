# ADR-0109: Studio MCP — transport & server architecture

- **Status:** Accepted
- **Date:** 2026-06-21

## Context

The studio could only be observed by AI through read-only `window.__studio*`
probes driven over Playwright, and jsimgui ignores synthetic clicks — so an
agent could look but not act. We want AI clients (Claude Code first) to drive the
editor: read/edit the live `World`, manage entities/components, run history, query
the renderer/logs, and save scenes. This realizes the initiative in
`docs/roadmap/studio-mcp.md`. Constraints: the studio runs in both a Tauri webview
and a plain browser; CLAUDE.md §9 discourages Rust rebuilds; and adding editor
capability should not mean editing protocol plumbing each time.

## Decision

- **The AI client launches a relay; the studio is a reconnecting WebSocket client.**
  `@retro-engine/studio-mcp-server` is a stdio MCP server an AI client starts. It
  owns a localhost WebSocket server (default `127.0.0.1:8787`); the studio connects
  out to it and auto-reconnects. This needs **zero Rust and zero dev-server changes**
  and works identically in Tauri and browser. Trade-off accepted: one active MCP
  session at a time (the relay binds a fixed port); a multi-session broker is deferred.
- **Not published; registered from source.** The package is run via `bun` from this
  repo — there is no npm publish (and won't be for a long while). The relay's
  `install` command registers itself with Claude Code by writing a local `bun`
  invocation into `~/.claude.json` at **user scope** (available from every project,
  including the engine repo) and dropping the skill into `~/.claude/skills`; a
  committed engine-repo `.mcp.json` covers in-repo use. The studio's webview cannot
  write `~/.claude.json` (sandboxed file IO, and it does not know the relay's path),
  so client setup lives in the CLI, not the panel — the panel hands over the command.
- **One command registry is the single source of truth.** The studio sends a
  catalog (`{name, title, description, domain, mutating, inputSchema}` per command)
  on connect and whenever it changes. The relay advertises those as MCP tools via
  the low-level SDK `Server` (`ListTools`/`CallTool` handlers, raw JSON-Schema
  `inputSchema`, `notifications/tools/list_changed`). Adding a `defineCommand(...)`
  surfaces a new tool with no relay edit.
- **The bridge is a shippable, opt-in feature, not a dev-only strip.** Gated by an
  `mcp.enabled` preference: default on in dev, off in prod, toggled from an
  in-studio **MCP panel** (status, port, eval toggle, install-skill, copy-config).
- **Writes are no-friction but undoable + audited.** Every mutating command runs
  through the editor `History` and is recorded in an audit ring (surfaced in the
  panel and via `studio.audit`). No confirmation modals.
- **`studio.eval` is panel-gated.** Arbitrary code against the live studio, only
  advertised/served when the `mcp.eval` toggle is on (default mirrors `enabled`).

## Consequences

- Agents can do editor-shaped work through editor-shaped tools; the studio gains
  real AI control and a path to keep expanding the engine/editor with it.
- Extending the surface is a one-file change (`defineCommand`), keeping the tool
  list and the editor's true capabilities in lock-step.
- The relay's install graph stays lean because the wire protocol lives in a
  zero-dependency leaf (`@retro-engine/mcp-protocol`) shared with the browser-side
  bridge. (When the package is eventually published, the registered command can
  switch from a local `bun` path to `npx`; nothing else changes.)
- Single-session only (one agent at a time); a multi-session broker is a tracked
  follow-on. A studio that hot-reloads project code invalidates entity ids, so
  agents must re-read the tree after a reload.

## Implementation

- `packages/mcp-protocol/src/{protocol.ts,skill.ts}` — wire frames, `CommandManifest`, `JsonSchema`, `RETRO_STUDIO_SKILL_MD`.
- `packages/editor-mcp/src/registry.ts` — `defineCommand`, `CommandRegistry`.
- `packages/editor-mcp/src/{context.ts,bridge.ts}` — `CommandContext`, `AuditLog`, `createStudioBridge`.
- `packages/editor-mcp/src/commands/*` — built-in commands (`selection`, `hierarchy`, `entity`, `component`, `scene`, `history`, `renderer`, `logs`, `studio`); `createDefaultRegistry`.
- `packages/editor-mcp/src/commands/screenshot.ts` + `apps/studio/src/screenshot.ts` — `screenshot.editor`/`panel`/`panels` (canvas `toDataURL` + per-panel rect crop).
- `packages/studio-mcp-server/src/{relay.ts,mcp.ts,server.ts,cli.ts,install-config.ts,install-skills.ts,screenshots.ts}` — the relay + `retro-studio-mcp` bin (`install` writes `~/.claude.json`; image results saved to `screenshots/` + returned inline).
- `.mcp.json` — committed engine-repo registration for in-repo Claude Code use.
- `apps/studio/src/mcp.ts` — `StudioMcp`, `LogRing`, `createTeeLogger`.
- `apps/studio/src/panels-mcp.ts` — the MCP control panel.
- `apps/studio/src/main.ts` — boot wiring (`studioMcp.attach(...)`, `mcp.enabled`/`mcp.port`/`mcp.eval` prefs, `__studioMcp` probe).
