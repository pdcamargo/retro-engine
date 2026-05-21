# Roadmap

Multi-step initiatives and milestones. One initiative per file.

Unlike ADRs (permanent record) and backlog (single discrete tasks), roadmap items are **living documents**. Edits are allowed and expected as plans evolve.

## Naming

`<kebab-slug>.md` — describe the initiative. Example: `webgl2-backend.md`, `asset-system.md`.

## Lifecycle

1. **Create** from `_template.md` when starting a multi-step initiative.
2. **Edit freely** as the plan develops, scope shifts, or phases complete.
3. **Promote** individual phases to `docs/backlog/` when they become concrete work items.
4. **Delete** when the initiative is fully complete — same explicit-user-confirmation rule as backlog and bugs.

## What goes here vs ADR vs backlog

- **ADR** = a decision made and locked.
- **Roadmap** = a plan that spans multiple decisions and work items, expected to evolve.
- **Backlog** = a single discrete piece of work.

A roadmap item generally *generates* ADRs (as decisions get made) and backlog items (as work gets scheduled).

## Format

See `_template.md` for the canonical shape.
