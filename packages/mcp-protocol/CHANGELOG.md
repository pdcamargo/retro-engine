# @retro-engine/mcp-protocol

## 0.1.0

### Minor Changes

- d59a122: feat(studio): MCP server — AI editor control surface

  Per ADR-0109, lets AI clients (Claude Code and others) drive the live studio over [MCP](https://modelcontextprotocol.io/) instead of blind file edits. An AI client launches the `@retro-engine/studio-mcp-server` relay (run from source via `bun` — the package is not published), which hosts a localhost WebSocket bridge; the studio connects to it as a reconnecting client and serves commands against the live `World`. No Rust, works in both Tauri and browser. `bun run packages/studio-mcp-server/src/cli.ts install` registers it with Claude Code at user scope so it works from any project.

  **New packages:**

  - `@retro-engine/mcp-protocol` — zero-dependency wire protocol (frames, `CommandManifest`, `JsonSchema`) + the canonical `RETRO_STUDIO_SKILL_MD`, shared by the browser-side bridge and the node relay.
  - `@retro-engine/editor-mcp` — the command registry (`defineCommand`, `CommandRegistry`), `CommandContext`, the reconnecting studio bridge (`createStudioBridge`), and the built-in command surface: `selection.*`, `hierarchy.tree`/`reparent`, `entity.spawn`/`despawn`/`rename`/`get`, `component.types`/`add`/`remove`/`set`, `scene.get`/`save`/`dirty`, `history.list`/`undo`/`redo`/`jumpTo`, `renderer.capabilities`/`stats`, `logs.recent`, `panel.list`/`open`/`close`/`focus`, `composer.open`/`close`/`state`, `screenshot.editor`/`panel`/`panels`, and `studio.state`/`play`/`pause`/`stop`/`audit`/`eval`. Adding a `defineCommand(...)` surfaces a new MCP tool automatically.
  - `@retro-engine/studio-mcp-server` — the relay: a stdio MCP server that maps the studio's live catalog to tools (plus static `studio.connected` and `batch`), forwards `tools/call` to the studio, and ships `install` (register with Claude Code at user scope) + `install-skills` CLI commands.

  **Behaviour:**

  - Writes run immediately, are undoable through the editor `History`, and are audited (MCP panel + `studio.audit`) — no confirmation modals.
  - Screenshots return the image inline (the AI sees it) and are also saved under the engine repo's gitignored `screenshots/` for the user.
  - The studio gains an **MCP** panel: enable/disable the bridge, allow/deny `studio.eval`, install the usage skill into the open project, and copy the one-time client-setup command. On by default in dev, off in prod.
