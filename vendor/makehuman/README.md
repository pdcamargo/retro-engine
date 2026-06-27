# vendor/makehuman

CC0 MakeHuman assets used by the **RetroHuman** initiative (`docs/roadmap/retrohuman.md`).

## What's here

- `fetch.sh` — pinned, reproducible fetch script (committed).
- `base.obj` — MakeHuman base mesh, 19,158 verts, fixed topology (fetched, gitignored).
- `targets/<region>/*.target` — morph targets, ASCII `vertexIndex x y z` (0-based), sparse,
  relative to `base.obj`. Default fetch = facial regions only (290 files). `./fetch.sh --full`
  pulls all 1,258 (~38 MB). (fetched, gitignored).
- `rigs/` — skeleton definitions (`standard`, `rigify`). (fetched, gitignored).
- `expressions/` — expression metadata. (fetched, gitignored).

## Licensing

MakeHuman **assets** (base mesh, targets, skins, rigs) are **CC0** — usable in a closed-source
game, no attribution. MPFB2 **code** is GPL/AGPL and is deliberately **not** vendored; only data
files are copied. Source repo: <https://github.com/makehumancommunity/mpfb2> (pinned in `fetch.sh`).

## Why gitignored

The full target set is 37.7 MB / 1,258 files. Whether to commit the assets or keep fetch-on-demand
is an open question in `docs/roadmap/retrohuman.md` (likely an ADR). Until that's decided, the data
stays out of git history and is re-derivable via `./fetch.sh`.

## Regenerate

```bash
./fetch.sh          # base mesh + facial targets + rigs + expressions
./fetch.sh --full   # everything (~38 MB)
```
