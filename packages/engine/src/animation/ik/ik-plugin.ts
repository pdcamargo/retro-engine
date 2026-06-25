import { t } from '@retro-engine/reflect';

import type { App } from '../../index';
import type { PluginObject } from '../../plugin';
import { addIkSolve } from './ik-system';
import { IkChain, LookAtConstraint, TwoBoneIK } from './ik-constraints';

/**
 * Engine plugin for inverse-kinematics constraints. Registers the
 * {@link TwoBoneIK}, {@link IkChain}, and {@link LookAtConstraint} components
 * (with reflection schemas, so they round-trip through scenes and survive hot
 * reload) and the IK post-pass that solves them each frame.
 *
 * Added by the engine's core plugin after the animation plugin: IK runs in
 * `postUpdate` after transform propagation and before the skinning palette, so
 * it corrects the committed FK pose before the GPU sees it.
 */
export class IkPlugin implements PluginObject {
  name(): string {
    return 'IkPlugin';
  }

  category(): 'engine' {
    return 'engine';
  }

  build(app: App): void {
    app.registerComponent(
      TwoBoneIK,
      {
        root: t.entity(),
        mid: t.entity(),
        tip: t.entity(),
        target: t.entity().nullable(),
        pole: t.entity().nullable(),
        weight: t.number.meta({ range: [0, 1] }),
        targetRotationWeight: t.number.meta({ range: [0, 1] }),
        enabled: t.boolean,
        order: t.number,
      },
      { name: 'TwoBoneIK', make: () => new TwoBoneIK() },
    );
    app.registerComponent(
      IkChain,
      {
        joints: t.array(t.entity()),
        target: t.entity().nullable(),
        iterations: t.number,
        tolerance: t.number,
        weight: t.number.meta({ range: [0, 1] }),
        enabled: t.boolean,
        order: t.number,
      },
      { name: 'IkChain', make: () => new IkChain() },
    );
    app.registerComponent(
      LookAtConstraint,
      {
        bone: t.entity(),
        target: t.entity().nullable(),
        aimAxis: t.vec3,
        upAxis: t.vec3,
        worldUp: t.vec3,
        weight: t.number.meta({ range: [0, 1] }),
        enabled: t.boolean,
        order: t.number,
      },
      { name: 'LookAtConstraint', make: () => new LookAtConstraint() },
    );

    addIkSolve(app);
  }
}
