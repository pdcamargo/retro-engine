/**
 * Field-path addressing for the editor: a stable address from a component
 * instance down to one editable value, used both as the read address an
 * inspector renders and as the write address an edit command targets.
 *
 * The implementation lives in `@retro-engine/reflect` so the same path machinery
 * the inspector edits with is the one the engine's animation tracks drive — one
 * source of truth, no drift between "what an editor can edit" and "what a clip
 * can animate". Re-exported here under the editor's historical names.
 */
export type { FieldPath, FieldPathSegment } from '@retro-engine/reflect';
export { pathKeyOf, readPath, writePathLeaf } from '@retro-engine/reflect';
