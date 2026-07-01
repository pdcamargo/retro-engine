import { describe, expect, it } from 'bun:test';

import { createGraphDocument } from './document';
import { createGraphEnvironment } from './environment';
import { addNode, connect } from './ops';

const dataflowEnv = () => {
  const env = createGraphEnvironment();
  const kind = env.registerKind({ id: 'dataflow' });
  kind.nodeTypes
    .register({ type: 'Param', category: 'input', outputs: [{ name: 'out', type: 'float' }] })
    .register({
      type: 'Multiply',
      category: 'math',
      inputs: [
        { name: 'a', type: 'float' },
        { name: 'b', type: 'float' },
      ],
      outputs: [{ name: 'out', type: 'vector' }],
    })
    .register({ type: 'Output', category: 'output', inputs: [{ name: 'albedo', type: 'color' }] });
  return env;
};

describe('environment', () => {
  it('seeds the built-in data types and categories', () => {
    const env = createGraphEnvironment();
    expect(env.dataTypes.get('float')?.color).toBe('#34e07a');
    expect(env.dataTypes.get('exec')?.shape).toBe('triangle');
    expect(env.dataTypes.get('float')?.shape).toBe('dot');
    expect(env.categories.get('math')?.color).toBe('#38d9f0');
    expect(env.dataTypes.list()).toHaveLength(9);
    expect(env.categories.list()).toHaveLength(7);
  });

  it('omits defaults when seedDefaults is false', () => {
    const env = createGraphEnvironment({ seedDefaults: false });
    expect(env.dataTypes.list()).toHaveLength(0);
  });

  it('registers custom types and categories', () => {
    const env = createGraphEnvironment();
    env.registerType({ name: 'quat', color: '#c084fc' });
    expect(env.dataTypes.get('quat')).toEqual({ name: 'quat', color: '#c084fc', shape: 'dot' });
  });

  it('resolves a pin and its data type', () => {
    const env = dataflowEnv();
    const doc = createGraphDocument({ kindId: 'dataflow' });
    const p = addNode(doc, { typeId: 'Param', pos: [0, 0] });
    const resolved = env.resolvePin(doc, { node: p.id, pin: 'out' }, 'out');
    expect(resolved?.pin.type).toBe('float');
    expect(env.pinDataType(doc, { node: p.id, pin: 'out' }, 'out')?.color).toBe('#34e07a');
  });

  it('derives an edge data type from its source pin', () => {
    const env = dataflowEnv();
    const doc = createGraphDocument({ kindId: 'dataflow' });
    const a = addNode(doc, { typeId: 'Param', pos: [0, 0] });
    const b = addNode(doc, { typeId: 'Multiply', pos: [200, 0] });
    const e = connect(doc, { node: a.id, pin: 'out' }, { node: b.id, pin: 'a' })!;
    expect(env.edgeDataType(doc, e)?.name).toBe('float');
  });

  it('accepts a type-compatible connection and rejects mismatches / bad directions', () => {
    const env = dataflowEnv();
    const doc = createGraphDocument({ kindId: 'dataflow' });
    const a = addNode(doc, { typeId: 'Param', pos: [0, 0] }); // out: float
    const m = addNode(doc, { typeId: 'Multiply', pos: [200, 0] }); // in a,b: float; out: vector
    const o = addNode(doc, { typeId: 'Output', pos: [400, 0] }); // in albedo: color

    // float out -> float in: ok
    expect(env.canConnect(doc, { node: a.id, pin: 'out' }, { node: m.id, pin: 'a' })).toBe(true);
    // vector out -> color in: type mismatch
    expect(env.canConnect(doc, { node: m.id, pin: 'out' }, { node: o.id, pin: 'albedo' })).toBe(false);
    // input used as source (wrong direction): unresolvable as 'out'
    expect(env.canConnect(doc, { node: m.id, pin: 'a' }, { node: o.id, pin: 'albedo' })).toBe(false);
    // unknown pin
    expect(env.canConnect(doc, { node: a.id, pin: 'nope' }, { node: m.id, pin: 'a' })).toBe(false);
  });

  it('honors a custom connect rule (int coerces to float)', () => {
    const env = createGraphEnvironment();
    const kind = env.registerKind({
      id: 'coerce',
      canConnect: (from, to) =>
        from.dir === 'out' &&
        to.dir === 'in' &&
        (from.pin.type === to.pin.type || (from.pin.type === 'int' && to.pin.type === 'float')),
    });
    kind.nodeTypes
      .register({ type: 'IntSrc', category: 'input', outputs: [{ name: 'out', type: 'int' }] })
      .register({ type: 'FloatSink', category: 'math', inputs: [{ name: 'in', type: 'float' }] });
    const doc = createGraphDocument({ kindId: 'coerce' });
    const s = addNode(doc, { typeId: 'IntSrc', pos: [0, 0] });
    const d = addNode(doc, { typeId: 'FloatSink', pos: [200, 0] });
    expect(env.canConnect(doc, { node: s.id, pin: 'out' }, { node: d.id, pin: 'in' })).toBe(true);
  });
});
