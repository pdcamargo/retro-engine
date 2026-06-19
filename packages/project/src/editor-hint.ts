const RUN_IN_EDITOR = Symbol.for('@retro-engine/project:runInEditor');

interface EditorHintGlobal {
  __retroEditorHint?: boolean;
}

/**
 * Whether the project is running inside the studio editor (in Edit *or* Play),
 * as opposed to a shipped standalone game. The studio sets this at boot; a
 * standalone runtime leaves it unset, so this returns `false` there. Mirrors
 * Godot's `Engine.is_editor_hint()`.
 *
 * Use it to branch editor-only behavior inside a system — e.g. draw an authoring
 * preview in the editor, but run the real logic only in a game:
 *
 * ```ts
 * if (isEditorHint()) drawPreviewGizmo();
 * else spawnEnemies();
 * ```
 */
export const isEditorHint = (): boolean =>
  (globalThis as EditorHintGlobal).__retroEditorHint === true;

/**
 * Mark a system to run in the editor too — the studio does **not** gate it behind
 * the play state, so it ticks in Edit as well as Play (like Godot's `@tool` or
 * Unity's `[ExecuteAlways]`). Returns the same function, so wrap it inline at
 * registration:
 *
 * ```ts
 * app.addSystem('update', [Query([Gizmo])], runInEditor(drawGizmos), { name: 'gizmos' });
 * ```
 *
 * In a standalone runtime there is no play gate, so every system runs regardless;
 * the tag is simply inert there.
 */
export const runInEditor = <F extends (...args: never[]) => unknown>(system: F): F => {
  (system as unknown as Record<symbol, boolean>)[RUN_IN_EDITOR] = true;
  return system;
};

/**
 * Whether a system function was marked with {@link runInEditor}. Read by the host
 * (the studio's play-state gate); game code does not need this.
 */
export const isRunInEditor = (system: unknown): boolean =>
  typeof system === 'function' && (system as unknown as Record<symbol, unknown>)[RUN_IN_EDITOR] === true;
