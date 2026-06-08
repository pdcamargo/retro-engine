import type { FieldType } from '@retro-engine/reflect';

/**
 * A template's parameter schema: a map of param name to its {@link FieldType}.
 * Reuses the reflection `t` vocabulary so params round-trip through scenes the
 * same way component fields do.
 */
export type ParamSchema = Record<string, FieldType<unknown>>;

/**
 * The resolved value type for a {@link ParamSchema} — each param's static type,
 * inferred from its field descriptor. This is what a template's `build` receives.
 */
export type ResolvedParams<P extends ParamSchema> = {
  [K in keyof P]: P[K] extends FieldType<infer U> ? U : never;
};

/**
 * A named, parameterized entity recipe. Calling `build` with resolved params
 * produces the component instances to spawn or patch onto an entity; Required
 * Components fill in when the result is inserted through the command buffer.
 *
 * Templates are plain data + a factory — there is no base class to extend. Create
 * one with {@link defineTemplate}.
 */
export interface Template<P extends ParamSchema = ParamSchema> {
  /** Stable, minification-safe name. The key a scene references and the registry stores. */
  readonly name: string;
  /** The parameter schema. Empty when the template takes no params. */
  readonly params: P;
  /** Construct the component instances for this template from its resolved params. */
  build(params: ResolvedParams<P>): object[];
}

/**
 * The shape passed to {@link defineTemplate}. Identical to {@link Template} except
 * `params` is optional (defaults to an empty schema).
 */
export interface TemplateDefinition<P extends ParamSchema> {
  /** Stable, minification-safe name. */
  readonly name: string;
  /** The parameter schema, or omit for a template with no params. */
  readonly params?: P;
  /** Construct the component instances from resolved params. */
  build(params: ResolvedParams<P>): object[];
}

/**
 * Define a template. The param schema (if any) is inferred, so `build` receives
 * fully-typed params.
 *
 * @example
 * ```ts
 * const Enemy = defineTemplate({
 *   name: 'Enemy',
 *   params: { position: t.vec3.default(() => vec3.create()), health: t.number.default(() => 100) },
 *   build: ({ position, health }) => [new Transform(position), new Health(health)],
 * });
 * ```
 */
export const defineTemplate = <P extends ParamSchema = Record<never, never>>(
  def: TemplateDefinition<P>,
): Template<P> => ({
  name: def.name,
  params: def.params ?? ({} as P),
  build: def.build,
});

/**
 * Run a template's recipe with already-resolved params, returning the component
 * instances. A pure helper — no App, no command buffer; use {@link spawnTemplate}
 * to actually spawn them.
 */
export const expandTemplate = <P extends ParamSchema>(
  template: Template<P>,
  params: ResolvedParams<P>,
): object[] => template.build(params);
