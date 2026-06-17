# Inspector — decorator sugar for amendments

TC39-decorator sugar over the inspector amendment API (ADR-0082), e.g.
`@Inspector.readonly`, `@Inspector.hidden`, `@Inspector.widget('health-bar')`,
`@Inspector.range(0, 100)` on a component field, as an ergonomic alternative to
`editor.inspector.amend(Ctor, path, { ... })`.

The amendment layer is already the stable seam: a decorator only needs to record a
`FieldAmendment` keyed by (component, field) and replay it through `amend(...)` — no
renderer, dispatcher, or ImGui changes.

Open problem to resolve before building: field decorators run at class-evaluation
time with no studio/editor instance in scope, so they can only target a
*module-level default amendment registry* (mirroring reflect's `defaultRegistry`)
that `InspectorRegistry` reads from at construction. Decide that registry's shape and
lifetime first. Ships no decorators today.
