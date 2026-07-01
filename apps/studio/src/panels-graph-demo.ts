// Demo panel for the reusable graph-editor toolkit (@retro-engine/graph-editor).
// It stands up a dataflow graph kind + a sample shader-style document and draws
// it with GraphEditor, so the toolkit can be verified end-to-end in the studio
// (pan/zoom/fit, header variants, node states, typed pins, bezier wires,
// reroute weight-points). It is the acceptance surface for the phased build-out;
// consumer graphs (animation, shader) come later.

import { type EditorContext, type History, type PanelDef } from '@retro-engine/editor-sdk';
import {
  addGroup,
  addNode,
  addReroute,
  connect,
  createGraphDocument,
  createGraphEnvironment,
  createGraphTheme,
  createGraphView,
  GraphEditor,
  GraphHost,
  type GraphTheme,
  type GraphView,
  mintId,
} from '@retro-engine/graph-editor';

/** The shared demo state: the host (registered as an App resource) + this view's transform. */
export interface GraphDemo {
  host: GraphHost;
  view: GraphView;
  theme: GraphTheme;
  fitRequested: boolean;
}

/** Build the demo environment + sample document and wrap it in a shared {@link GraphHost}. */
export const createGraphDemo = (): GraphDemo => {
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

  // A second kind — a flow / state machine — to prove multiple kinds coexist in
  // one environment: exec pins, state nodes, transitions, a subgraph group.
  const flow = env.registerKind({ id: 'flow', label: 'Flow / State' });
  flow.nodeTypes
    .register({ type: 'Entry', category: 'input', style: 'state', sub: 'entry' })
    .register({ type: 'State', category: 'flow', style: 'state', sub: 'loop' })
    .register({
      type: 'Branch',
      category: 'logic',
      header: 'solid',
      sub: 'flow',
      inputs: [
        { name: 'exec', type: 'exec' },
        { name: 'cond', type: 'bool' },
      ],
      outputs: [
        { name: 'true', type: 'exec' },
        { name: 'false', type: 'exec' },
      ],
    })
    .register({
      type: 'Subgraph',
      category: 'subgraph',
      header: 'stripe',
      sub: 'subgraph',
      inputs: [
        { name: 'Boolean', type: 'bool' },
        { name: 'Float', type: 'float' },
        { name: 'Vector', type: 'vector' },
        { name: 'Color', type: 'color' },
        { name: 'Texture', type: 'texture' },
      ],
      outputs: [{ name: 'Output', type: 'object' }],
      fields: [{ name: 'mode', kind: 'combo', options: ['Add', 'Blend'], default: 'Blend' }],
    })
    .register({
      type: 'Context',
      category: 'subgraph',
      style: 'stack',
      sub: 'context',
      fields: [
        { name: 'Lifetime', kind: 'number', default: 1 },
        { name: 'Velocity', kind: 'number', default: 4 },
        { name: 'Gravity', kind: 'number', default: -9.8 },
      ],
    });

  const flowDoc = createGraphDocument({ kindId: 'flow' });
  const entry = addNode(flowDoc, { typeId: 'Entry', pos: [60, 60], title: 'Entry' });
  const idle = addNode(flowDoc, { typeId: 'State', pos: [270, 60], title: 'Idle' });
  const walk = addNode(flowDoc, { typeId: 'State', pos: [480, 20], title: 'Walk' });
  const jump = addNode(flowDoc, { typeId: 'State', pos: [480, 150], title: 'Jump' });
  const transition = (a: string, b: string, label?: string): void => {
    const e = connect(flowDoc, { node: a, pin: '' }, { node: b, pin: '' });
    if (e !== undefined) {
      e.style = 'transition';
      if (label !== undefined) e.label = label;
    }
  };
  transition(entry.id, idle.id);
  transition(idle.id, walk.id, 'W');
  transition(walk.id, jump.id, 'J');
  transition(jump.id, idle.id, 'L');
  addNode(flowDoc, { typeId: 'Branch', pos: [60, 300] });
  addNode(flowDoc, { typeId: 'Subgraph', pos: [320, 300] });
  addNode(flowDoc, { typeId: 'Context', pos: [640, 300], title: 'Initialize Particle' });
  const gid = mintId(flowDoc, 'group');
  flowDoc.groups[gid] = { id: gid, rect: [40, 10, 620, 220], title: 'State Machine', categoryId: 'flow' };

  const host = new GraphHost(env);
  host.open(doc);
  host.open(flowDoc);
  return { host, view, theme: createGraphTheme(), fitRequested: false };
};

/** Wrap the selected nodes (or all nodes) in a new subgraph group. */
const addGroupAroundSelection = (d: GraphDemo): void => {
  const doc = d.host.active();
  if (doc === undefined) return;
  const ids = d.view.selection.size > 0 ? [...d.view.selection] : doc.nodeOrder;
  const NW = 190;
  const NH = 130;
  const pad = 32;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let any = false;
  for (const id of ids) {
    const n = doc.nodes[id];
    if (n === undefined) continue;
    any = true;
    minX = Math.min(minX, n.pos[0]);
    minY = Math.min(minY, n.pos[1]);
    maxX = Math.max(maxX, n.pos[0] + NW);
    maxY = Math.max(maxY, n.pos[1] + NH);
  }
  if (!any) return;
  addGroup(doc, [minX - pad, minY - pad, maxX - minX + pad * 2, maxY - minY + pad * 2], 'Group', 'subgraph');
};

/** The graph-editor demo/acceptance panel. Shares its {@link GraphHost} with the MCP layer. */
export const graphDemoPanel = (demo: GraphDemo, history: History): PanelDef => ({
  id: '/graph-demo',
  title: 'Graph Editor',
  icon: 'workflow',
  slot: 'center',
  closable: true,
  flush: true,
  render: ({ ui }: EditorContext): void => {
    const d = demo;
    const doc = d.host.active();
    if (doc === undefined) return;

    ui.child('graph-demo-toolbar', { size: [0, 30], padding: [8, 4], noScrollbar: true }, () => {
      if (ui.button('Fit')) d.fitRequested = true;
      ui.setItemTooltip('Frame all nodes (or press F)');
      ui.sameLine(0, 6);
      if (ui.button('+ Group')) addGroupAroundSelection(d);
      ui.setItemTooltip('Group the selected nodes (drag a group by its title tab; Delete removes it)');
      ui.sameLine(0, 6);
      if (ui.button(d.view.scanlines ? 'Scanlines: on' : 'Scanlines: off')) d.view.scanlines = !d.view.scanlines;
      ui.setItemTooltip('Toggle the retro CRT scanline overlay (cosmetic)');
      ui.sameLine(0, 6);
      const docs = d.host.list();
      if (docs.length > 1 && ui.button(`Kind: ${doc.kindId}`)) {
        const i = docs.findIndex((x) => x.guid === doc.guid);
        d.host.setActive(docs[(i + 1) % docs.length]!.guid);
        d.view.userNavigated = false; // re-frame the newly active document
        d.view.selection.clear();
        d.view.edgeSelection.clear();
        d.view.rerouteSelection.clear();
        d.view.groupSelection.clear();
      }
      ui.setItemTooltip('Switch which graph document is active');
      ui.sameLine(0, 12);
      ui.textMuted(`zoom ${Math.round(d.view.zoom * 100)}%  ·  ${doc.nodeOrder.length} nodes  ·  ${Object.keys(doc.edges).length} wires`);
    });

    const params = { ui, doc, view: d.view, env: d.host.env, theme: d.theme, history };
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
