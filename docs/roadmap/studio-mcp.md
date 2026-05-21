# Studio — AI MCP Server

- **Created:** 2026-05-21
- **Status:** Planning

## Goal

The studio exposes a [Model Context Protocol](https://modelcontextprotocol.io/) server so AI coding agents (Claude Code, others) can drive editor-side work directly — manipulate scenes, query the live `World`, run tests, save/load projects, take screenshots — instead of being limited to filesystem edits. Same posture as the Unity MCP integration used elsewhere in the user's workflow: AI does editor-shaped work through editor-shaped tools.

When this lands, `CLAUDE.md` gets an "Editor tooling (MCP)" section governing when agents should prefer the MCP over raw file edits and which actions need explicit confirmation, mirroring the platformer-builder rule for Unity MCP.

## Phases

1. **Transport choice.** stdio vs HTTP+SSE vs WebSocket. Lands as an ADR. Tauri can host either; stdio is the MCP default but a Tauri-hosted server typically wants a network transport so external agents can connect to the running studio. Lean: WebSocket on localhost with a token printed to the studio console.
2. **Server host.** Two viable shapes: (a) MCP server in the Tauri Rust side, calling into the JS layer via Tauri commands; (b) MCP server in JS, run as a side process the studio launches. (a) is tighter integration; (b) keeps engine and editor code in TypeScript. Lean: (b), with the Rust side exposing only auth + lifecycle.
3. **Tool surface — read.** Non-destructive tools first: `world.query`, `world.get_entity`, `scene.list`, `scene.read`, `assets.list`, `assets.read`, `studio.screenshot`, `studio.get_logs`, `studio.get_state`.
4. **Tool surface — write.** Destructive tools, gated on confirmation: `world.spawn`, `world.add_component`, `world.despawn`, `scene.save`, `scene.create`, `assets.import`, `assets.delete`, `studio.run_tests`, `studio.eval` (run TS in the studio's JS context — high power, needs strong guardrails).
5. **Resources.** The project's scenes, assets, recent logs, and current selection as MCP resources so agents can read them without ad-hoc tool calls.
6. **Auth + permissions.** Per-connection token, scoped capability list (read-only vs read-write), confirmation-required actions surface a Tauri modal before executing. CLAUDE.md needs a rule covering when to ask the user before destructive MCP calls.
7. **Plugin surface integration.** `editor-sdk` plugins can register custom MCP tools — same registry pattern as windows/dialogs. Lets third parties extend agent capabilities without forking the studio.
8. **Build-time guard.** Production studio builds strip or hard-disable the MCP server (or gate behind a dev flag). MCP is a development-time tool, not a runtime dependency — same posture as platformer-builder's Unity MCP rule.

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
