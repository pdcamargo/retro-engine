# Retro Engine

TypeScript game engine inspired by [Bevy](https://bevy.org/): archetype-based ECS, WebGPU renderer built from scratch, plus a Tauri + Bun + ImGui desktop studio for tooling.

## Layout

| Path | What |
| --- | --- |
| `packages/ecs` | Archetype ECS — entities, components, systems, queries. |
| `packages/math` | Math primitives, wrapping [`wgpu-matrix`](https://wgpu-matrix.org/). |
| `packages/renderer-core` | Hardware abstraction layer (HAL) — pure interfaces, no implementation. |
| `packages/renderer-webgpu` | WebGPU implementation of `renderer-core`. |
| `packages/renderer-webgl2` | Stub. WebGL2 fallback target, implemented later. |
| `packages/engine` | App, plugins, schedules — the surface a game targets. |
| `apps/studio` | Tauri 2.x + Bun + jsimgui editor application. |

`editor` is a reserved *namespace* for future packages (`editor-sdk`, `editor-runtime`, etc.). The shipping desktop app is `studio` to avoid collision.

## Day-1 commands

```sh
bun install
bun run build
bun run lint
bun run test
bun run typecheck
```

For the studio:

```sh
cd apps/studio
bun run tauri:dev
```

## Documentation

- `CLAUDE.md` — operating rules for humans and AI agents in this repo.
- `docs/adr/` — architecture decisions, permanent record.
- `docs/backlog/` — deferred work.
- `docs/bugs/` — known bugs.
- `docs/roadmap/` — multi-step initiatives and milestones.

See each folder's `README.md` for naming and lifecycle.

## Publishing

Engine packages publish to **GitHub Packages** via [Changesets](https://github.com/changesets/changesets). The studio ships as a GitHub Release via [`tauri-apps/tauri-action`](https://github.com/tauri-apps/tauri-action), triggered by tags matching `studio-v*`.

See [`docs/adr/ADR-0004-publishing-and-versioning.md`](docs/adr/ADR-0004-publishing-and-versioning.md).
