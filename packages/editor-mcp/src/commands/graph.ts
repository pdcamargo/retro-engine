import {
  addNode,
  addReroute,
  connect,
  disconnect,
  type GraphDocument,
  GraphHost,
  moveNode,
  recordGraphEdit,
  removeNode,
  removeReroute,
  setFieldValue,
} from '@retro-engine/graph-editor';

import { asRecord, optString, reqString } from '../args';
import type { CommandContext } from '../context';
import { type CommandDef, defineCommand } from '../registry';

const graphEdit = recordGraphEdit;

const host = (ctx: CommandContext): GraphHost => {
  const h = ctx.app.getResource(GraphHost);
  if (h === undefined) throw new Error('No GraphHost is registered in this studio.');
  return h;
};

const doc = (ctx: CommandContext, guid?: string): GraphDocument => {
  const d = host(ctx).resolve(guid);
  if (d === undefined) throw new Error(guid !== undefined ? `Graph ${guid} is not open.` : 'No active graph document.');
  return d;
};

const readPos = (record: Record<string, unknown>): [number, number] => {
  const p = record.pos;
  if (!Array.isArray(p) || p.length < 2 || typeof p[0] !== 'number' || typeof p[1] !== 'number') {
    throw new Error('`pos` must be a [x, y] number pair.');
  }
  return [p[0], p[1]];
};

const readPin = (record: Record<string, unknown>, key: string): { node: string; pin: string } => {
  const r = asRecord(record[key]);
  return { node: reqString(r, 'node'), pin: reqString(r, 'pin') };
};

/** The `graph.*` MCP commands: describe, read, and mutate the live graph document(s). */
export const graphCommands: readonly CommandDef[] = [
  defineCommand({
    name: 'graph.describe',
    title: 'Describe graphs',
    description:
      'Open graph documents, plus the available graph kinds (their node types) and the shared data types + categories — everything needed to author nodes.',
    domain: 'graph',
    mutating: false,
    inputSchema: { type: 'object', properties: {} },
    available: (ctx) => ctx.app.getResource(GraphHost) !== undefined,
    handler: (ctx) => {
      const h = host(ctx);
      return {
        active: h.active()?.guid ?? null,
        documents: h.list(),
        dataTypes: h.env.dataTypes.list(),
        categories: h.env.categories.list(),
        kinds: h.env.kindList().map((k) => ({
          id: k.id,
          label: k.label,
          nodeTypes: k.nodeTypes.list().map((nt) => ({
            type: nt.type,
            category: nt.category,
            header: nt.header ?? 'stripe',
            inputs: nt.inputs ?? [],
            outputs: nt.outputs ?? [],
            fields: (nt.fields ?? []).map((f) => ({ name: f.name, kind: f.kind })),
          })),
        })),
      };
    },
  }),

  defineCommand({
    name: 'graph.get',
    title: 'Get graph',
    description: 'Dump a graph document (nodes, edges, reroutes, groups). Defaults to the active document.',
    domain: 'graph',
    mutating: false,
    inputSchema: { type: 'object', properties: { guid: { type: 'string' } } },
    handler: (ctx, args) => {
      const d = doc(ctx, optString(asRecord(args), 'guid'));
      return {
        guid: d.guid,
        kindId: d.kindId,
        nodes: d.nodeOrder.map((id) => d.nodes[id]).filter((n) => n !== undefined),
        edges: Object.values(d.edges),
        reroutes: Object.values(d.reroutes),
        groups: Object.values(d.groups),
      };
    },
  }),

  defineCommand({
    name: 'graph.addNode',
    title: 'Add graph node',
    description: 'Add a node of a registered type at a world position. Undoable.',
    domain: 'graph',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: {
        guid: { type: 'string' },
        type: { type: 'string', description: 'registered node-type id' },
        pos: { type: 'array', items: { type: 'number' }, description: '[x, y] world position' },
        title: { type: 'string' },
      },
      required: ['type', 'pos'],
    },
    handler: (ctx, args) => {
      const record = asRecord(args);
      const d = doc(ctx, optString(record, 'guid'));
      const type = reqString(record, 'type');
      const title = optString(record, 'title');
      const kind = host(ctx).env.kind(d.kindId);
      if (kind?.nodeTypes.has(type) !== true) throw new Error(`Unknown node type '${type}' for kind '${d.kindId}'.`);
      const pos = readPos(record);
      const node = graphEdit(ctx.history, d, `Add ${type}`, () => addNode(d, title !== undefined ? { typeId: type, pos, title } : { typeId: type, pos }));
      return { node: node.id };
    },
  }),

  defineCommand({
    name: 'graph.moveNode',
    title: 'Move graph node',
    description: 'Set a node’s world position. Undoable.',
    domain: 'graph',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: { guid: { type: 'string' }, node: { type: 'string' }, pos: { type: 'array', items: { type: 'number' } } },
      required: ['node', 'pos'],
    },
    handler: (ctx, args) => {
      const record = asRecord(args);
      const d = doc(ctx, optString(record, 'guid'));
      const node = reqString(record, 'node');
      const pos = readPos(record);
      if (d.nodes[node] === undefined) throw new Error(`No node '${node}'.`);
      graphEdit(ctx.history, d, 'Move node', () => moveNode(d, node, pos));
      return { node, pos };
    },
  }),

  defineCommand({
    name: 'graph.connect',
    title: 'Connect pins',
    description: 'Connect an output pin to an input pin, validated against the kind’s rules. Undoable.',
    domain: 'graph',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: {
        guid: { type: 'string' },
        from: { type: 'object', properties: { node: { type: 'string' }, pin: { type: 'string' } }, required: ['node', 'pin'] },
        to: { type: 'object', properties: { node: { type: 'string' }, pin: { type: 'string' } }, required: ['node', 'pin'] },
      },
      required: ['from', 'to'],
    },
    handler: (ctx, args) => {
      const record = asRecord(args);
      const d = doc(ctx, optString(record, 'guid'));
      const from = readPin(record, 'from');
      const to = readPin(record, 'to');
      if (!host(ctx).env.canConnect(d, from, to)) {
        return { ok: false, reason: 'Connection rejected: incompatible pin types or direction.' };
      }
      const edge = graphEdit(ctx.history, d, 'Connect', () => connect(d, from, to));
      return edge !== undefined ? { ok: true, edge: edge.id } : { ok: false, reason: 'Duplicate or self connection.' };
    },
  }),

  defineCommand({
    name: 'graph.disconnect',
    title: 'Disconnect edge',
    description: 'Remove an edge (and its reroute knots). Undoable.',
    domain: 'graph',
    mutating: true,
    inputSchema: { type: 'object', properties: { guid: { type: 'string' }, edge: { type: 'string' } }, required: ['edge'] },
    handler: (ctx, args) => {
      const record = asRecord(args);
      const d = doc(ctx, optString(record, 'guid'));
      const edge = reqString(record, 'edge');
      if (d.edges[edge] === undefined) throw new Error(`No edge '${edge}'.`);
      graphEdit(ctx.history, d, 'Disconnect', () => disconnect(d, edge));
      return { edge };
    },
  }),

  defineCommand({
    name: 'graph.addReroute',
    title: 'Add reroute',
    description: 'Drop a reroute weight-point on an edge at a world position. Undoable.',
    domain: 'graph',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: { guid: { type: 'string' }, edge: { type: 'string' }, pos: { type: 'array', items: { type: 'number' } } },
      required: ['edge', 'pos'],
    },
    handler: (ctx, args) => {
      const record = asRecord(args);
      const d = doc(ctx, optString(record, 'guid'));
      const edge = reqString(record, 'edge');
      if (d.edges[edge] === undefined) throw new Error(`No edge '${edge}'.`);
      const pos = readPos(record);
      const knot = graphEdit(ctx.history, d, 'Add reroute', () => addReroute(d, edge, pos));
      return knot !== undefined ? { reroute: knot.id } : { ok: false };
    },
  }),

  defineCommand({
    name: 'graph.removeReroute',
    title: 'Remove reroute',
    description: 'Remove a reroute knot, rejoining its neighbors. Undoable.',
    domain: 'graph',
    mutating: true,
    inputSchema: { type: 'object', properties: { guid: { type: 'string' }, reroute: { type: 'string' } }, required: ['reroute'] },
    handler: (ctx, args) => {
      const record = asRecord(args);
      const d = doc(ctx, optString(record, 'guid'));
      const reroute = reqString(record, 'reroute');
      if (d.reroutes[reroute] === undefined) throw new Error(`No reroute '${reroute}'.`);
      graphEdit(ctx.history, d, 'Remove reroute', () => removeReroute(d, reroute));
      return { reroute };
    },
  }),

  defineCommand({
    name: 'graph.setField',
    title: 'Set node field',
    description: 'Set an embedded field value on a node. Undoable.',
    domain: 'graph',
    mutating: true,
    inputSchema: {
      type: 'object',
      properties: { guid: { type: 'string' }, node: { type: 'string' }, field: { type: 'string' }, value: {} },
      required: ['node', 'field'],
    },
    handler: (ctx, args) => {
      const record = asRecord(args);
      const d = doc(ctx, optString(record, 'guid'));
      const node = reqString(record, 'node');
      const field = reqString(record, 'field');
      if (d.nodes[node] === undefined) throw new Error(`No node '${node}'.`);
      graphEdit(ctx.history, d, 'Set field', () => setFieldValue(d, node, field, record.value));
      return { node, field };
    },
  }),

  defineCommand({
    name: 'graph.deleteNode',
    title: 'Delete graph node',
    description: 'Remove a node and its incident edges + reroutes. Undoable.',
    domain: 'graph',
    mutating: true,
    inputSchema: { type: 'object', properties: { guid: { type: 'string' }, node: { type: 'string' } }, required: ['node'] },
    handler: (ctx, args) => {
      const record = asRecord(args);
      const d = doc(ctx, optString(record, 'guid'));
      const node = reqString(record, 'node');
      if (d.nodes[node] === undefined) throw new Error(`No node '${node}'.`);
      graphEdit(ctx.history, d, 'Delete node', () => removeNode(d, node));
      return { node };
    },
  }),

  defineCommand({
    name: 'graph.setActive',
    title: 'Set active graph',
    description: 'Make a document the active graph (does not modify any document).',
    domain: 'graph',
    mutating: false,
    inputSchema: { type: 'object', properties: { guid: { type: 'string' } }, required: ['guid'] },
    handler: (ctx, args) => {
      const guid = reqString(asRecord(args), 'guid');
      if (!host(ctx).setActive(guid)) throw new Error(`Graph ${guid} is not open.`);
      return { active: guid };
    },
  }),
];
