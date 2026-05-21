# Changesets

This folder holds [Changesets](https://github.com/changesets/changesets) — small markdown files that describe what changed in a PR and how it should bump package versions.

## How to add one

```sh
bunx changeset
```

Pick the affected packages, choose a bump level (major / minor / patch), and write a one-line summary. Commit the resulting `.md` file with your PR.

## Lifecycle

1. PRs that change `packages/*/src/**` add a changeset.
2. On merge to `main`, the `release.yml` workflow opens a "Version Packages" PR aggregating all pending changesets.
3. Merging that PR publishes the affected packages to GitHub Packages.

## Prereleases

```sh
bunx changeset pre enter rc
# ... make changes, add changesets ...
bunx changeset version  # bumps to X.Y.Z-rc.N
# ... merge to main, release PR cuts an rc ...
bunx changeset pre exit  # return to stable
```

Same flow for `beta` and `alpha`. See [ADR-0004](../docs/adr/ADR-0004-publishing-and-versioning.md).

## What's excluded

- `@retro-engine/studio` is in `config.json` `ignore`. It releases via GitHub Releases on `studio-v*` tags, not via Changesets.
