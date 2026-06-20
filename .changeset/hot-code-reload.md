---
'@retro-engine/engine': minor
'@retro-engine/reflect': minor
---

feat(engine): live plugin swap for hot code reload

Per ADR-0102, the engine can now swap a project's plugins on a **running** App,
so a studio can hot-reload code edits without a page reload (overrides ADR-0091's
deferral; ADR-0091's open-project = reboot decision stands).

**`@retro-engine/engine`:**

- `App.removeUserPlugins(baseline)` — drop every `'user'`-origin system (purging
  its per-system buffers), unregister the components/resources the project added
  beyond `baseline`, and remove its `category() === 'user'` plugins.
- `App.addPluginsHot(plugins)` — add plugins to a running App, bypassing
  `addPlugin`'s `Building`-only guard; each `build()` runs attributed to its
  plugin, then `ready`/`finish`/`cleanup` fire once.
- `StageSystems.remove(pred)` — remove matching systems from a stage and
  invalidate the topo cache.
- `SerializeOptions.filter` — serialize only the entities a predicate keeps (e.g.
  the user scene, excluding an editor's infra entities).

**`@retro-engine/reflect`:**

- `TypeRegistry.unregister(ctor)` — remove a registered type (by name + ctor) so a
  reloaded plugin's rebuilt classes can re-register under the same names.

The swap preserves world data via serialize → rebuild → respawn against the
name-keyed registry. Removing user-registered global observers / component hooks
on swap is a tracked follow-up.
