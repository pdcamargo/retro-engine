# @retro-engine/editor-mcp

## 0.1.0

### Minor Changes

- 5d7a21a: feat(editor): general drag-and-drop pattern + Prefab asset kind

  Per ADR-0136, adds one reusable drag-and-drop primitive to the EditorSDK and the
  engine/editor support that lets the studio wire it to prefabs, asset fields, the
  hierarchy, and the scene view.

  **`@retro-engine/editor-sdk`:**

  - `ui.dragSource(payload, options?)` / `ui.dropTarget({ accepts, onDrop, highlight? })` — mark the last-submitted item as a drag source or drop target. Built on ImGui's native drag-drop with a JS-side channel (`dragContext`) for the rich payload, so targets draw their own accept (green) / reject (red) highlight from the `accepts` predicate and deliver on release. The payload union is open for custom drag kinds.
  - New exports: `DragPayload`, `EntityDragPayload`, `AssetDragPayload`, `DragContext`, `dragContext`, `DND_TYPE`, `DragSourceOptions`, `DropTargetOptions`, `ItemDnd`, `applyItemDnd`.
  - `treeItem` gained `accent`, `suffix`, `overridden`, and `recessed` options so a row can render an instance/model tone, a faint source filename, an "edited from source" dot, and a recessed (inherited) style. `RetroPalette` gained `prefab` / `scene` / `model` accent tones.

  **`@retro-engine/engine`:**

  - `serializePrefab(app, root, opts?)` — serialize a single entity subtree into `SceneData` for a reusable prefab: walks `Children` from `root`, drops the root's `Parent` edge, and omits App resources (a prefab is an object, not a world).
  - A distinct **Prefab** asset kind (`PREFAB_ASSET_KIND` = `'Prefab'`, `PREFAB_ASSET_EXTENSION` = `'prefab'`) registered by `ScenePlugin` against the existing `Scenes` store via `registerLoaderByKind`. A prefab loads and mounts through the same `SceneRoot` path as a scene (linked instance), distinguished only by its kind — so scene-only and prefab-only behaviour can diverge later with no asset migration.
  - `hasCompositionOverrides(app, mount)` — whether a `SceneRoot`/instance entity currently differs from the source it was instantiated from (the same diff `serializeScene` records as overrides), surfaced for editor affordances.

  **`@retro-engine/editor-mcp`:**

  - New commands `prefab.createFromEntity`, `asset.instantiate` (kind-generic: scene/prefab → `SceneRoot`, glTF → `GltfSceneRoot`, mesh → `Mesh3d` + default material), and `material.apply` — all undoable through editor `History` and recorded in the audit ring. `asset.instantiate`'s undo despawns the whole instantiated subtree (root + reactor-spawned children), not just the root. `prefab.createFromEntity` names the file after the source entity (deduped with ` (1)`, ` (2)`, …) instead of the GUID.
  - `CommandContext.reindexAssets` — optional studio-provided rescan so a just-written asset is discoverable.
  - `StudioBridge.run(name, args)` — invoke a command locally (e.g. from a UI drop) on the same history/audit path as a remote MCP invoke.

- a39203c: feat(editor-mcp): graph.\* commands + GraphHost

  `@retro-engine/graph-editor` gains a `GraphHost` — a shared registry of open
  graph documents (keyed by GUID) plus the environment they're authored against —
  registered as an App resource so the editor panel and the MCP layer operate on
  the same document.

  `@retro-engine/editor-mcp` adds the `graph.*` command set: `describe` (kinds /
  node types / data types / categories), `get`, and the mutating `addNode` /
  `moveNode` / `connect` / `disconnect` / `addReroute` / `removeReroute` /
  `setField` / `deleteNode` / `setActive`. `connect` validates against the kind's
  rules. Mutations route through the editor `History` as undoable snapshot-commands
  (ADR-0139) and are recorded in the audit ring.

- 1c4a0fe: feat(gltf): attach authored entities onto instantiated glTF nodes, round-tripped through saves

  Per ADR-0112, an authored entity parented onto a node in an instantiated glTF subtree (e.g. a sword on a `hand.R` bone) now survives a save/reload and a model swap, without baking the model into the scene. The parent edge into the derived subtree serializes as a stable node anchor instead of a dangling entity id.

  **Engine — plugin-extensible scene composition:**

  - `CompositionRegistry` (resource, inserted by `CorePlugin`) + `CompositionProvider` — a plugin declares which entities it derives (excluded from saves) and how to re-express a parent edge into that subtree as a stable anchor. Generalizes the previously hardcoded `SceneRoot`/`SceneInstance` exclusion; the built-in case stays inline for the bare-world `serializeWorld` path.
  - `SerializedEntity.attach` (`{ to, kind, anchor }`) — additive and optional, so existing scenes round-trip byte-identically. The serializer emits it in place of a cross-boundary `Parent`; `spawnScene` turns it into a transient `PendingAttachment` resolved by a `kind`-matching system.

  **glTF — stable node addressing + attachment round-trip:**

  - `GltfNodeAnchor` (canonical node index + name path), `resolveGltfNodeAnchor`, `gltfAnchorForEntity` (resolves to the nearest mount, so nested glTF anchors to its own model).
  - A composition provider (excludes instantiated nodes, re-emits attachments as anchors) and a rebind system (re-parents a `PendingAttachment` onto its resolved node once the model instantiates).
  - `addGltfReinstantiation` — swapping a `GltfSceneRoot` handle re-instantiates the subtree and re-binds surviving attachments (detach-before-despawn).

  **editor-mcp:**

  - `entity.anchor` — returns the composition anchor of an entity inside a derived subtree (e.g. a glTF node), generic over the registry.

- e6728cc: feat(mcp): asset.get / asset.setField / asset.save

  AI-driveable asset editing, mirroring the `component.*` commands but for a stored
  asset value (e.g. a material):

  - `asset.get` — an asset's serialized fields by GUID + kind (loads it if needed).
  - `asset.setField` — set one field; decoded into the field type (texture slots take
    an image GUID), routed through the scoped `History` (undoable + audited) and
    autosaved to the asset file.
  - `asset.save` — force an immediate write to the asset's project file.

  Adds `AssetServer.locationForGuid` (the manifest path for a GUID) so a save can
  resolve the target file. Verified live: `asset.setField roughness` persisted to the
  `.remat`, `history.undo` reverted + re-saved it, `asset.save` wrote on demand.

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

### Patch Changes

- Updated dependencies [45c51aa]
- Updated dependencies [1b9b7f5]
- Updated dependencies [6ce8fae]
- Updated dependencies [952766f]
- Updated dependencies [937f2cb]
- Updated dependencies [b315044]
- Updated dependencies [d5424c3]
- Updated dependencies [d4b6766]
- Updated dependencies [e0c4984]
- Updated dependencies [15617ff]
- Updated dependencies [c1b257b]
- Updated dependencies [ab6e7b9]
- Updated dependencies [1b66f35]
- Updated dependencies [01e2615]
- Updated dependencies [7142f6f]
- Updated dependencies [7e26e59]
- Updated dependencies [e73d32e]
- Updated dependencies [9c36012]
- Updated dependencies [12eb41d]
- Updated dependencies [773fabd]
- Updated dependencies [afc904c]
- Updated dependencies [3b3cf7f]
- Updated dependencies [a9837c6]
- Updated dependencies [f8079c6]
- Updated dependencies [e8c703e]
- Updated dependencies [8029403]
- Updated dependencies [2324f9f]
- Updated dependencies [5ea3e80]
- Updated dependencies [2f22822]
- Updated dependencies [62e382e]
- Updated dependencies [5d7a21a]
- Updated dependencies [8d36fd7]
- Updated dependencies [3b04954]
- Updated dependencies [a39203c]
- Updated dependencies [9e2aaf5]
- Updated dependencies [dc943f5]
- Updated dependencies [77f0ed5]
- Updated dependencies [2abd75c]
- Updated dependencies [3df2cb6]
- Updated dependencies [0625db9]
- Updated dependencies [4c93e0b]
- Updated dependencies [1280e03]
- Updated dependencies [fdde82f]
- Updated dependencies [1cdff13]
- Updated dependencies [1c76eef]
- Updated dependencies [d8b7fc2]
- Updated dependencies [5ea3e80]
- Updated dependencies [68963c6]
- Updated dependencies [be766a4]
- Updated dependencies [bc7640e]
- Updated dependencies [cad5613]
- Updated dependencies [4ca7beb]
- Updated dependencies [e163274]
- Updated dependencies [5317052]
- Updated dependencies [2a7a18b]
- Updated dependencies [da51d57]
- Updated dependencies [fad8a5e]
- Updated dependencies [bb91444]
- Updated dependencies [1c4a0fe]
- Updated dependencies [782c7f8]
- Updated dependencies [18d91c3]
- Updated dependencies [beff5bc]
- Updated dependencies [a0f614e]
- Updated dependencies [c4bf47a]
- Updated dependencies [7812b83]
- Updated dependencies [7a1d32c]
- Updated dependencies [8e4574a]
- Updated dependencies [be4aad1]
- Updated dependencies [0eca147]
- Updated dependencies [88d0fc5]
- Updated dependencies [ecfc0e3]
- Updated dependencies [01070b1]
- Updated dependencies [b788a60]
- Updated dependencies [a3b6d83]
- Updated dependencies [43cae6c]
- Updated dependencies [90a56e2]
- Updated dependencies [88d3ca3]
- Updated dependencies [b5e3322]
- Updated dependencies [10bda28]
- Updated dependencies [ca1cafa]
- Updated dependencies [e97fdd2]
- Updated dependencies [3db9d87]
- Updated dependencies [0c7b778]
- Updated dependencies [781aa88]
- Updated dependencies [7142f6f]
- Updated dependencies [eb3c452]
- Updated dependencies [e6728cc]
- Updated dependencies [8029403]
- Updated dependencies [d63d0f9]
- Updated dependencies [c049410]
- Updated dependencies [707714f]
- Updated dependencies [3658119]
- Updated dependencies [ac35dac]
- Updated dependencies [3280a8e]
- Updated dependencies [ca677c6]
- Updated dependencies [abbd55c]
- Updated dependencies [67e8513]
- Updated dependencies [8ac39a9]
- Updated dependencies [92d6c91]
- Updated dependencies [75a1a8a]
- Updated dependencies [e6728cc]
- Updated dependencies [a896a3b]
- Updated dependencies [5be634a]
- Updated dependencies [690c811]
- Updated dependencies [da1f0eb]
- Updated dependencies [1b98dc4]
- Updated dependencies [7dc7bca]
- Updated dependencies [5c33631]
- Updated dependencies [fa2678b]
- Updated dependencies [67e8513]
- Updated dependencies [836a7ab]
- Updated dependencies [ea56975]
- Updated dependencies [6fbb29d]
- Updated dependencies [d25c7aa]
- Updated dependencies [4015d71]
- Updated dependencies [82ecdec]
- Updated dependencies [bcef667]
- Updated dependencies [c26f7a3]
- Updated dependencies [7b8eeea]
- Updated dependencies [8a6fb8f]
- Updated dependencies [ae68f06]
- Updated dependencies [9712180]
- Updated dependencies [bc24cd2]
- Updated dependencies [f45c5f0]
- Updated dependencies [47372a5]
- Updated dependencies [73fdef4]
- Updated dependencies [88c4629]
- Updated dependencies [93f4053]
- Updated dependencies [ba77627]
- Updated dependencies [f2f082b]
- Updated dependencies [641b263]
- Updated dependencies [7812b83]
- Updated dependencies [48686b4]
- Updated dependencies [bc634ae]
- Updated dependencies [f95bac1]
- Updated dependencies [7dddd6f]
- Updated dependencies [a0fb8d4]
- Updated dependencies [7142f6f]
- Updated dependencies [d59a122]
- Updated dependencies [acae153]
- Updated dependencies [8934a75]
- Updated dependencies [b1a1e01]
- Updated dependencies [591fdef]
- Updated dependencies [2beee52]
- Updated dependencies [05b372f]
- Updated dependencies [5cf81f9]
  - @retro-engine/engine@0.1.0
  - @retro-engine/editor-sdk@0.1.0
  - @retro-engine/assets@0.1.0
  - @retro-engine/gltf@0.1.0
  - @retro-engine/renderer-core@0.1.0
  - @retro-engine/reflect@0.1.0
  - @retro-engine/ecs@0.1.0
  - @retro-engine/graph-editor@0.1.0
  - @retro-engine/mcp-protocol@0.1.0
