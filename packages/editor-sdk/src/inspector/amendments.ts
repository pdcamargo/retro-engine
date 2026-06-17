import type { FieldMeta } from '@retro-engine/reflect';

/**
 * An editor-side override for one field, layered over the component's shipped
 * {@link FieldMeta} without touching the schema. Authors ship presentation hints
 * with the component; the studio (or a plugin) amends them — forcing a field
 * read-only, hiding it, relabelling it, or selecting a different widget. The
 * stable seam a future decorator sugar layer records into.
 */
export interface FieldAmendment {
  /** Render the field non-editable (greyed). */
  readonly readonly?: boolean;
  /** Synonym for {@link readonly}; both fold into the resolved read-only flag. */
  readonly disabled?: boolean;
  /** Hide the field from the inspector entirely. */
  readonly hidden?: boolean;
  /** Replace the field's label. */
  readonly label?: string;
  /** Replace the field's tooltip. */
  readonly tooltip?: string;
  /** Force a widget by id, overriding the schema's widget hint. */
  readonly widget?: string;
  /** Numeric `[min, max]` bounds, overriding the schema hint. */
  readonly range?: readonly [number, number];
  /** Open-ended extra keys, merged over the schema's extra hints. */
  readonly extra?: Readonly<Record<string, unknown>>;
}

/**
 * The effective presentation for one field after merging its shipped
 * {@link FieldMeta} hints with an editor {@link FieldAmendment}. A renderer reads
 * only this, so the merge policy lives in exactly one place.
 */
export interface ResolvedFieldMeta {
  /** Display label (amendment > explicit > schema hint > humanized field name). */
  readonly label: string;
  readonly tooltip?: string;
  /** When true, the dispatcher skips the field. */
  readonly hidden: boolean;
  readonly range?: readonly [number, number];
  /** Winning widget id, if any. */
  readonly widget?: string;
  /** Amendment read-only/disabled, folded into one flag. */
  readonly forcedReadonly: boolean;
  /** Schema extra hints overlaid with amendment extras. */
  readonly extra: Readonly<Record<string, unknown>>;
}

const KNOWN_HINT_KEYS = new Set(['label', 'tooltip', 'hidden', 'range', 'widget']);

/** Turn a field name into a human label: `maxHealth` → `Max Health`, `clear_color` → `Clear color`. */
export const humanize = (name: string): string => {
  const spaced = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  return spaced.length === 0 ? name : spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

/**
 * Merge a field's shipped hints with an editor amendment into the single
 * {@link ResolvedFieldMeta} a renderer reads. Amendment values win; `explicitLabel`
 * (e.g. an array index label supplied by a container renderer) sits between the
 * amendment and the schema hint.
 */
export const resolveMeta = (
  amendment: FieldAmendment | undefined,
  hints: FieldMeta | undefined,
  name: string,
  explicitLabel: string | undefined,
): ResolvedFieldMeta => {
  const tooltip = amendment?.tooltip ?? hints?.tooltip;
  const range = amendment?.range ?? hints?.range;
  const widget = amendment?.widget ?? hints?.widget;
  const extra: Record<string, unknown> = {};
  if (hints !== undefined) {
    for (const key of Object.keys(hints)) if (!KNOWN_HINT_KEYS.has(key)) extra[key] = hints[key];
  }
  if (amendment?.extra !== undefined) Object.assign(extra, amendment.extra);
  return {
    label: amendment?.label ?? explicitLabel ?? hints?.label ?? humanize(name),
    hidden: amendment?.hidden ?? hints?.hidden ?? false,
    forcedReadonly: (amendment?.readonly ?? false) || (amendment?.disabled ?? false),
    extra,
    ...(tooltip !== undefined ? { tooltip } : {}),
    ...(range !== undefined ? { range } : {}),
    ...(widget !== undefined ? { widget } : {}),
  };
};
