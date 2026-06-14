# Editor Viewport

- **Created:** 2026-06-14
- **Status:** In progress — step 1 landed (ADR-0074): the engine renders live into the Scene/Game tabs

## Goal

The studio's Scene and Game tabs are real, interactive editor viewports. The Scene tab is an **edit** view (free camera, selection, gizmos); the Game tab is a **play** view that always renders the scene and runs game logic only while playing. Selecting and manipulating entities works by pointing at the viewport. Success: an author can frame the scene, click to select an object, move it with a gizmo, and hit Play to simulate — all inside the docked tabs.

## Phases

1. **Renderable in the editor** — done (ADR-0074): two offscreen viewport textures, an editor camera and a game camera rendering a lit/shadowed/anti-aliased scene into the Scene/Game tabs, sized to their panels. Panel-local cursor + visibility are plumbed but unused.
2. **Viewport ray-picking / selection** — turn `ViewportTarget.localMouse` into a world ray (panel UV → NDC → inverse view-projection), hit-test scene entities, drive the selection state the inspector/hierarchy already use. Promote to `docs/backlog/viewport-picking.md` when scheduled.
3. **Edit-mode interaction** — transform gizmos (translate/rotate/scale) in the Scene tab; free-fly / orbit controls for the editor camera.
4. **Play/pause semantics** — the Game tab keeps rendering at all times; Play toggles only the simulation schedule (gameplay systems), never the camera render. Likely an app state / run-condition gating those systems.

## Open questions

- **Editor entities vs. user scene.** Editor infrastructure (the editor free-look camera, the clear-only camera, future gizmos) must not appear in the scene hierarchy or be serialized into a saved scene. Plan: a marker (`EditorCameraTag` already exists) excludes them from the hierarchy query and the serializer; the cleaner long-term shape is explicit scene membership (the hierarchy shows what belongs to the loaded scene, editor runtime entities live outside that set). Likely an ADR when live hierarchy + scene loading land.
- **The Game view follows the user's camera — it does not tag it.** The game camera is authored by the user as scene content. The studio identifies the user's active/primary camera and redirects its render target into the Game tab (today done by texture-identity matching on the reference camera); it never stamps an editor marker onto a user entity. Only the editor's own camera is a tagged, non-serialized, hierarchy-hidden editor entity.
- Where the editor camera state lives (a studio resource vs. a tagged entity) and how its controls integrate with the input system.
- Ray-pick hit-testing strategy: broad-phase against `GlobalTransform` + mesh AABBs first, then optional precise test; how it interacts with instancing.
- Play/stop world model: one world with gated systems, or a separate play world snapshot/restore.
- Per-tab active-camera gating: skip rendering a viewport whose tab is hidden (`visibleThisFrame`) to save a pass.
- jsimgui texture-handle churn on resize (no unregister API) — debounce resize, or land an upstream unregister.

## Links

- Related ADRs: [ADR-0074](../adr/ADR-0074-studio-viewport-render-to-texture.md) (this initiative's step 1), [ADR-0072](../adr/ADR-0072-imgui-editor-ui-layer.md) (overlay), [ADR-0073](../adr/ADR-0073-editor-shell-and-componentry.md) (shell).
- Related roadmap: [studio-imgui.md](studio-imgui.md).
