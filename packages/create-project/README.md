# @retro-engine/create-project

Scaffolds a new Retro Engine game project.

```sh
bunx @retro-engine/create-project my-game
```

Generates the `project.retroengine` descriptor, a Bun/TS project skeleton
(`package.json`, `tsconfig.json` extending `@retro-engine/tsconfig`, `bunfig.toml` for the
registry scope), `src/game.ts` + `src/editor.ts`, a free-form `assets/` content root, and
editor file associations, then runs `bun install`.

Flags: `--name <name>`, `--dep-spec <spec>` (e.g. a `link:` spec for local development),
`--no-install`.
