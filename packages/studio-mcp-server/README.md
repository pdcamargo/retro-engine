# @retro-engine/studio-mcp-server

An [MCP](https://modelcontextprotocol.io/) relay that lets an AI client (Claude
Code and others) drive a running **Retro Engine studio** — read and edit the
live scene, entities, components, selection, and history; query the renderer and
logs.

It speaks MCP to your AI client over **stdio**, and bridges to the studio over a
**localhost WebSocket** (default port `8787`). The studio connects to the relay
as a client; enable the bridge in the studio's **MCP** panel (on by default in
dev builds).

> Not published to npm. Run it from the source in this repo via `bun`.

## Set up Claude Code

From the engine repo, register the server at **user scope** (available from every
project, including this repo) and install the usage skill globally:

```sh
bun run packages/studio-mcp-server/src/cli.ts install
```

This merges a `retro-studio` entry into `~/.claude.json` pointing `bun` at this
CLI, and drops the skill into `~/.claude/skills`. Use `install --project` to write
`./.mcp.json` for the current project only.

This repo also ships a committed `.mcp.json`, so running Claude Code from the
engine repo root picks up the server with no setup.

Then: open the studio, enable the bridge in the **MCP** panel, and the next time
your AI client starts it'll launch this relay and connect — `/mcp` shows
`retro-studio` with the studio's command set.

## Commands

```sh
bun run packages/studio-mcp-server/src/cli.ts                 # start the relay (what the AI client runs)
bun run packages/studio-mcp-server/src/cli.ts install         # register at user scope + global skill
bun run packages/studio-mcp-server/src/cli.ts install --project   # register in ./.mcp.json
bun run packages/studio-mcp-server/src/cli.ts install-skills [--global]   # just the skill
```

## Configuration

- `RETRO_STUDIO_MCP_PORT` — the WebSocket bridge port (must match the studio's MCP panel). Default `8787`.

## Notes

- One studio at a time per relay (latest connection wins).
- Writes go through the editor's undo history and are auditable in the studio.
- The `studio.eval` tool only appears when the user enables **Allow eval** in the studio.
