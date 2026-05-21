# ADR-0004: Publishing and Versioning

- **Status:** Accepted
- **Date:** 2026-05-21

## Context

Engine packages must be publishable privately (the source is not public). The studio is a desktop app that ships as a downloadable bundle, not as an npm package. We want a consistent versioning story across all engine packages, with predictable release lines for stable, release-candidate, beta, and alpha cuts.

## Decision

- **Engine packages publish to [GitHub Packages](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry)** under the `@retro-engine` npm scope. Configured via root `.npmrc`.
- **Versioning is via [Changesets](https://github.com/changesets/changesets)**, with restricted access (`"access": "restricted"` in `.changeset/config.json`).
- **Semver.** Major = breaking, minor = additive, patch = bugfix.
- **Prereleases via Changesets pre-mode.** `bunx changeset pre enter rc` → versions become `X.Y.Z-rc.0`, `-rc.1`. Same for `beta`, `alpha`. `bunx changeset pre exit` returns to stable.
- **Dist tags:** `latest` (stable), `next` (mainline), `rc`/`beta`/`alpha` (prerelease lines).
- **PRs touching `packages/*/src/**` require a changeset.** Warning-only during pre-0.1.0 scaffold phase; hard fail after the first published version.
- **The studio is excluded** from Changesets via `"ignore": ["@retro-engine/studio"]`. It ships as a GitHub Release built by [`tauri-apps/tauri-action`](https://github.com/tauri-apps/tauri-action), triggered by tags matching `studio-v*` (e.g. `studio-v0.3.0-beta.1`).

## Consequences

**Easier:**
- Versioning is automated and auditable — every change has a markdown record in `.changeset/`.
- Prerelease lines are first-class, not afterthoughts.
- Studio releases are independent of engine package versions.

**Harder:**
- GitHub Packages auth requires every contributor to set up a personal access token. CI uses the workflow's `GITHUB_TOKEN`.
- Cross-package version bumps that change the API of a shared dep cascade through the dependency graph; Changesets handles this automatically but reviewers must understand the cascade.

## Implementation

- `.npmrc` — registry config + auth
- `.changeset/config.json` — Changesets config, `ignore: ["@retro-engine/studio"]`
- `.github/workflows/release.yml` — runs Changesets on `main`
- `.github/workflows/studio-release.yml` — Tauri build on `studio-v*` tag
- `packages/*/package.json` — `publishConfig.registry` set to GitHub Packages, `private: false`
- `apps/studio/package.json` — `private: true`
