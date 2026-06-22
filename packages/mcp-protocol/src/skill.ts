/** Canonical Claude Code skill doc for the Retro Engine studio MCP. */
export const RETRO_STUDIO_SKILL_NAME = 'retro-studio';

/**
 * The skill markdown installed into a project's `.claude/skills/retro-studio/`
 * (by the relay's `install-skills` command or the studio's MCP panel button).
 * Single source of truth so both install paths write identical content.
 */
export const RETRO_STUDIO_SKILL_MD = `---
name: retro-studio
description: Drive the Retro Engine studio (editor) over MCP — read and edit the live scene, entities, components, selection, and history; query the renderer and logs. Use when the user asks you to inspect or change what's open in the studio, build a scene, add/configure entities, or debug the running editor, and the retro-studio MCP server is connected.
---

# Retro Engine studio control (MCP)

You are driving a **live** game editor. The studio hosts the engine; these tools
read and mutate the running \`World\`, not files on disk. Prefer them over editing
scene files by hand — the editor owns the source of truth while it is open.

## First moves

1. Call \`studio.connected\` to confirm the studio is attached. If it reports
   disconnected, ask the user to open the studio and enable the MCP bridge in the
   **MCP** panel (on by default in dev builds). The relay is unpublished and runs
   from source — it is registered with \`bun run packages/studio-mcp-server/src/cli.ts install\`.
2. Call \`studio.state\` for selection / play-mode / dirty status, then
   \`hierarchy.tree\` to see the scene, and \`component.types\` to learn which
   components exist and their fields before adding or setting any.

## Writes are undoable — act, then verify

Every mutating command (\`entity.spawn\`, \`entity.despawn\`, \`component.add\`,
\`component.remove\`, \`component.set\`, \`entity.rename\`, \`hierarchy.reparent\`)
goes through the editor's undo history. You don't need confirmation prompts:
make the change, then **verify** with \`selection.inspected\` or \`entity.get\`,
and use \`history.undo\` if it was wrong. Recent writes are visible via
\`studio.audit\`.

## Batch for efficiency

To spawn-and-configure in one round trip, use the \`batch\` tool with a list of
steps (\`{ command, args }\`). Steps run in order; you get every result back.
Group related edits so they are easy to reason about and undo together.

## Components and fields

- Use stable reflection **names** (from \`component.types\`), not class names.
- \`component.set\` takes \`{ entity, type, field, value }\`. Vectors/quaternions
  are arrays of numbers; entity references are entity ids; asset handles are GUIDs.
- \`entity.spawn\` accepts \`{ name?, components?: [{ type, data? }] }\`.

## Seeing the editor

- \`screenshot.editor\` captures the whole studio window; \`screenshot.panel\` captures one
  panel (\`screenshot.panels\` lists ids like \`/inspector\`, \`/scene\`, \`/hierarchy\`).
  The image comes back inline (so you can see it) and is saved under the engine repo's
  \`screenshots/\`. Use it to check custom UI and the rendered viewport after edits.

## Debugging

- \`renderer.capabilities\` / \`renderer.stats\` for backend features + per-system cost.
- \`logs.recent\` for recent engine/editor log lines.
- \`studio.eval\` runs arbitrary TypeScript against \`{ app, world, state, editor }\`
  and returns a JSON-safe value. It is only available when the user has enabled
  **Allow eval** in the MCP panel. Reach for it to inspect or poke things no typed
  command covers — but a typed command, when one exists, is clearer and safer.

## Don't

- Don't assume an entity id is stable across a code hot-reload — re-read the tree.
- Don't hand-edit scene files for changes you can make through these tools.
`;
