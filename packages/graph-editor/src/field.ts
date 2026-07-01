/**
 * Descriptors for the embedded fields a node draws in its body — the inset-well
 * widgets (combo, number, color swatch, toggle, checkbox, text). A field's live
 * value lives on the node instance (`GraphNode.fieldValues[name]`); this only
 * describes how to render and edit it. A field row may also carry its own typed
 * pin (e.g. a subgraph's typed inputs).
 */

/** The kind of inset widget a field renders as. */
export type FieldKind = 'combo' | 'number' | 'swatch' | 'toggle' | 'checkbox' | 'text';

/** Describes one embedded field on a node type. */
export interface FieldDescriptor {
  /** Key into `GraphNode.fieldValues`; also the widget id seed. */
  readonly name: string;
  /** Which inset widget to draw. */
  readonly kind: FieldKind;
  /** Display label; omitted for a label-less full-width well. */
  readonly label?: string;
  /** Initial value when a node is created. */
  readonly default?: unknown;
  /** Options for a `combo` field. */
  readonly options?: readonly string[];
  /** Numeric bounds/step for a `number` field. */
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  /** When set, this field row also carries a typed pin of this data-type name. */
  readonly pin?: string;
}
