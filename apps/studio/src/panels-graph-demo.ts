// Demo panel for the reusable graph-editor toolkit (@retro-engine/graph-editor).
// It stands up a dataflow graph kind + a sample shader-style document and draws
// it with GraphEditor, so the toolkit can be verified end-to-end in the studio
// (pan/zoom/fit, header variants, node states, typed pins, bezier wires,
// reroute weight-points). It is the acceptance surface for the phased build-out;
// consumer graphs (animation, shader) come later.

import { type EditorContext, type PanelDef } from '@retro-engine/editor-sdk';
import {
  addNode,
  addReroute,
  connect,
  createGraphDocument,
  createGraphEnvironment,
  createGraphTheme,
  createGraphView,
  type GraphDocument,
  GraphEditor,
  type GraphEnvironment,
  type GraphTheme,
  type GraphView,
} from '@retro-engine/graph-editor';

interface DemoState {
  env: GraphEnvironment;
  doc: GraphDocument;
  view: GraphView;
  theme: GraphTheme;
  fitRequested: boolean;
}

const buildDemo = (): DemoState => {
  const env = createGraphEnvironment();
  const kind = env.registerKind({ id: 'dataflow', label: 'Dataflow' });
  kind.nodeTypes
    .register({
      type: 'ColorParameter',
      category: 'input',
      header: 'stripe',
      icon: 'palette',
      sub: 'input',
      fields: [{ name: 'Value', kind: 'swatch' }],
      outputs: [{ name: 'color', type: 'color' }],
    })
    .register({
      type: 'Texture2D',
      category: 'input',
      header: 'stripe',
      icon: 'image',
      sub: 'sampler',
      inputs: [
        { name: 'uv', type: 'vector' },
        { name: 'lod', type: 'float' },
      ],
      outputs: [
        { name: 'color', type: 'color' },
        { name: 'sampler2D', type: 'object' },
      ],
    })
    .register({
      type: 'Multiply',
      category: 'math',
      header: 'solid',
      icon: 'x',
      fields: [{ name: 'mode', kind: 'combo', options: ['Vector4', 'Vector3', 'Float'], default: 'Vector4' }],
      inputs: [
        { name: 'a', type: 'color' },
        { name: 'b', type: 'color' },
      ],
      outputs: [{ name: 'out', type: 'vector' }],
    })
    .register({
      type: 'Fresnel',
      category: 'math',
      header: 'tick',
      icon: 'aperture',
      sub: 'math',
      inputs: [
        { name: 'normal', type: 'vector' },
        { name: 'view', type: 'vector' },
        { name: 'power', type: 'float' },
      ],
      outputs: [{ name: 'result', type: 'float' }],
    })
    .register({
      type: 'Add',
      category: 'math',
      header: 'solid',
      icon: 'plus',
      sub: 'float',
      inputs: [
        { name: 'a', type: 'float' },
        { name: 'b', type: 'float' },
      ],
      outputs: [{ name: 'out', type: 'float' }],
    })
    .register({
      type: 'Output',
      category: 'output',
      header: 'solid',
      icon: 'target',
      sub: 'master',
      inputs: [
        { name: 'Albedo', type: 'color' },
        { name: 'Metallic', type: 'float' },
        { name: 'Roughness', type: 'float' },
        { name: 'Emission', type: 'color' },
        { name: 'AO', type: 'float' },
        { name: 'Normal', type: 'vector' },
      ],
    });

  // Compact 3-column layout so the graph frames at a label-legible zoom.
  const doc = createGraphDocument({ kindId: 'dataflow' });
  const cp = addNode(doc, { typeId: 'ColorParameter', pos: [20, 60] });
  const tx = addNode(doc, { typeId: 'Texture2D', pos: [20, 300] });
  const ml = addNode(doc, { typeId: 'Multiply', pos: [300, 40] });
  const fr = addNode(doc, { typeId: 'Fresnel', pos: [300, 320] });
  const out = addNode(doc, { typeId: 'Output', pos: [580, 40] });
  const ad = addNode(doc, { typeId: 'Add', pos: [580, 340] });

  const e1 = connect(doc, { node: cp.id, pin: 'color' }, { node: ml.id, pin: 'a' })!;
  addReroute(doc, e1.id, [250, 170]);
  connect(doc, { node: tx.id, pin: 'color' }, { node: ml.id, pin: 'b' });
  const e3 = connect(doc, { node: ml.id, pin: 'out' }, { node: out.id, pin: 'Albedo' })!;
  addReroute(doc, e3.id, [540, 130]);
  connect(doc, { node: fr.id, pin: 'result' }, { node: ad.id, pin: 'a' });
  connect(doc, { node: ad.id, pin: 'out' }, { node: out.id, pin: 'Emission' });
  connect(doc, { node: fr.id, pin: 'result' }, { node: out.id, pin: 'AO' });

  // State variety, so every node state is visible for verification.
  const view = createGraphView();
  view.selection.add(ml.id); // Multiply shows the amber selection ring
  ad.error = 'Type mismatch on input b'; // Add shows the red error ring
  const dis = addNode(doc, { typeId: 'Add', pos: [20, 470], title: 'Disabled' });
  dis.disabled = true;
  const col = addNode(doc, { typeId: 'Multiply', pos: [300, 480], title: 'Collapsed' });
  col.collapsed = true;

  return { env, doc, view, theme: createGraphTheme(), fitRequested: false };
};

let demo: DemoState | null = null;

/** The graph-editor demo/acceptance panel. */
export const graphDemoPanel = (): PanelDef => ({
  id: '/graph-demo',
  title: 'Graph Editor',
  icon: 'workflow',
  slot: 'center',
  closable: true,
  flush: true,
  render: ({ ui }: EditorContext): void => {
    const d = (demo ??= buildDemo());

    ui.child('graph-demo-toolbar', { size: [0, 30], padding: [8, 4], noScrollbar: true }, () => {
      if (ui.button('Fit')) d.fitRequested = true;
      ui.sameLine(0, 6);
      if (ui.button(d.view.scanlines ? 'Scanlines ✓' : 'Scanlines')) d.view.scanlines = !d.view.scanlines;
      ui.sameLine(0, 12);
      ui.textMuted(`zoom ${Math.round(d.view.zoom * 100)}%  ·  ${d.doc.nodeOrder.length} nodes  ·  ${Object.keys(d.doc.edges).length} wires`);
    });

    const params = { ui, doc: d.doc, view: d.view, env: d.env, theme: d.theme };
    // Auto-frame the graph every frame until the user pans/zooms; the Fit button
    // re-arms auto-framing. This is immune to first-frame docking-size timing.
    if (d.fitRequested) {
      d.view.userNavigated = false;
      d.fitRequested = false;
    }
    if (!d.view.userNavigated) GraphEditor.fit(params);
    GraphEditor.draw(params);
  },
});
