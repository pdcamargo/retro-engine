import type { FieldKind } from '@retro-engine/reflect';

import type { CatalogComponent, ComposerCatalog } from './composer-catalog';
import type { Composition, ComposerMode } from './composer-state';

/** Format one field value for the echo as a TypeScript literal, by reflection kind. */
const formatValue = (kind: FieldKind, value: unknown): string => {
  if (value === null || value === undefined) return String(value);
  switch (kind) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'vec2':
    case 'vec3':
    case 'vec4':
    case 'quat':
    case 'color':
      return `[${Array.from(value as ArrayLike<number>, (n) => trimNum(n)).join(', ')}]`;
    case 'number':
      return trimNum(value as number);
    default:
      return typeof value === 'object' ? '{}' : String(value);
  }
};

const trimNum = (n: number): string => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3))));

/**
 * Field kinds whose value can't be meaningfully diffed against a fresh `make()`
 * (a handle / entity ref / nested instance is a new object each construction, so
 * it always "differs"). Excluded from override detection + the echo.
 */
export const NON_OVERRIDABLE: ReadonlySet<FieldKind> = new Set<FieldKind>(['handle', 'entity', 'type', 'mat4']);

/** The overridden fields of `instance` (differ from default), as `field: value` strings. */
const overriddenFields = (item: CatalogComponent, instance: object): string[] => {
  const fresh = item.reg.make() as Record<string, unknown>;
  const inst = instance as Record<string, unknown>;
  const out: string[] = [];
  for (const [field, ft] of item.reg.fields) {
    if (ft.isSkipped || NON_OVERRIDABLE.has(ft.kind)) continue;
    if (eq(inst[field], fresh[field])) continue;
    out.push(`${field}: ${formatValue(ft.kind, inst[field])}`);
  }
  return out;
};

const eq = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) {
    const av = a as unknown as ArrayLike<number>;
    const bv = b as unknown as ArrayLike<number>;
    if (av.length !== bv.length) return false;
    for (let i = 0; i < av.length; i++) if (!Object.is(av[i], bv[i])) return false;
    return true;
  }
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => eq(v, b[i]));
  if (isPlainRecord(a) && isPlainRecord(b)) {
    const ak = Object.keys(a);
    return ak.length === Object.keys(b).length && ak.every((k) => eq(a[k], b[k]));
  }
  return false;
};

const isPlainRecord = (v: unknown): v is Record<string, unknown> => {
  if (v === null || typeof v !== 'object' || Array.isArray(v) || ArrayBuffer.isView(v)) return false;
  const proto = Object.getPrototypeOf(v) as object | null;
  return proto === Object.prototype || proto === null;
};

/** One component as `new Name()` or `new Name({ a: x, b: y })` when it has overrides. */
const componentLiteral = (name: string, catalog: ComposerCatalog, drafts: ReadonlyMap<string, object>): string => {
  const item = catalog.byName.get(name);
  const instance = drafts.get(name);
  if (item === undefined || instance === undefined) return `new ${name}()`;
  const fields = overriddenFields(item, instance);
  return fields.length === 0 ? `new ${name}()` : `new ${name}({ ${fields.join(', ')} })`;
};

/** Inputs that personalize the echo header (entity name / target id / bundle name). */
export interface EchoContext {
  readonly entityName?: string;
  readonly targetId?: number | null;
  readonly bundleName?: string;
}

/**
 * The read-only code echo mirroring the commit: `world.spawn(...)` in create,
 * `world.entity(#id).insert(...)` in add, and a `bundle "Name" = [ ... ]` literal
 * in bundle mode. Overridden fields render as a struct literal; defaults render
 * as a bare component name.
 */
export const buildEcho = (
  mode: ComposerMode,
  composition: Composition,
  catalog: ComposerCatalog,
  drafts: ReadonlyMap<string, object>,
  ctx: EchoContext = {},
): string => {
  const names = composition.newNames;
  if (names.length === 0) {
    if (mode === 'add') return `world.entity(${ctx.targetId ?? 0})\n  // no components selected`;
    if (mode === 'bundle') return '// pick components for this bundle';
    return '// pick components to spawn';
  }
  const lines = names.map((n) => `  ${componentLiteral(n, catalog, drafts)},`).join('\n');
  if (mode === 'add') return `world.entity(${ctx.targetId ?? 0}).insert(\n${lines}\n);`;
  if (mode === 'bundle') return `app.registerBundle(${JSON.stringify(ctx.bundleName ?? 'Bundle')}, [\n${lines}\n]);`;
  return `const ${echoVarName(ctx.entityName)} = world.spawn(\n${lines}\n);`;
};

const echoVarName = (name: string | undefined): string => {
  if (name === undefined || name.trim().length === 0) return 'entity';
  const camel = name
    .trim()
    .replace(/[^a-zA-Z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : ''))
    .replace(/^[A-Z]/, (c) => c.toLowerCase());
  return /^[a-z][a-zA-Z0-9]*$/.test(camel) ? camel : 'entity';
};
