# Architecture Decision Records

Every architectural or non-trivial decision made in this project is captured as an ADR. One decision per file. ADRs are permanent record.

## Naming

`ADR-NNNN-kebab-slug.md`

- `NNNN` is a 4-digit, zero-padded, monotonically increasing number. Never reused.
- Slug describes the decision briefly: `ADR-0007-input-system-abstraction.md`.

## Lifecycle

1. **Create** — copy `_template.md`, fill it in, set `Status: Proposed` or `Status: Accepted`.
2. **Live** — the ADR is now historical record. Its body is frozen.
3. **Supersede** — to change a decision, create a **new** ADR with `Supersedes: ADR-NNNN` and update the old ADR's `Status:` line to `Superseded by ADR-NNNN`.

## Immutability rule

The **only** edit allowed on an existing ADR is flipping its `Status:` field to `Superseded by ADR-NNNN`. The body, the decision, and the rationale stay frozen.

If new information makes an old decision look wrong, that's fine — write a new ADR that supersedes it and explains why. Do not rewrite history.

## Linking code to ADRs

Each ADR's `## Implementation` section lists the file paths and key public symbols it governs. **Code never references ADRs back.** To find the ADR that rules a piece of code, grep this folder for the symbol or path.

See `_template.md` for the canonical shape of a new ADR.
