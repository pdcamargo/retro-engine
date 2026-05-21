# Release Automation Hardening

- **Created:** 2026-05-21
- **Status:** Planning (do not start until first 0.1.0 ships)

## Goal

Post first stable publish, the release pipeline is production-grade: changelogs are polished, provenance/sigstore signing is on, snapshot releases work for feature branches, and the studio's GitHub Release flow is fully automated including code signing per platform.

## Phases

1. **Provenance.** Enable npm/GitHub Packages provenance attestation.
2. **Changelog formatter.** Replace Changesets' default with a custom formatter or template that matches project style (Conventional Commit-aware sections).
3. **Snapshot releases.** `bunx changeset version --snapshot <branch>` + workflow that publishes branch-tagged versions for testing.
4. **Studio code signing.** macOS (Developer ID + notarization), Windows (Authenticode), Linux (GPG-signed AppImage). Workflow secrets for each.
5. **Auto-update** — Tauri's updater plugin pointing at GitHub Releases.
6. **Release dashboard** — a single page that shows current stable, prerelease lines, and latest snapshot per branch.

## Open questions

- Signing certs: budget + procurement (Apple Developer Program, Authenticode cert vendor).
- Auto-update channels: should rc/beta users opt in via the updater config?
- Engine package version skew between studio releases: does studio pin engine versions or float minor?

## Links

- ADR-0004 — publishing
- Tauri updater: https://v2.tauri.app/plugin/updater/
- Changesets snapshot mode docs
