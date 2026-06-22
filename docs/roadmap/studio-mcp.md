# Studio — AI MCP Server

- **Created:** 2026-05-21
- **Status:** In progress (transport + registry + first command surface landed; see [ADR-0109](../adr/ADR-0109-studio-mcp-transport-and-architecture.md))

## Goal

The studio exposes a [Model Context Protocol](https://modelcontextprotocol.io/) server so AI coding agents (Claude Code, others) can drive editor-side work directly — manipulate scenes, query the live `World`, run tests, save/load projects, take screenshots — instead of being limited to filesystem edits. Same posture as the Unity MCP integration used elsewhere in the user's workflow: AI does editor-shaped work through editor-shaped tools.

When this lands, `CLAUDE.md` gets an "Editor tooling (MCP)" section governing when agents should prefer the MCP over raw file edits and which actions need explicit confirmation, mirroring the platformer-builder rule for Unity MCP.

## Phases

1. ✅ **Transport choice.** Landed (ADR-0109): localhost WebSocket; the AI client launches the relay, the studio is a reconnecting client. No token yet (localhost-only, dev tool).
2. ✅ **Server host.** Landed: JS relay (`@retro-engine/studio-mcp-server`), no Rust. The studio attaches over WebSocket.
3. ✅ **Tool surface — read.** Landed: `selection.*`, `hierarchy.tree`, `entity.get`, `component.types`, `scene.get`/`scene.dirty`, `history.list`, `renderer.capabilities`/`renderer.stats`, `logs.recent`, `studio.state`/`studio.audit`/`studio.connected`. Remaining: `assets.*`, `screenshot.*`.
4. ✅ **Tool surface — write.** Landed (no-friction, undoable + audited): `entity.spawn`/`despawn`/`rename`, `component.add`/`remove`/`set`, `hierarchy.reparent`, `history.undo`/`redo`/`jumpTo`, `scene.save`, `studio.play`/`pause`/`stop`, and `studio.eval` (panel-gated). Remaining: `assets.import`/`delete`, bundle/template authoring, `studio.run_tests`.
5. **Resources.** Not started — current surface uses tools; MCP resources for scenes/assets/logs/selection are a follow-on.
6. ✅ **Auth + permissions (revised).** No per-action modals: writes are undoable + audited (panel + `studio.audit`); `studio.eval` is gated by the panel's "Allow eval" toggle. A per-connection token for the localhost socket is a possible hardening follow-on.
7. **Plugin surface integration.** Not started — the `CommandRegistry` is ready for it; expose registration to `editor-sdk` plugins next.
8. **Shippable, opt-in feature (revised — was "build-time guard").** The bridge is **not** stripped from prod; it ships as an opt-in the user enables in the studio **MCP panel** (default on in dev, off in prod via `mcp.enabled`; eval extra-gated via `mcp.eval`). The relay is **not published** (won't be for a long while) — it runs from source via `bun`, registered with `bun run packages/studio-mcp-server/src/cli.ts install` (writes `~/.claude.json` at user scope) plus a committed engine-repo `.mcp.json`. Client setup lives in the CLI, not the panel, because the studio webview can't write `~/.claude.json`.

## Remaining

- ✅ Screenshots landed: `screenshot.editor` / `screenshot.panel` / `screenshot.panels` via `canvas.toDataURL` + per-panel ImGui rect crop; returned inline as an MCP image and saved to the engine repo's `screenshots/`.
- `assets.*` and bundle/template authoring commands; MCP resources (Phase 5).
- `editor-sdk` plugin command registration (Phase 7).
- Multi-session broker (studio- or Rust-hosted) if more than one agent must connect at once.
- A robust dev/prod default signal for `mcp.enabled` (currently `globalThis.__studioMcpDefaultEnabled`, default on).

## Open questions

- **Transport.** stdio works for spawned-child MCP servers (Claude Desktop style), but the studio is a long-lived process — agents want to *connect* to it. WebSocket fits better, but stdio is the MCP default. Probably both, with stdio as a thin proxy.
- **Server in Rust or JS?** Rust → less duplication of Tauri command plumbing, harder to evolve. JS → reuses engine types directly, but spawning a sidecar adds lifecycle complexity.
- **`studio.eval`** — letting an agent execute arbitrary code in the studio is the most powerful tool and the most dangerous. Should it be opt-in per session, require a confirmation prompt, run in a sandboxed worker, or be omitted entirely?
- **Schema source-of-truth.** MCP tool schemas vs TypeScript types vs JSON schema — pick one and generate the others.
- **Multi-agent.** Can multiple agents connect at once? Conflict on writes?
- **Telemetry.** Does the studio log every MCP tool call for the user to audit?
- **Project-relative paths.** MCP resources should use project-relative URIs, not absolute filesystem paths — affects portability.

## Out of scope (for now)

- Running the engine *itself* via MCP (e.g. agents driving an unbuilt game). That's a separate roadmap item if it ever materializes — engine HAL doesn't need an MCP layer.
- Remote-host MCP. Localhost only.

## Links

- MCP spec: https://modelcontextprotocol.io/
- Inspiration: [CoplayDev/unity-mcp](https://github.com/CoplayDev/unity-mcp) — the pattern the platformer-builder project uses.
- Related: [`editor-sdk.md`](editor-sdk.md) — third-party plugins should be able to register MCP tools the same way they register windows.
- Related: [`studio-imgui.md`](studio-imgui.md) — MCP screenshot tool needs access to the same WebGPU canvas ImGui draws into.
