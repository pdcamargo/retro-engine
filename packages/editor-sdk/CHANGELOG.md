# @retro-engine/editor-sdk

## 0.1.0

### Minor Changes

- 6ce8fae: feat(editor-sdk): asset-card thumbnails

  Per ADR-0101, the asset browser can now paint a generated preview texture in a
  tile instead of the procedural placeholder.

  - `AssetCardOptions.thumbnail?: ImTextureRef` — an optional preview master drawn
    in the tile (over a checkerboard, so transparent images read correctly),
    sampled to whatever tile size is shown. Absent → the existing procedural
    preview for the asset type. Existing callers are unaffected.
  - `Draw.image(ref, min, max)` — paint a registered texture into a draw-list
    rectangle in screen space.

- 952766f: feat(editor-sdk): asset selection + asset-editor registry

  The inspector can now edit a selected **asset**, not just an entity.

  - `AssetSelection` (`assetType` + `guid` + `assetKind`) — the asset counterpart to
    selecting an entity.
  - `AssetEditorRegistry` (on `Editor.assetEditors`, parallel to `Editor.inspector`):
    register a custom editor per asset type. An asset type with no registered editor
    falls back to the default reflection walk, so a reflected asset (e.g. a material,
    whose `Handle<Image>` texture slots render with the existing asset-picker) is
    editable with no registration. `AssetEditor` / `AssetEditorContext` describe the
    editor surface.

  The studio wires this into the inspector: selecting a material shows its fields
  (Base Color, Metallic, Roughness, the texture slots, …); edits route through the
  scoped `History` and persist to the asset's `.remat`.

- d4b6766: feat(editor-sdk): asset field widget + handle-field editing surface

  Per ADR-0110, adds the inspector surface for editing `t.handle(...)` (asset handle) properties, which the studio wires into an asset picker.

  **New public surface:**

  - `Widgets.assetField(id, options)` / `AssetFieldOptions` — an input-like asset slot (à la Unity's object field): a swatch (thumbnail or type icon), the assigned asset's name (or a muted "None"), a type tag, and a target affordance. It only reports clicks, so assignment stays decoupled from the click-to-open flow.
  - `PropertyContext.componentName` — the owning registered type's stable name, for renderers that label cross-cutting UI.
  - `propertyRow`, `labeledRow`, `labelColumnWidth` re-exported for custom renderers laying out a labeled inspector row.

  **Behaviour change:**

  - The property dispatcher no longer short-circuits a nullish value to a read-only `(unset)` row for `kind === 'handle'` — a reference renderer is dispatched even when the slot is empty, so it can draw an "assign" affordance. Other kinds keep the `(unset)` / `(null)` fallback.

- 7e26e59: feat(engine): bundles — a named, introspectable component-group abstraction

  Per ADR-0108, a Bundle is a named group of components with optional per-property default values — the engine's introspectable equivalent of a Bevy bundle. A bundle is a pure authoring-time template: spawning it stamps fresh, independent component instances onto an entity, with no live link back to the definition.

  A `BundleDefinition` stores its components as `SerializedValue[]` (the same `{ type, version, data }` shape scenes and `.remat` materials use), so code-defined and asset-authored bundles share one representation and a `.rebundle` file is the on-disk mirror of the in-memory definition.

  **New engine surface:**

  - `App.registerBundle(name, components, opts?)` — register a code-defined bundle from live component instances; their authored field values are captured.
  - `AppBundleRegistry` — per-App registry of `BundleDefinition`s (created with the App); tooling reads it.
  - `BundleDefinition`, `BundleRegisterOptions`, `instantiateBundle(app, def)` — build fresh, independent instances ready for `World.insertBundle`.
  - `.rebundle` asset type: `BUNDLE_ASSET_KIND`, `BUNDLE_ASSET_EXTENSION`, `BUNDLE_FORMAT_VERSION`, `serializeBundle`, `deserializeBundle`, `createBundleSerializer`, and `BundlePlugin` (registers the serializer).
  - `bundleEncodeEnv`, `bundleDecodeEnv`, `encodeBundleComponents` — codec envs (handles round-trip by GUID; entity refs rejected).

  **New editor-sdk surface:**

  - `AddBundleCommand` (+ `BundleComponentEntry`) — inserts a whole bundle's components in one `World.insertBundle` (a single archetype transition and a single undo step); undo removes them.
  - `createInstanceEmitter` — an `EditEmitter` that writes edits into a detached component instance (no world / no history), so the reflective property inspector can edit values outside the ECS (e.g. a bundle draft).

  Bundles are not components and carry no reflection schema — they never live on an entity and are never serialized into a scene; only the components they stamp are.

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

- 9e2aaf5: feat(editor-sdk): custom font loading (JetBrains Mono default + named faces)

  Add font support to the UI layer. `renderer-core`'s `SurfaceOverlay` gains `loadFont(name, data)` (each backend forwards to the binding's font store); `editor-sdk` adds `registerFonts` / `FontSpec`, a `fonts` plugin option (async — bytes are typically fetched) that registers faces, sets the default (`io.FontDefault`) and base size, and `ui.withFont(name, size, body)` to render a scope in a named face (e.g. a pixel display font). Uses Dear ImGui 1.92's size-scalable font path. Font files are supplied by the consumer; none are bundled.

- dc943f5: feat(editor-sdk): draw-list text/bezier primitives + input passthroughs

  Additive surface for the graph-editor toolkit (ADR-0138), useful to any panel:

  - `Draw.textAt(pos, col, text, { font?, size? })` — pure draw-list text via
    `AddTextImFontPtr` with an explicit pixel size and **no** ImGui item submission
    (unlike `Draw.text`), for high-volume transform-positioned labels.
  - `Draw.bezierCubic(p1, p2, p3, p4, col, thickness, segments?)`.
  - `ui` input passthroughs: `isWindowHovered`, `isWindowFocused`, `mouseWheel`,
    `isMouseDown` / `isMouseClicked` / `isMouseReleased` / `isMouseDoubleClicked`,
    `isMouseDragging`, `mouseDragDelta`, `resetMouseDragDelta` — so consumers gate
    navigation/drag without reaching past the SDK to raw jsimgui.

- 77f0ed5: feat(editor-sdk): `ui.setKeyboardFocusHere(offset?)` for programmatic focus

  Adds a thin wrapper over Dear ImGui's `SetKeyboardFocusHere` to the normalized `ui` surface, so callers can focus a following widget (e.g. auto-focus a search field when a popup opens). `offset` selects which item ahead to focus (`0` = the next widget, the default).

- 2abd75c: feat(editor-sdk): mouse-position queries on the UI wrapper

  Add `ui.mousePos()` (screen space), `ui.windowPos()` (current window top-left, screen space), and `ui.windowMousePos()` (mouse relative to the current window's top-left — `(0, 0)` at the corner). Useful for picking and canvas interactions inside a panel.

- 3df2cb6: feat(editor-sdk): Retro Engine design-system theme (palette + full ImGui slot map)

  Replace the placeholder tokens with the Retro Engine design system: a phosphor-green-on-cool-charcoal palette plus the complete `ImGuiCol_` slot map and `ImGuiStyle` spacing/border/rounding/alignment vars, with the design's opinions baked in (green is a highlight only, surfaces step up the neutral ramp on hover→active, 1px borders over shadows, sharp corners, selected tab merges into its panel body under a green overline).

  `ThemeTokens` is now `{ palette, metrics }` — the `RetroPalette` (~21 sRGB colors) is the canonical reskin knob; `applyTheme` maps it onto every slot. Adds the `FontScale` type ramp. `resolveTheme` normalizes metrics (clamps lengths and alignments). Font loading (JetBrains Mono / Silkscreen) is deferred — the theme uses the default font for now.

- 0625db9: feat(editor-sdk): editor shell framework + component library + drawn icons (ADR-0073)

  Builds the registry-driven editor shell and the design-system component library on top of the normalized `ui` surface from ADR-0072, plus a procedural icon set.

  **Editor shell** (`createEditor`): a composition-only `Editor` that owns the menu bar, a pinned toolbar/status rail, a dockspace host, and the per-frame panel draw. Panels register by a path-like id — `editor.addPanel({ id: '/inspector', slot: 'right', render })` — so a new dockable window needs no shell change; an auto-generated **Window** menu lists every panel's visibility toggle. `addMenu` / `setToolbar` / `setStatusBar` cover the chrome regions. `PanelContext` exposes only `ui` + `widgets`, keeping the shell engine-agnostic. The default dock layout is a generated `ini` (`buildDefaultLayout`, stable `DockNodeId` constants) bound to the host window, since the binding exposes no `DockBuilder`.

  **Component library** (`widgets`): the design-system componentry composed on `ui` — button variants, `iconButton`, `Switch`, `Badge`, `dragNumber` (axis chips), `vec3`, sliders, `inputNumber`, `combo`, `radioGroup`, `listBox`, `colorField`, `inspectorRow`, `collapsingHeader`, `treeItem`, `dataTable`, `assetCard`/`assetGroup` (+ `ASSET_TYPES`), context menus, and a centered modal `dialog`. Edit widgets take a value and return the next.

  **Icons**: `drawIcon` renders the editor's Lucide-named icon vocabulary procedurally with draw-list primitives — asset-free and immune to the binding's font-rasterizer and `AddText` defects. The Lucide name→codepoint map (`iconGlyph`, `LUCIDE_CODEPOINTS`) and font-merge support ship for a future binding that can rasterize an icon font.

  **Surface additions**: the `Ui` surface gains child regions, groups, text/number/color inputs, layout cursors, `icon`, and popups; `FontSpec` gains `merge`/`glyphRanges`; `RetroPalette` gains `red400`, `magenta400`, and `textMuted` so axis/danger/play-mode/label colors come from the theme. `Draw` gains a draw-list facade with the logo cube and a native-text fallback.

  **renderer-webgpu**: `createImGuiOverlay(renderer, { fontLoader })` selects the truetype (default) or freetype glyph backend.

- 4c93e0b: feat(editor-sdk): live-world introspection readers for editor hierarchy + inspector

  UI-agnostic readers that turn a running ECS `World` (plus the App's reflection registry) into view-models an editor draws, realizing the editor-sdk roadmap's "engine introspection" phase. Data-reading stays separate from widget-drawing by file; the studio panels map these onto existing widgets.

  - `buildOutline(world, opts?)` — flattens the world into depth-tagged `OutlineNode`s by walking the `Parent` edge, so authored scenes, prefab expansions, nested scene instances, and imported model graphs all surface uniformly. Supports `isOpen` / `skip` predicates and an extensible `EntityClassifier` chain (icon/kind per entity; ships engine-known defaults, consumers prepend their own).
  - `listComponents(world, registry, entity)` — each attached component tagged serializable (has a reflection schema) or derived, mirroring the engine's authored-vs-derived split; serializable first.

  Adds type-level `@retro-engine/ecs` and `@retro-engine/reflect` dependencies (an editor introspection surface legitimately needs the World and reflection types).

- fad8a5e: feat: gizmos + debug-draw system and editor transform gizmos (ADR-0075)

  An engine-level, immediate-mode, world-space `Gizmos` debug-draw API rendered through a dedicated line pass, plus editor transform gizmos built on top of it. The gizmo pass renders into both `Core2d` and `Core3d`, after the transparent/post passes and before tonemapping, and gates each draw by the camera's render layers — a reserved `EDITOR_GIZMO_LAYER` keeps editor-only visuals out of the game view. This is the documented, scalable pattern for separating editor visuals from game visuals; the debug-draw API itself is exposable to user game code.

  **`@retro-engine/math`** — new geometry primitives for picking and gizmo math, projection-agnostic (correct under perspective and orthographic):

  - `Ray` + `Ray.fromScreen` (NDC → world ray unprojection, WebGPU `[0,1]` depth).
  - `rayPlaneIntersect`, `rayClosestPointToRay`, `signedAngleOnPlane`.
  - `screenSpaceScale` — world length that subtends a target pixel size, for constant-on-screen gizmo sizing.

  **`@retro-engine/engine`** — immediate-mode gizmo rendering:

  - `Gizmos` resource with `line` / `lineGradient` / `ray` / `circle` / `arc` / `sphere` / `cuboid` / `arrow` / `axes` / `grid`, each tagged with a render-layer mask and depth-test flag, cleared per frame.
  - `GizmoPlugin` (auto-added by `CorePlugin`), the `Core2d`/`Core3d` line pass, and `EDITOR_GIZMO_LAYER` / `EDITOR_GIZMO_MASK` for editor-only visuals.

  **`@retro-engine/editor-sdk`** — `TransformGizmo`: interactive Move / Rotate / Scale / All handles in 2D and 3D, editing one or more targets about their shared centroid, with constant on-screen sizing, a live drag readout (delta / angle / factor), and Escape-to-cancel.

- 7a1d32c: feat(editor-sdk): history view + jump navigation for the studio history panel (ADR-0083)

  Adds an additive read + navigation surface to `History`, sized for a dedicated undo/redo timeline UI. `entries()` and `HistoryEntrySummary` are unchanged.

  **New public surface:**

  - `History.view()` → `HistoryView` — the full timeline oldest-first (applied past, then the redoable future) plus `currentIndex`, the cursor at the live state (`-1` when empty). A pending mid-drag edit does not appear until it commits.
  - `History.jumpTo(index)` — moves the world to the state at `index`, stepping undo/redo as needed, clamped to the timeline, firing `onChange` at most once for the whole jump.
  - `HistoryEntryView` / `HistoryEntryKind` — a per-entry view carrying label + category and, for single-command entries, the target (`entity` / `componentName`) plus the edited `field` and `before`/`after` for `setField`. Enough for a view to derive its icon, tone, target name, and delta; presentation is not stored on commands.

  The studio gains a HISTORY panel built on this (git-style rail, glowing current node, dimmed redo tail, click-to-jump, header undo/redo/clear, footer step count) — that panel lives in the unpublished `apps/studio` and is not part of this package's surface. No timestamps are captured (the optional time-ago column is left out); branching remains unsupported.

- 0eca147: feat(editor-sdk): immediate-mode UI layer over Dear ImGui (ADR-0072)

  Adds `@retro-engine/editor-sdk` with a normalized, typed, tokenized immediate-mode `ui` wrapper over `@mori2003/jsimgui` — the only public UI surface; raw jsimgui stays internal. `renderer-core` gains a backend-neutral `SurfaceOverlay` contract; `renderer-webgpu` and `renderer-webgl2` each implement it (`createImGuiOverlay(renderer)`), with the device-specific draw kept behind the HAL. The overlay backend is selected from the active renderer at runtime (WebGPU-first, WebGL2 reachable), injected at startup, and themed by design tokens. Includes optional window docking (`uiOverlayPlugin({ docking: true })`, `ui.dockSpaceOverViewport`, per-window `dock`) and dock-layout save/restore via `saveLayout`/`loadLayout` and a `layout` option (default layout + consumer-provided persist/restore sinks) so an editor can ship a default layout and persist user changes.

- ecfc0e3: feat(editor-sdk): `InspectorRegistry.describe()` enumerates customizations (ADR-0094)

  Adds `InspectorRegistry.describe(): readonly InspectorCustomization[]` — reports which
  components have a custom whole-component editor, per-field renderers, or amendments. Feeds
  the studio's project index (a "this component has a custom editor" view). Global
  kind/widget/type renderers are not per-component and are not reported.

- e97fdd2: feat(engine): MakeHuman `.target` ingestion — sparse morph-target assets

  Ingests MakeHuman's topology-locked `.target` files as discoverable engine assets, the edit-time
  full-customization data RetroHuman's character creator composes onto a base mesh (ADR-0130).

  - `SparseMorphTarget` + `parseSparseMorphTarget` (`@retro-engine/engine`): a sparse per-vertex
    position delta set (`name`, `indices`, `deltas`) storing only moved vertices, with `maxIndex`,
    `fitsBase(n)`, and `toDense(n)`. The strict parser handles MakeHuman's `vertexIndex dx dy dz` lines
    (leading-dot floats, `#` comments) and throws on corruption.
  - Asset kind `'MorphTarget'` (extension `target`, discoverable, category `morph`): `SparseMorphTargets`
    store + `createSparseMorphTargetImporter`, registered by `MorphPlugin`. A loose `.target` file mints
    a `.meta` and loads through the AssetServer. Topology-lock (index-vs-base alignment) is validated at
    composition (`fitsBase`/`toDense`), since a `.target` carries no base-mesh reference.
  - `@retro-engine/editor-sdk`: a `'morph'` `AssetType` (scan-face icon) so the studio browser shows
    morph targets with their own category.

  Verified in the studio: a vendored MakeHuman `.target` dropped into a project is discovered, sidecar'd
  as `MorphTarget`, and loads into a `SparseMorphTarget` (311 vertices, indices within the base's 19,158).

- 92d6c91: feat(engine): garment asset kind + studio fitting — clothes follow body shape

  Completes RetroHuman Phase 4 (ADR-0133): garments load as assets and follow the body when it morphs.

  - `ProxyPlugin` registers a `.mhclo` asset kind (`ProxyFitting`, discoverable, category `garment`):
    `ProxyFittings` store + `createProxyFittingImporter` (uses `parseMhclo`). The garment's geometry
    loads as an ordinary `ObjMesh` (vertex-order, so binding `i` pairs with proxy vertex `i`).
  - `@retro-engine/editor-sdk`: a `'garment'` `AssetType` (shirt icon) for the studio browser.
  - Studio character-creator panel: discovers `garment` assets, loads each fitting + its proxy mesh,
    spawns it as a sub-mesh, and re-fits (`fitProxy`) onto the live body on every morph edit.

  Verified live: a garment bound to nose-region base verts moved with the body (vertex Δy = −0.564 when
  the nose morphed), renderer healthy. Skeleton-driven pose-follow comes free once the shared skeleton is
  wired (Phase 5).

- 1b98dc4: feat(editor-sdk): reflective property inspector + undo/redo edit history (ADR-0082)

  Adds the studio's editable, reflection-driven inspector and the undo/redo pipeline behind it. Two layers joined by one boundary: a render side that turns a component's reflection schema into typed field widgets, and a write side that routes every edit through an undoable command history. With nothing registered, any component with a reflection schema renders fully and editably through baseline renderers.

  **New public surface:**

  - **Inspector render layer** — `renderComponentBody` / `RenderComponentBodyRequest` (per-component entry point), `renderPropertyField` / `PropertyFieldRequest` (the field dispatcher), `PropertyContext`, `PropertyRenderer`, `ChildRequest`. `InspectorRegistry` + `createInspectorRegistry` + `ComponentKey` — register custom renderers (by `FieldKind`, widget id, nested type, or exact field), whole-component `ComponentEditor`s, and per-field `FieldAmendment`s. `resolveMeta` / `ResolvedFieldMeta` / `humanize`. `defaultComponentEditor` / `ComponentEditorContext`. Bridge helpers `colorToHex` / `hexToColor` / `defaultValueFor`.
  - **Edit pipeline** — `History` (`HistoryOptions`, `HistoryEntrySummary`): undo/redo with drag coalescing, capacity, and batches. `EditEmitter` / `ScalarEdit` / `ItemEdges` with `createDirectEmitter` (no history) and `createHistoryEmitter` (undoable) — the boundary renderers depend on. `EditCommand` data IR (`setField` / `addComponent` / `removeComponent` / `custom`) with `applyEdit` / `revertEdit` / `EditTarget` / `writeFieldLive`. `FieldPath` / `FieldPathSegment` / `pathKeyOf` / `readPath` / `writePathLeaf`. `snapshotValue` / `snapshotComponent` / `valueEquals`.
  - **`Editor.inspector`** — the `InspectorRegistry` instance, the studio/plugin registration surface.
  - **`ui` additions** — `isItemActivated`, `isItemDeactivatedAfterEdit`, `isItemEdited`, `itemEdges`, `withDisabled`.

  Renderers never touch the ECS world — they emit through `EditEmitter`, so undo is correct by construction and a continuous scrub coalesces into a single entry (driven by the ImGui item-deactivation edge). Reference pickers (entity/handle), `mat4` editing, structural array/component edits, a history-panel UI, and decorator sugar are deferred (tracked in backlog).

  Quaternion fields render as raw `x/y/z/w` by default, with opt-in `'euler'` (X/Y/Z degrees, matching `quat.fromEuler(…, 'xyz')`) and `'angle2d'` (a single 2D rotation about +Z) widget renderers — select per field via a schema `widget` hint or an `editor.inspector.amend(…, { widget })`. A component's field labels share one column width (the widest label + a gap) so labels align and never overlap their controls, and an unset optional/nullable field renders read-only as `(unset)`.

- ae68f06: feat(editor-sdk): scope-generic edits (entity or asset)

  Generalizes the edit/undo stack so an edit can target an entity component **or** a
  stored asset value — the foundation for editing assets (materials) in the
  inspector with the same undoable, audited path as entity edits.

  - `EditScope` (`{kind:'entity',entity,componentName}` | `{kind:'asset',assetKind,guid}`),
    with `entityScope` / `assetScope` / `scopeKey` / `scopeLabel`.
  - `SetFieldCommand` carries a `scope` instead of bare `entity` + `componentName`;
    `applyEdit` / `revertEdit` route a field write to the live world or to an asset
    store. `EditTarget` gains an optional `assets` port (`AssetEditAccess`:
    `getMut` + `markDirty`) for asset-scoped writes; `writeAssetFieldLive` /
    `writeScopedLive` are exported.
  - `History` is keyed on scope (`previewScoped` / `syncScoped` / `commitScoped`);
    the existing `preview` / `sync` / `commit` (entity) keep working as wrappers, so
    the inspector and MCP `component.set` are unchanged.
  - `createAssetHistoryEmitter` / `createScopedHistoryEmitter` produce
    asset-scoped emitters; renderers depend only on `EditEmitter` and are unchanged.

- acae153: feat: sub-asset references + derived-asset asset browser

  Per ADR-0126, gives a container's decoded children (a model's meshes, materials, and animation clips) a persistent, resolvable identity so a saved reference to one survives reload — and surfaces them in the studio's rebuilt asset browser.

  **`@retro-engine/assets`** — `subAssetGuid(parent, label)` / `parseSubAssetGuid(guid)`: the composite GUID-URI (`"<parentGuid>#<label>"`) that names a labeled sub-asset deterministically from its container's GUID. A single string, so it serializes and resolves exactly like a top-level GUID.

  **`@retro-engine/engine`** — `AssetServer.registerSubAssetStore(prefix, store)` binds a label prefix to the store that holds those sub-assets; `loadByGuid` now resolves a sub-asset reference by reserving the slot and loading the parent so its `addLabeledAsset` fills it (matched by GUID), and `hasGuid` recognizes sub-refs whose container is resolvable. `addLabeledAsset` mints the deterministic sub-GUID when a parent GUID is present. The glTF `AnimationPlugin` registers the `Animation` prefix, so a model's clips are assignable to a `Handle<AnimationClip>` field and round-trip through scene save/load. `subAssetGuid` / `parseSubAssetGuid` are re-exported.

  **`@retro-engine/editor-sdk`** — `assetCard` returns `AssetCardResult` (`{ clicked, expandToggled, checkToggled, rightClicked }`) and takes an `onContextMenu` hook anchored to the tile; its error preview uses the triangle-alert glyph and sprites get a dashed cyan crop frame; the fold chip moved to the top-right to clear the type tag. `assetGroup` is generalized from sprite-only to any source file's mixed children: it takes `headerType` (drives the icon/tone) and a `summary` string instead of a sprite count, and draws the inset accent rail.

- 05b372f: feat(editor-sdk): viewport orientation gizmo

  Add `ViewportGizmo` — a configurable camera-orientation widget for editor viewports (the three.js/Blender-style sphere gizmo). It reflects the camera's orientation as six colored X/Y/Z balls and returns intents to **drag the body to orbit** or **click a ball to align** the view to that axis; a disc fades in on hover. A single `ViewportGizmoOptions` object (see `defaultViewportGizmoOptions`) drives size, placement, colors, opacity, labels, and animation, so the look is restyled without code changes; unset colors resolve from the active theme palette. The widget is pure — it draws through a `Draw` list and leaves applying intents to the host.

### Patch Changes

- 01e2615: fix(editor-sdk): draw vector-field axis chip letters in a dark color

  The X / Y / Z letters on `dragNumber` / `vec3` axis chips were drawn in near-white over the bright red / green / cyan chip fills, leaving them effectively unreadable. They now use the palette's darkest tone, restoring contrast against every axis chip color.

- 73fdef4: feat(engine): skeletal-animation Phase 1 — clip playback (general property-animation system)

  Per ADR-0116 and ADR-0117, the engine gains a general keyframe-animation system: a clip is a
  set of tracks, each a **reflected property path + a keyframe sampler**, so a clip can animate
  any reflected field — bone `Transform`s, a light's `intensity`, a material color. Skeletal
  animation is the case where tracks target bone TRS; the Phase-0 skinning path then deforms the
  mesh automatically from the animated `GlobalTransform`s.

  **`@retro-engine/reflect`** — property-path machinery moves here as the shared source of truth
  for "what an inspector edits" and "what a clip animates":

  - `FieldPath` / `FieldPathSegment`, `readPath`, `writePathLeaf`, `pathKeyOf` — relocated from
    `editor-sdk` (which now re-exports them).
  - `resolveFieldType(schema, path)` — walks a registered schema to the leaf `FieldType`, so a
    caller learns a property's `kind` (and thus how to interpolate it) from its address.

  **`@retro-engine/engine`** — new `animation/` module:

  - `AnimationClip` asset (`.ranim`, registered via the asset-kind flow): `duration` + `tracks`,
    each track a `TrackTarget` (`targetId` + component name + `FieldPath`) and a `KeyframeSampler`
    (times/values/`componentCount`/interpolation).
  - `sampleInto` — pure LINEAR / STEP / CUBICSPLINE sampler; quaternion tracks use shortest-path
    spherical interpolation, vectors/scalars linear, with the glTF CUBICSPLINE tangent layout.
  - `AnimationPlayer` (clip handle + `speed`/`playing`/`repeat`; transient `time` cursor) and
    `AnimationTarget` (`id` + `player`) components, both with reflection schemas.
  - `AnimationPlugin` (added by `CorePlugin`) + the sampling system, which advances each player and
    writes its clip's tracks into the bound entities. Runs in the `update` stage, before
    `postUpdate` transform propagation, so a clip driving bone `Transform`s deforms the skinned
    mesh the same frame.

  **`@retro-engine/gltf`** — glTF `animations` are parsed into `AnimationClip`s whose tracks target
  node TRS (`Gltf.animationClips`); instantiation tags spawned nodes with `AnimationTarget` so a
  clip binds to the spawned bones. Morph-weight channels are parsed but skipped pending
  morph-target mesh support.

  **`@retro-engine/editor-sdk`** — `edit/field-path` re-exports the path machinery from `reflect`
  (no behaviour change; one source of truth).

- Updated dependencies [45c51aa]
- Updated dependencies [1b9b7f5]
- Updated dependencies [937f2cb]
- Updated dependencies [b315044]
- Updated dependencies [d5424c3]
- Updated dependencies [e0c4984]
- Updated dependencies [15617ff]
- Updated dependencies [ab6e7b9]
- Updated dependencies [1b66f35]
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
- Updated dependencies [9e2aaf5]
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
- Updated dependencies [1c4a0fe]
- Updated dependencies [c4bf47a]
- Updated dependencies [7812b83]
- Updated dependencies [8e4574a]
- Updated dependencies [be4aad1]
- Updated dependencies [0eca147]
- Updated dependencies [88d0fc5]
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
- Updated dependencies [f8079c6]
- Updated dependencies [75a1a8a]
- Updated dependencies [e6728cc]
- Updated dependencies [a896a3b]
- Updated dependencies [5be634a]
- Updated dependencies [690c811]
- Updated dependencies [da1f0eb]
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
- Updated dependencies [acae153]
- Updated dependencies [8934a75]
- Updated dependencies [b1a1e01]
- Updated dependencies [591fdef]
- Updated dependencies [2beee52]
- Updated dependencies [5cf81f9]
  - @retro-engine/engine@0.1.0
  - @retro-engine/renderer-core@0.1.0
  - @retro-engine/reflect@0.1.0
  - @retro-engine/ecs@0.1.0
  - @retro-engine/math@0.1.0
