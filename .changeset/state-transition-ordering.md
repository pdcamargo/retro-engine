---
'@retro-engine/engine': minor
---

feat(engine): explicit ordering for state-transition systems

ECS ordering depth Phase 5a (ADR-0161). `onEnter` / `onExit` / `onTransition` now
accept `label` / `before` / `after` (a new `StateSystemOptions`), so transition
systems in the same phase can be ordered independently of registration order:

```ts
app.onEnter(GameState.Playing, [...], spawnPlayer, { label: 'spawn' });
app.onEnter(GameState.Playing, [...], focusCamera, { after: ['spawn'] });
```

They're ordered by the same topological sort as the main schedule (now generic
over both stage systems and transition records), with the same eager cycle
detection — a cycle throws at the `onEnter`/`onExit`/`onTransition` call site.
Purely additive: a transition system with no ordering options keeps its
registration-order behavior.
