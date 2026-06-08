import type { DecodeEnv, TypeRegistry } from '@retro-engine/reflect';

import type { SerializedTemplateRef } from '../scene/scene-data';

import { expandTemplate } from './template';
import { applyFieldOverrides, decodeParams } from './template-params';
import type { TemplateRegistry } from './template-registry';

/**
 * Expand a scene's embedded template references into component instances: each
 * ref's params are decoded and substituted, then its field-level `overrides` are
 * overlaid onto the produced components (an override for a type the template did
 * not produce patches a fresh default instance of that type instead).
 *
 * Throws if a ref names an unregistered template — a missing template is an
 * authoring error, not a droppable component.
 *
 * @internal Used by `spawnScene` to resolve `SerializedEntity.templates`.
 */
export const expandTemplateRefs = (
  templates: TemplateRegistry,
  types: TypeRegistry,
  refs: readonly SerializedTemplateRef[],
  env: DecodeEnv,
): object[] => {
  const out: object[] = [];
  for (const ref of refs) {
    const template = templates.get(ref.template);
    if (template === undefined) {
      throw new Error(`prefab: scene references unregistered template '${ref.template}'`);
    }

    const params = decodeParams(template.params, ref.params ?? {}, env);
    const produced = expandTemplate(template, params);

    if (ref.overrides !== undefined) {
      for (const override of ref.overrides) {
        const reg = types.get(override.type);
        if (reg === undefined) continue;
        let target = produced.find((c) => c.constructor === reg.ctor);
        if (target === undefined) {
          target = reg.make();
          produced.push(target);
        }
        applyFieldOverrides(reg, target as Record<string, unknown>, override.data, env);
      }
    }

    out.push(...produced);
  }
  return out;
};
