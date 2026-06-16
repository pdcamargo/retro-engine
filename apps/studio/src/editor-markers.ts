/**
 * Marks an entity the editor itself spawned (its cameras, lights, helpers)
 * rather than authored scene content. The hierarchy hides these unless debug
 * mode is on, so the tree shows what the user authored. Studio-local — never
 * persisted, so no reflection schema.
 */
export class EditorOnly {}
