import type { ShaderRegistry } from './shader-registry';

/**
 * Options accepted by {@link preprocessWgsl}.
 */
export interface PreprocessOptions {
  /**
   * Externally-supplied shader defines. Merged into the in-source `#define`
   * table before processing begins, so they are visible to the very first
   * `#ifdef` check.
   *
   * - `string` / `number` values are stringified and substituted as-is.
   * - `true` registers the name with an empty replacement, so the name is
   *   "defined" for `#ifdef` purposes but identifier references substitute
   *   to nothing.
   * - `false` is treated as **not defined** — convenient for boolean keys
   *   driven by a specialization struct.
   */
  defines?: Record<string, string | number | boolean>;
  /**
   * Shader label propagated into preprocessor error messages so a malformed
   * import or unterminated `#ifdef` points back at the source.
   */
  shaderLabel?: string;
}

interface IfFrame {
  /** Was the enclosing scope emitting at the time this `#ifdef` opened? */
  readonly parentEmitting: boolean;
  /** True when the original `#ifdef` / `#ifndef` condition was satisfied. */
  readonly conditionTrue: boolean;
  /** True after `#else` has flipped the branch. */
  inElse: boolean;
}

const frameEmits = (frame: IfFrame): boolean =>
  frame.parentEmitting && (frame.inElse ? !frame.conditionTrue : frame.conditionTrue);

const isWordChar = (c: string): boolean => {
  const code = c.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) || // 0-9
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) || // a-z
    code === 95 // _
  );
};

const replaceDefinedTokens = (source: string, defines: Map<string, string>): string => {
  if (defines.size === 0) return source;
  let result = '';
  let i = 0;
  const N = source.length;
  while (i < N) {
    const c = source[i]!;
    if (isWordChar(c)) {
      let j = i;
      while (j < N && isWordChar(source[j]!)) j++;
      const word = source.slice(i, j);
      const replacement = defines.get(word);
      result += replacement !== undefined ? replacement : word;
      i = j;
    } else {
      result += c;
      i++;
    }
  }
  return result;
};

const buildExternalDefines = (
  external: Record<string, string | number | boolean> | undefined,
): Map<string, string> => {
  const map = new Map<string, string>();
  if (!external) return map;
  for (const [key, value] of Object.entries(external)) {
    if (value === false) continue;
    if (value === true) map.set(key, '');
    else map.set(key, String(value));
  }
  return map;
};

const directiveName = (line: string, prefix: string): string => line.slice(prefix.length).trim();

const parseDefine = (
  body: string,
  label: string,
  lineNum: number,
): { name: string; value: string } => {
  const match = body.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:[\s]+(.*))?$/);
  if (!match) {
    throw new Error(`shader preprocessor: ${label} line ${lineNum}: malformed #define directive: ${body}`);
  }
  return { name: match[1]!, value: (match[2] ?? '').trim() };
};

const expandSource = (
  source: string,
  registry: ShaderRegistry,
  defines: Map<string, string>,
  imported: Set<string>,
  importStack: readonly string[],
  label: string,
): string => {
  const lines = source.split('\n');
  const ifStack: IfFrame[] = [];
  const out: string[] = [];

  const emitting = (): boolean =>
    ifStack.length === 0 || frameEmits(ifStack[ifStack.length - 1]!);

  for (let idx = 0; idx < lines.length; idx++) {
    const rawLine = lines[idx]!;
    const lineNum = idx + 1;
    const trimmed = rawLine.trim();

    if (trimmed.startsWith('#')) {
      if (trimmed.startsWith('#ifdef ')) {
        const name = directiveName(trimmed, '#ifdef ');
        ifStack.push({ parentEmitting: emitting(), conditionTrue: defines.has(name), inElse: false });
        continue;
      }
      if (trimmed.startsWith('#ifndef ')) {
        const name = directiveName(trimmed, '#ifndef ');
        ifStack.push({ parentEmitting: emitting(), conditionTrue: !defines.has(name), inElse: false });
        continue;
      }
      if (trimmed === '#else') {
        if (ifStack.length === 0) {
          throw new Error(`shader preprocessor: ${label} line ${lineNum}: #else without matching #ifdef`);
        }
        ifStack[ifStack.length - 1]!.inElse = true;
        continue;
      }
      if (trimmed === '#endif') {
        if (ifStack.length === 0) {
          throw new Error(`shader preprocessor: ${label} line ${lineNum}: #endif without matching #ifdef`);
        }
        ifStack.pop();
        continue;
      }
      if (!emitting()) continue;
      if (trimmed.startsWith('#import ')) {
        const moduleName = directiveName(trimmed, '#import ');
        if (moduleName.length === 0) {
          throw new Error(`shader preprocessor: ${label} line ${lineNum}: #import requires a module name`);
        }
        // Cycle check precedes single-include — a module already inlined at
        // the top level can still cycle if its own expansion re-imports it
        // before completing.
        if (importStack.includes(moduleName)) {
          throw new Error(
            `shader preprocessor: import cycle: ${[...importStack, moduleName].join(' -> ')}`,
          );
        }
        if (imported.has(moduleName)) continue;
        const moduleSource = registry.get(moduleName);
        if (moduleSource === undefined) {
          throw new Error(
            `shader preprocessor: ${label} line ${lineNum}: unknown shader module '${moduleName}'`,
          );
        }
        imported.add(moduleName);
        const expanded = expandSource(
          moduleSource,
          registry,
          defines,
          imported,
          [...importStack, moduleName],
          moduleName,
        );
        out.push(expanded);
        continue;
      }
      if (trimmed.startsWith('#define ')) {
        const { name, value } = parseDefine(directiveName(trimmed, '#define '), label, lineNum);
        defines.set(name, value);
        continue;
      }
      if (trimmed === '#define' || trimmed === '#import' || trimmed === '#ifdef' || trimmed === '#ifndef') {
        throw new Error(`shader preprocessor: ${label} line ${lineNum}: ${trimmed} requires an argument`);
      }
      // Unknown directive — pass through verbatim. Future WGSL extensions
      // (or backend-specific pragma-style directives) survive unmolested.
      out.push(replaceDefinedTokens(rawLine, defines));
      continue;
    }

    if (!emitting()) continue;
    out.push(replaceDefinedTokens(rawLine, defines));
  }

  if (ifStack.length > 0) {
    throw new Error(`shader preprocessor: ${label}: unterminated #ifdef (${ifStack.length} unclosed)`);
  }

  return out.join('\n');
};

/**
 * Preprocess a WGSL source string against a {@link ShaderRegistry}, producing
 * WGSL ready for `Renderer.createShaderModule`. Supports a small subset of
 * the C preprocessor:
 *
 * - `#import <module_name>` inlines a registered module's source at the
 *   directive line. Each module is inlined at most once per top-level
 *   compile (Bevy's `#pragma once` default). Cycles throw with the chain.
 * - `#define NAME [value]` registers a substitution. External `defines`
 *   from {@link PreprocessOptions} are seeded first and may be shadowed.
 *   Identifier references are substituted at token boundaries — adjacent
 *   word characters do not match. One-pass replacement (no recursive
 *   re-expansion).
 * - `#ifdef NAME` / `#ifndef NAME` / `#else` / `#endif` gate lines.
 *   Nestable. `#define` / `#import` inside an inactive branch are
 *   ignored.
 *
 * Out of scope today: `#import ... as alias`, selective imports, `#if
 * <expr>`, function-like macros, recursive define expansion. See ADR-0022
 * for the rationale.
 */
export const preprocessWgsl = (
  source: string,
  registry: ShaderRegistry,
  options?: PreprocessOptions,
): string => {
  const label = options?.shaderLabel ?? '<inline>';
  const defines = buildExternalDefines(options?.defines);
  return expandSource(source, registry, defines, new Set<string>(), [], label);
};
