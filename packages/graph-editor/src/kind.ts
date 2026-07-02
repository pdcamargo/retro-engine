/**
 * A graph kind: a named family of graph (dataflow, exec-flow, state machine, …)
 * that owns its node-type vocabulary and its connection-validation rule. Data
 * types and categories are shared globally (via {@link GraphEnvironment}); a
 * kind references them by name. A {@link GraphDocument} is authored against one
 * kind (`document.kindId`).
 */

import type { GraphNode } from './document';
import { EdgeTypeRegistry } from './edge-type';
import { NodeTypeRegistry, type NodeTypeDescriptor, type PinDescriptor } from './node-type';

/** A pin resolved against a document + node type: everything a rule needs. */
export interface ResolvedPin {
  readonly node: GraphNode;
  readonly nodeType: NodeTypeDescriptor;
  readonly pin: PinDescriptor;
  /** Which side of the node the pin is on. */
  readonly dir: 'in' | 'out';
}

/** Decides whether a candidate connection (an output pin → an input pin) is legal. */
export type ConnectRule = (from: ResolvedPin, to: ResolvedPin) => boolean;

/**
 * The default rule: connect an output to an input of the same data type. Kinds
 * with coercions (int→float, etc.) or exec-only flow supply their own rule.
 */
export const defaultConnectRule: ConnectRule = (from, to) =>
  from.dir === 'out' && to.dir === 'in' && from.pin.type === to.pin.type;

/** Options for registering a kind. */
export interface GraphKindOptions {
  readonly id: string;
  readonly label?: string;
  /** Connection rule; defaults to {@link defaultConnectRule}. */
  readonly canConnect?: ConnectRule;
}

/** A registered graph kind. Owns its {@link NodeTypeRegistry}. */
export class GraphKind {
  readonly id: string;
  readonly label: string;
  readonly nodeTypes = new NodeTypeRegistry();
  /** Per-kind edge-type overrides; unregistered ids fall back to the environment built-ins. */
  readonly edgeTypes = new EdgeTypeRegistry();
  private readonly rule: ConnectRule;

  constructor(opts: GraphKindOptions) {
    this.id = opts.id;
    this.label = opts.label ?? opts.id;
    this.rule = opts.canConnect ?? defaultConnectRule;
  }

  /** Whether an output pin may connect to an input pin under this kind's rule. */
  canConnect(from: ResolvedPin, to: ResolvedPin): boolean {
    return this.rule(from, to);
  }
}
