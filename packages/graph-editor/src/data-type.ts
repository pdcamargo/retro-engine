/**
 * The global registry of pin/wire data types. Every data type owns a fixed hue
 * and a pin shape; a wire inherits its source pin's type color. The registry is
 * open — consumers add their own types (`registerType`) so custom pins get a
 * consistent color everywhere (pins, wires, reroutes, minimap). Colors are CSS
 * hex strings the theme resolves and may override.
 */

/** How a pin of this type is drawn: a dot (data) or a triangle (execution flow). */
export type PinShape = 'dot' | 'triangle';

/** Describes one data type in the shared visual language. */
export interface DataTypeDescriptor {
  /** Unique type name, e.g. `'float'`, `'exec'`, `'quat'`. */
  readonly name: string;
  /** Default pin/wire color as a CSS hex string; the theme may override it. */
  readonly color: string;
  /** Pin glyph shape. Defaults to `'dot'`. */
  readonly shape: PinShape;
}

/** The built-in data types (the handoff's typed pin/wire color map). */
export const BUILTIN_DATA_TYPES: readonly DataTypeDescriptor[] = [
  { name: 'exec', color: '#f1faf4', shape: 'triangle' },
  { name: 'bool', color: '#ff5c5c', shape: 'dot' },
  { name: 'int', color: '#ffc233', shape: 'dot' },
  { name: 'float', color: '#34e07a', shape: 'dot' },
  { name: 'vector', color: '#38d9f0', shape: 'dot' },
  { name: 'color', color: '#ff5cc8', shape: 'dot' },
  { name: 'string', color: '#b9a7ff', shape: 'dot' },
  { name: 'object', color: '#67a6fb', shape: 'dot' },
  { name: 'texture', color: '#dd8f45', shape: 'dot' },
];

/** An open registry of {@link DataTypeDescriptor}s, keyed by name. */
export class DataTypeRegistry {
  private readonly byName = new Map<string, DataTypeDescriptor>();

  /** Register (or replace) a data type. Missing `shape` defaults to `'dot'`. */
  register(desc: { name: string; color: string; shape?: PinShape }): this {
    this.byName.set(desc.name, { name: desc.name, color: desc.color, shape: desc.shape ?? 'dot' });
    return this;
  }

  get(name: string): DataTypeDescriptor | undefined {
    return this.byName.get(name);
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }

  list(): readonly DataTypeDescriptor[] {
    return [...this.byName.values()];
  }
}
