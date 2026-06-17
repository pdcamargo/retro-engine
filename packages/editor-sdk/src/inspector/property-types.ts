import type { FieldType, TypeRegistry } from '@retro-engine/reflect';

import type { EditEmitter } from '../edit/emitter';
import type { FieldPath, FieldPathSegment } from '../edit/field-path';
import type { Widgets } from '../components';
import type { Ui } from '../ui';
import type { ResolvedFieldMeta } from './amendments';

/**
 * A request to render a nested value, handed to {@link PropertyContext.renderChild}.
 * The single `segment` is appended to the parent path; `readonly` can only
 * tighten (a child cannot become editable under a read-only parent).
 */
export interface ChildRequest {
  readonly type: FieldType<unknown>;
  readonly value: unknown;
  readonly segment: FieldPathSegment;
  /** Label override; otherwise derived from the segment. */
  readonly label?: string;
  /** Force this child (and its subtree) read-only even if the parent is editable. */
  readonly readonly?: boolean;
  /** Label column width for this child's group; inherits the parent's when omitted. */
  readonly labelWidth?: number;
}

/**
 * Everything a {@link PropertyRenderer} needs to draw one field for one frame.
 * The renderer reads {@link value}, draws with {@link ui} / {@link widgets}, and
 * reports changes through {@link edit} — it never touches the ECS world. Container
 * renderers recurse into nested values via {@link renderChild}.
 */
export interface PropertyContext {
  readonly ui: Ui;
  readonly widgets: Widgets;
  /** Reflection registry, for resolving the schema of a nested registered type. */
  readonly reflect: TypeRegistry;
  /** The field's typed descriptor. */
  readonly type: FieldType<unknown>;
  /** The field's current value. */
  readonly value: unknown;
  /** Address of this field within its component. */
  readonly path: FieldPath;
  /** Stable widget id derived from the component name + path. */
  readonly id: string;
  /** Label column width (px) for this field's group, so sibling rows align. */
  readonly labelWidth: number;
  /** When true, draw a non-editable view and emit nothing. */
  readonly readonly: boolean;
  /** Shipped hints merged with editor amendments. */
  readonly meta: ResolvedFieldMeta;
  /** The write boundary; the renderer reports edits here. */
  readonly edit: EditEmitter;
  /** Re-enter the dispatcher for a nested value (container recursion). */
  readonly renderChild: (request: ChildRequest) => void;
}

/**
 * Draws one field of a given {@link FieldType} for one frame. A pure strategy:
 * all state lives in the inspected value and the edit boundary, never in the
 * renderer. Register baseline renderers by kind and custom ones per widget,
 * nested type, or exact field via the inspector registry.
 */
export type PropertyRenderer = (ctx: PropertyContext) => void;
