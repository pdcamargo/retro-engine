import type { ComponentType } from '@retro-engine/ecs';
import type { FieldKind } from '@retro-engine/reflect';

import { type FieldPath, pathKeyOf } from '../edit/field-path';
import type { FieldAmendment } from './amendments';
import type { ComponentEditor } from './component-editor';
import type { PropertyRenderer } from './property-types';
import { arrayRenderer, structRenderer, tupleRenderer, variantRenderer } from './renderers-container';
import { fallbackRenderer } from './renderers-default';
import { quatAngle2dRenderer, quatEulerRenderer } from './renderers-quat';
import { entityRenderer, handleRenderer, typeRenderer } from './renderers-reference';
import { booleanRenderer, enumRenderer, numberRenderer, stringRenderer } from './renderers-scalar';
import { colorRenderer, mat4Renderer, quatRenderer, vec2Renderer, vec3Renderer, vec4Renderer } from './renderers-vector';

/** Keys a custom editor / renderer / amendment by component constructor or its stable reflection name. */
export type ComponentKey = ComponentType<object> | string;

/** A summary of one component's editor customizations, returned by {@link InspectorRegistry.describe}. */
export interface InspectorCustomization {
  /** The component this customizes, by constructor or stable reflection name. */
  readonly component: ComponentKey;
  /** Whether a custom whole-component editor is registered. */
  readonly hasEditor: boolean;
  /** Count of per-field renderers registered for this component. */
  readonly fieldRenderers: number;
  /** Count of field amendments layered over this component. */
  readonly amendments: number;
}

const innerMap = <V>(
  byCtor: Map<ComponentType<object>, Map<string, V>>,
  byName: Map<string, Map<string, V>>,
  key: ComponentKey,
): Map<string, V> => {
  if (typeof key === 'string') {
    let map = byName.get(key);
    if (map === undefined) {
      map = new Map<string, V>();
      byName.set(key, map);
    }
    return map;
  }
  let map = byCtor.get(key);
  if (map === undefined) {
    map = new Map<string, V>();
    byCtor.set(key, map);
  }
  return map;
};

/**
 * The studio's inspector extension surface, owned by the editor shell
 * (`editor.inspector`). Register typed property renderers (by field kind, widget
 * id, nested type, or exact field), whole-component editors, and per-field
 * amendments. With nothing registered, every component still renders through the
 * baseline kind renderers seeded by {@link createInspectorRegistry}.
 *
 * A component key may be a constructor or a stable reflection name; both are
 * honored at lookup (the dispatcher checks the constructor first, then the name).
 */
export class InspectorRegistry {
  private readonly kindRenderers = new Map<FieldKind, PropertyRenderer>();
  private readonly widgetRenderers = new Map<string, PropertyRenderer>();
  private readonly typeRenderers = new Map<ComponentType<object>, PropertyRenderer>();
  private readonly fieldRenderersByCtor = new Map<ComponentType<object>, Map<string, PropertyRenderer>>();
  private readonly fieldRenderersByName = new Map<string, Map<string, PropertyRenderer>>();
  private readonly editorsByCtor = new Map<ComponentType<object>, ComponentEditor>();
  private readonly editorsByName = new Map<string, ComponentEditor>();
  private readonly amendmentsByCtor = new Map<ComponentType<object>, Map<string, FieldAmendment>>();
  private readonly amendmentsByName = new Map<string, Map<string, FieldAmendment>>();

  /** Renderer used when no field / widget / type / kind renderer matches. */
  readonly fallback: PropertyRenderer;

  constructor(fallback: PropertyRenderer) {
    this.fallback = fallback;
  }

  /** Register the default renderer for a field kind (overrides the baseline). */
  registerKindRenderer(kind: FieldKind, renderer: PropertyRenderer): this {
    this.kindRenderers.set(kind, renderer);
    return this;
  }

  /** Register a renderer keyed by a widget id (the schema hint or an amendment selects it). */
  registerWidgetRenderer(widget: string, renderer: PropertyRenderer): this {
    this.widgetRenderers.set(widget, renderer);
    return this;
  }

  /** Register a renderer for a nested registered value type (a `t.type(Ctor)` field). */
  registerTypeRenderer(ctor: ComponentType<object>, renderer: PropertyRenderer): this {
    this.typeRenderers.set(ctor, renderer);
    return this;
  }

  /** Register a renderer for one exact field of one component. */
  registerFieldRenderer(component: ComponentKey, path: FieldPath, renderer: PropertyRenderer): this {
    innerMap(this.fieldRenderersByCtor, this.fieldRenderersByName, component).set(pathKeyOf(path), renderer);
    return this;
  }

  /** Register a whole-component editor, replacing the default field walk for that component. */
  registerComponentEditor(component: ComponentKey, editor: ComponentEditor): this {
    if (typeof component === 'string') this.editorsByName.set(component, editor);
    else this.editorsByCtor.set(component, editor);
    return this;
  }

  /** Layer an editor-side amendment over one field's shipped hints. Merges with any existing amendment. */
  amend(component: ComponentKey, path: FieldPath, amendment: FieldAmendment): this {
    const map = innerMap(this.amendmentsByCtor, this.amendmentsByName, component);
    const key = pathKeyOf(path);
    map.set(key, { ...map.get(key), ...amendment });
    return this;
  }

  /**
   * Enumerate the components this registry customizes — which have a custom
   * whole-component editor, per-field renderers, or amendments. For tooling
   * (a project index showing "this component has a custom editor"); kind/widget/
   * type renderers are global, not per-component, and are not reported here.
   */
  describe(): readonly InspectorCustomization[] {
    const out = new Map<ComponentKey, { hasEditor: boolean; fieldRenderers: number; amendments: number }>();
    const at = (key: ComponentKey) => {
      let e = out.get(key);
      if (e === undefined) {
        e = { hasEditor: false, fieldRenderers: 0, amendments: 0 };
        out.set(key, e);
      }
      return e;
    };
    for (const key of this.editorsByCtor.keys()) at(key).hasEditor = true;
    for (const key of this.editorsByName.keys()) at(key).hasEditor = true;
    for (const [key, m] of this.fieldRenderersByCtor) at(key).fieldRenderers += m.size;
    for (const [key, m] of this.fieldRenderersByName) at(key).fieldRenderers += m.size;
    for (const [key, m] of this.amendmentsByCtor) at(key).amendments += m.size;
    for (const [key, m] of this.amendmentsByName) at(key).amendments += m.size;
    return [...out].map(([component, info]) => ({ component, ...info }));
  }

  getKindRenderer(kind: FieldKind): PropertyRenderer | undefined {
    return this.kindRenderers.get(kind);
  }

  getWidgetRenderer(widget: string): PropertyRenderer | undefined {
    return this.widgetRenderers.get(widget);
  }

  getTypeRenderer(ctor: ComponentType<object> | undefined): PropertyRenderer | undefined {
    return ctor !== undefined ? this.typeRenderers.get(ctor) : undefined;
  }

  getFieldRenderer(ctor: ComponentType<object>, name: string, path: FieldPath): PropertyRenderer | undefined {
    const key = pathKeyOf(path);
    return this.fieldRenderersByCtor.get(ctor)?.get(key) ?? this.fieldRenderersByName.get(name)?.get(key);
  }

  getComponentEditor(ctor: ComponentType<object>, name: string): ComponentEditor | undefined {
    return this.editorsByCtor.get(ctor) ?? this.editorsByName.get(name);
  }

  resolveAmendment(ctor: ComponentType<object>, name: string, path: FieldPath): FieldAmendment | undefined {
    const key = pathKeyOf(path);
    return this.amendmentsByCtor.get(ctor)?.get(key) ?? this.amendmentsByName.get(name)?.get(key);
  }
}

/** Build an {@link InspectorRegistry} seeded with the baseline renderer for every field kind. */
export const createInspectorRegistry = (): InspectorRegistry =>
  new InspectorRegistry(fallbackRenderer)
    .registerKindRenderer('number', numberRenderer)
    .registerKindRenderer('string', stringRenderer)
    .registerKindRenderer('boolean', booleanRenderer)
    .registerKindRenderer('enum', enumRenderer)
    .registerKindRenderer('vec2', vec2Renderer)
    .registerKindRenderer('vec3', vec3Renderer)
    .registerKindRenderer('vec4', vec4Renderer)
    .registerKindRenderer('quat', quatRenderer)
    .registerKindRenderer('mat4', mat4Renderer)
    .registerKindRenderer('color', colorRenderer)
    .registerKindRenderer('entity', entityRenderer)
    .registerKindRenderer('handle', handleRenderer)
    .registerKindRenderer('type', typeRenderer)
    .registerKindRenderer('struct', structRenderer)
    .registerKindRenderer('array', arrayRenderer)
    .registerKindRenderer('tuple', tupleRenderer)
    .registerKindRenderer('variant', variantRenderer)
    // Alternative quaternion editors, opt-in via a `widget` hint or amendment:
    // `'euler'` (X/Y/Z degrees) and `'angle2d'` (a single 2D rotation about +Z).
    .registerWidgetRenderer('euler', quatEulerRenderer)
    .registerWidgetRenderer('angle2d', quatAngle2dRenderer);
