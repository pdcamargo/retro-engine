/**
 * Node-type descriptors and their per-kind registry. A node type declares a
 * node's category, header treatment, pins, and embedded fields; placed
 * {@link GraphNode} instances reference a type by id. Node types are registered
 * per {@link GraphKind} (a shader graph and a state machine have different
 * vocabularies), unlike the global data-type and category registries.
 */

import type { HeaderVariant } from './document';
import type { FieldDescriptor } from './field';

/** One declared pin on a node type. */
export interface PinDescriptor {
  /** Pin name, unique among the node type's pins on its side (inputs/outputs). */
  readonly name: string;
  /** Data-type name (see {@link DataTypeRegistry}); drives pin/wire color + validation. */
  readonly type: string;
  /** Display label; defaults to `name`. */
  readonly label?: string;
}

/** Describes a kind of node: its look, its pins, and its embedded fields. */
export interface NodeTypeDescriptor {
  /** Unique type id within its owning kind. */
  readonly type: string;
  /** Category name (see {@link CategoryRegistry}); drives the header accent color. */
  readonly category: string;
  /** Header treatment. Defaults to `'stripe'`. */
  readonly header?: HeaderVariant;
  /** Lucide icon name shown in the header; resolved by the host. */
  readonly icon?: string;
  /** Display title; defaults to `type`. */
  readonly label?: string;
  /** Pixel-font sub-label (UPPERCASE); defaults to the category name. */
  readonly sub?: string;
  /** Input pins, top-to-bottom on the node's left edge. */
  readonly inputs?: readonly PinDescriptor[];
  /** Output pins, top-to-bottom on the node's right edge. */
  readonly outputs?: readonly PinDescriptor[];
  /** Embedded fields drawn in the node body. */
  readonly fields?: readonly FieldDescriptor[];
}

/** A per-kind registry of {@link NodeTypeDescriptor}s, keyed by type id. */
export class NodeTypeRegistry {
  private readonly byType = new Map<string, NodeTypeDescriptor>();

  register(desc: NodeTypeDescriptor): this {
    this.byType.set(desc.type, desc);
    return this;
  }

  get(type: string): NodeTypeDescriptor | undefined {
    return this.byType.get(type);
  }

  has(type: string): boolean {
    return this.byType.has(type);
  }

  list(): readonly NodeTypeDescriptor[] {
    return [...this.byType.values()];
  }

  /** Look up a pin descriptor by name on the given side of a node type. */
  pin(type: string, name: string, dir: 'in' | 'out'): PinDescriptor | undefined {
    const desc = this.byType.get(type);
    if (desc === undefined) return undefined;
    const pins = dir === 'in' ? desc.inputs : desc.outputs;
    return pins?.find((p) => p.name === name);
  }
}
