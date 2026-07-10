import type { ComponentType } from '@retro-engine/ecs';
import type { FieldType, TypeRegistry } from '@retro-engine/reflect';

import type { EditEmitter } from '../edit/emitter';
import { type FieldPath, pathKeyOf } from '../edit/field-path';
import type { Widgets } from '../components';
import type { Ui } from '../ui';
import { resolveMeta } from './amendments';
import { defaultValueFor } from './renderers-bridge';
import type { InspectorRegistry } from './inspector-registry';
import type { PropertyContext } from './property-types';
import { labeledRow } from './renderers-support';

/** Inputs to {@link renderPropertyField}: a single field within a component, plus its rendering context. */
export interface PropertyFieldRequest {
  readonly ui: Ui;
  readonly widgets: Widgets;
  /** Reflection registry, for resolving nested registered types. */
  readonly reflect: TypeRegistry;
  /** Inspector registry holding renderer / editor / amendment registrations. */
  readonly inspector: InspectorRegistry;
  /** Owning component constructor (for amendment / custom-renderer lookup). */
  readonly componentCtor: ComponentType<object>;
  /** Owning component's stable reflection name. */
  readonly componentName: string;
  readonly type: FieldType<unknown>;
  readonly value: unknown;
  readonly path: FieldPath;
  readonly edit: EditEmitter;
  readonly readonly: boolean;
  /** Label column width (px) for this field's group, so sibling rows align. */
  readonly labelWidth: number;
  /** Label override (e.g. an array index); otherwise derived from the path. */
  readonly label?: string;
}

const segmentName = (path: FieldPath, componentName: string): string => {
  const last = path[path.length - 1];
  if (last === undefined) return componentName;
  return last.kind === 'field' ? last.name : `[${String(last.index)}]`;
};

/**
 * Resolve and draw the editor for a single field, recursing into container kinds
 * via {@link PropertyContext.renderChild}. The composable primitive a custom
 * editor or renderer calls to render any sub-field with full renderer resolution,
 * amendment merging, and read-only propagation (which only ever tightens
 * downward). Resolution order, most specific first: per-field renderer → widget
 * renderer → nested-type renderer → kind renderer → fallback.
 */
export const renderPropertyField = (req: PropertyFieldRequest): void => {
  const amendment = req.inspector.resolveAmendment(req.componentCtor, req.componentName, req.path);
  const meta = resolveMeta(amendment, req.type.hints, segmentName(req.path, req.componentName), req.label);
  if (meta.hidden) return;

  // A nullish value (an unset optional/nullable field) has nothing to feed a
  // typed widget — don't hand `undefined` to a numeric widget. Reference kinds
  // are exempt: an asset handle renderer owns its own empty state (an unset slot
  // needs an "assign" affordance), so it is dispatched even when nullish.
  //
  // For a genuinely optional/nullable field we still offer a "Set" button that
  // gives it a default value, so authored-but-omitted fields (e.g. a UiNode's
  // backgroundColor / width) can be filled in from the inspector instead of
  // dead-ending at "(unset)". `defaultValueFor` returns `undefined` only for
  // kinds we can't synthesize (nested type / variant), which fall back to the
  // plain label.
  if ((req.value === undefined || req.value === null) && req.type.kind !== 'handle') {
    const editable = !req.readonly && !req.type.isSkipped && !meta.forcedReadonly;
    const settable = editable && (req.type.isOptional || req.type.isNullable);
    const fresh = settable ? defaultValueFor(req.type) : undefined;
    labeledRow(req.ui, meta.label, req.labelWidth, () => {
      if (fresh !== undefined) {
        if (req.ui.button(`Set##set:${req.componentName}:${pathKeyOf(req.path)}`)) {
          req.edit.scalar(req.path, req.value).commit(fresh);
        }
      } else {
        req.ui.textDisabled(req.value === null ? '(null)' : '(unset)');
      }
    });
    return;
  }

  const readonly = req.readonly || req.type.isSkipped || meta.forcedReadonly;
  const renderer =
    req.inspector.getFieldRenderer(req.componentCtor, req.componentName, req.path) ??
    (meta.widget !== undefined ? req.inspector.getWidgetRenderer(meta.widget) : undefined) ??
    (req.type.kind === 'type' ? req.inspector.getTypeRenderer(req.type.nestedCtor) : undefined) ??
    req.inspector.getKindRenderer(req.type.kind) ??
    req.inspector.fallback;

  const ctx: PropertyContext = {
    ui: req.ui,
    widgets: req.widgets,
    reflect: req.reflect,
    componentName: req.componentName,
    type: req.type,
    value: req.value,
    path: req.path,
    id: `${req.componentName}#${pathKeyOf(req.path)}`,
    labelWidth: req.labelWidth,
    readonly,
    meta,
    edit: req.edit,
    renderChild: (child): void =>
      renderPropertyField({
        ui: req.ui,
        widgets: req.widgets,
        reflect: req.reflect,
        inspector: req.inspector,
        componentCtor: req.componentCtor,
        componentName: req.componentName,
        type: child.type,
        value: child.value,
        path: [...req.path, child.segment],
        edit: req.edit,
        readonly: readonly || (child.readonly ?? false),
        labelWidth: child.labelWidth ?? req.labelWidth,
        ...(child.label !== undefined ? { label: child.label } : {}),
      }),
  };
  renderer(ctx);
};
