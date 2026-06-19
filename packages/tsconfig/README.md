# @retro-engine/tsconfig

Shared TypeScript base config for Retro Engine game projects.

```jsonc
// your-game/tsconfig.json
{
  "extends": "@retro-engine/tsconfig/tsconfig.json",
  "include": ["src/**/*.ts", "assets/**/*.ts"]
}
```

Matches the engine's own compiler settings (`moduleResolution: "Bundler"`, strict mode,
`verbatimModuleSyntax`) so types resolve identically to how the engine is authored.
