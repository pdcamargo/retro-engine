# Backlog

Work that has been considered and deliberately deferred. One item per file.

## Naming

`<kebab-slug>.md` — describe the work in the filename. Example: `studio-asset-browser.md`.

## Lifecycle

1. Create from `_template.md` when work is deferred.
2. Live in this folder until the work is genuinely done.
3. **Deleted when — and only when — the user explicitly confirms the work is complete.** Builds passing, tests green, or "I think it's done" is not confirmation. Wait for the user to say it.

If a backlog item turns out to be wrong-headed and is being abandoned (not done, just cancelled), it can be deleted too — with explicit user confirmation that it's being dropped, not finished.

## What goes here vs an ADR vs the roadmap

- **ADR** = a decision made.
- **Roadmap** = a multi-step initiative or milestone, edited as it evolves.
- **Backlog** = a single piece of work agreed-to-do-later.

A decision *to defer* a feature can warrant an ADR; the deferred work itself goes here. When a roadmap item is broken down, the discrete pieces land here.
