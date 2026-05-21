# Editor SDK — `@retro-engine/editor-sdk`

- **Created:** 2026-05-21
- **Status:** Planning

## Goal

`packages/editor-sdk` is the public extension surface for the studio. Plugins can register custom windows, custom dialogs, custom inspectors, and custom asset importers without forking the studio. The SDK is the only thing third-party tooling depends on; the studio's internals stay private.

## Phases

1. **Window registration API** — declare a window class (or factory), get a slot in the studio's docking layout. Lifecycle hooks: `onOpen`, `onTick`, `onClose`.
2. **Dialog API** — modal and modeless dialogs, return promises for results.
3. **Inspector registration** — given a component type, register a custom editor view. Defaults to a generic reflective inspector.
4. **Menu / command palette API** — register commands; bind keyboard shortcuts.
5. **Plugin manifest + loader** — declare plugins in `retro-project.json` or similar; hot-reload during dev.
6. **Engine introspection** — read-only access to the running `App` for editor-side queries.

## Open questions

- Are plugins JS modules (dynamic import) or bundled at build time? Dynamic import is more flexible but requires careful sandboxing.
- What gets re-exported from `editor-sdk` vs kept studio-internal? Anything reachable becomes API surface.
- Inspector reflection: TC39 decorators, runtime registry, or schema files?
- Cross-plugin communication: event bus, direct calls, or strict isolation?

## Links

- ADR-0001 — architecture foundations (composition + plugins)
- ImGui's docking branch: https://github.com/ocornut/imgui/wiki/Docking
- Sanity Studio's plugin API (reference shape)
