/**
 * Branded string identifying a {@link RenderGraph} node or sub-graph.
 *
 * Labels are plain strings under the hood — the brand exists only to prevent
 * accidental coercion from arbitrary `string` arguments. Built-in labels are
 * exported as `as const` constants from this module (and from each sub-graph's
 * module — e.g. `Core2dLabel`, `MainPassLabel`); plugins create their own via
 * {@link createLabel}.
 *
 * Two labels compare equal iff their underlying string is equal; the engine
 * does not register a per-process registry of labels.
 *
 * @example
 * ```ts
 * import { createLabel } from '@retro-engine/engine';
 * const MyNodeLabel = createLabel('my_plugin::my_node');
 * ```
 */
export type RenderLabel = string & { readonly __renderLabel: unique symbol };

/**
 * Construct a {@link RenderLabel} from a plain string. The string is the
 * label's identity — pick a stable, namespaced name (`'my_plugin::my_node'`)
 * to avoid collisions with other plugins.
 */
export const createLabel = (name: string): RenderLabel => name as RenderLabel;
