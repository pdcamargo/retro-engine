import { describe, expect, it } from 'bun:test';

import { App } from '../index';
import { Light3dPlugin } from '../light3d/light-3d-plugin';
import { MaterialPlugin } from '../material/material-plugin';
import { StandardMaterial, StandardMaterialPlugin } from '../material/standard-material';
import { Core3dLabel } from '../render-graph/core-3d';
import { OpaquePass3dLabel } from '../render-graph/opaque-pass-3d-node';
import { RenderGraph } from '../render-graph/render-graph';
import { Shadow3dPass3dLabel } from '../render-graph/shadow-pass-3d-node';
import { TransparentPass3dLabel } from '../render-graph/transparent-pass-3d-node';
import { makeRenderingRenderer, makeStubCanvas } from '../test-utils';

import { PrepassNode3dLabel } from './prepass-3d-node';
import { PrepassPlugin } from './prepass-plugin';

const orderedLabels = (app: App): string[] => {
  const graph = app.getResource(RenderGraph)!;
  const sub = graph.getSubGraph(Core3dLabel)!;
  sub.freeze();
  const ordered = sub.orderedNodes()!;
  return ordered.map((n) => String(n.label));
};

describe('PrepassNode3d sub-graph ordering', () => {
  it('inserts PrepassNode3d before OpaquePass3dNode when added alone', () => {
    const app = new App({
      renderer: makeRenderingRenderer(),
      canvas: makeStubCanvas(),
    });
    app.addPlugin(new PrepassPlugin());
    const labels = orderedLabels(app);
    expect(labels.indexOf(String(PrepassNode3dLabel))).toBeGreaterThanOrEqual(0);
    expect(labels.indexOf(String(PrepassNode3dLabel))).toBeLessThan(
      labels.indexOf(String(OpaquePass3dLabel)),
    );
    expect(labels.indexOf(String(OpaquePass3dLabel))).toBeLessThan(
      labels.indexOf(String(TransparentPass3dLabel)),
    );
  });

  it('inserts PrepassNode3d after Shadow3dPass3dNode when Light3dPlugin is present', () => {
    const app = new App({
      renderer: makeRenderingRenderer(),
      canvas: makeStubCanvas(),
    });
    app.addPlugin(new StandardMaterialPlugin());
    app.addPlugin(new MaterialPlugin(StandardMaterial));
    app.addPlugin(new Light3dPlugin());
    app.addPlugin(new PrepassPlugin());
    const labels = orderedLabels(app);
    const shadowIdx = labels.indexOf(String(Shadow3dPass3dLabel));
    const prepassIdx = labels.indexOf(String(PrepassNode3dLabel));
    const opaqueIdx = labels.indexOf(String(OpaquePass3dLabel));
    expect(shadowIdx).toBeGreaterThanOrEqual(0);
    expect(prepassIdx).toBeGreaterThan(shadowIdx);
    expect(opaqueIdx).toBeGreaterThan(prepassIdx);
  });

  it('does not require Light3dPlugin to register', () => {
    const app = new App({
      renderer: makeRenderingRenderer(),
      canvas: makeStubCanvas(),
    });
    app.addPlugin(new PrepassPlugin());
    const labels = orderedLabels(app);
    expect(labels).toContain(String(PrepassNode3dLabel));
  });
});

describe('PrepassPlugin error paths', () => {
  it('throws if RenderGraphPlugin has not built the Core3d sub-graph', () => {
    const app = new App({
      renderer: makeRenderingRenderer(),
      canvas: makeStubCanvas(),
    });
    // Manually remove the RenderGraph resource before adding PrepassPlugin.
    app.removeResource(RenderGraph);
    expect(() => app.addPlugin(new PrepassPlugin())).toThrow(/RenderGraph/);
  });
});
