# Known Bugs

Bugs that are known but not yet fixed. One bug per file.

## Naming

`<kebab-slug>.md` — describe the bug in the filename. Example: `webgpu-canvas-resize-loses-context.md`.

## Lifecycle

1. Create from `_template.md` when a bug is discovered.
2. Live in this folder while the bug exists.
3. **Deleted when — and only when — the user explicitly confirms the bug is fixed.** Tests passing, code change merged, or local repro no longer reproducing is not confirmation. Wait for the user to say it.

## No "Fix" section

The template intentionally has no "Fix" field. We do not record fixes here. When the user confirms the bug is fixed, the file is deleted. The fix lives in commits, tests, and (if it represented a decision) an ADR.

If a bug is closed without a fix (won't-fix, can't-repro, by-design after investigation), record that as an ADR explaining the call and delete this file once the user confirms.
