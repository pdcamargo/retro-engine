import { type RegisteredType, type TypeRegistry, readField } from '@retro-engine/reflect';

import type { EditEmitter } from '../edit/emitter';
import type { Widgets } from '../components';
import type { Ui } from '../ui';
import { resolveMeta } from './amendments';
import { type ComponentEditorContext, defaultComponentEditor } from './component-editor';
import type { InspectorRegistry } from './inspector-registry';
import { renderPropertyField } from './property-field';
import { labelColumnWidth } from './renderers-support';

/** Inputs to {@link renderComponentBody}. */
export interface RenderComponentBodyRequest {
  readonly ui: Ui;
  readonly widgets: Widgets;
  /** Reflection registry, for resolving nested registered types. */
  readonly reflect: TypeRegistry;
  /** Inspector registry holding renderer / editor / amendment registrations. */
  readonly inspector: InspectorRegistry;
  /** The live component instance to edit. */
  readonly instance: object;
  /** The component's registered type (its schema + stable name). */
  readonly registered: RegisteredType;
  /** Draw a non-editable view (e.g. during play). */
  readonly readonly: boolean;
  /** The write boundary, bound to this entity + component. */
  readonly edit: EditEmitter;
}

/**
 * Render one component's editable body — its registered custom editor if any,
 * otherwise the default field walk. The convenience the inspector panel calls per
 * component; custom editors and the default both render fields through the shared
 * property dispatcher.
 */
export const renderComponentBody = (req: RenderComponentBodyRequest): void => {
  const { registered } = req;
  const editor = req.inspector.getComponentEditor(registered.ctor, registered.name) ?? defaultComponentEditor;

  // Size the label column to the widest field label, so every row aligns and the
  // label can never overlap its control (the bug a fixed column width caused).
  const labels: string[] = [];
  for (const [name, ft] of registered.fields) {
    const amendment = req.inspector.resolveAmendment(registered.ctor, registered.name, [{ kind: 'field', name }]);
    const meta = resolveMeta(amendment, ft.hints, name, undefined);
    if (!meta.hidden) labels.push(meta.label);
  }
  const labelWidth = labelColumnWidth(req.ui, labels);

  const ctx: ComponentEditorContext = {
    ui: req.ui,
    widgets: req.widgets,
    instance: req.instance,
    registered,
    readonly: req.readonly,
    edit: req.edit,
    field: (name): void => {
      const ft = registered.schema[name];
      if (ft === undefined) return;
      renderPropertyField({
        ui: req.ui,
        widgets: req.widgets,
        reflect: req.reflect,
        inspector: req.inspector,
        componentCtor: registered.ctor,
        componentName: registered.name,
        type: ft,
        value: readField(req.instance, name),
        path: [{ kind: 'field', name }],
        edit: req.edit,
        readonly: req.readonly,
        labelWidth,
      });
    },
  };
  editor(ctx);
};
