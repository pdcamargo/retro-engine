import type { ParamSchema, Template } from './template';

/**
 * Per-App store of registered {@link Template}s, keyed by their stable name. An
 * App resource (inserted at construction); a plugin registers its templates from
 * `build()` via `app.registerTemplate(...)`. Name lookup is what lets a scene
 * reference a template by name and lets `spawnTemplate(app, 'Name', ...)` resolve.
 */
export class TemplateRegistry {
  private readonly byName = new Map<string, Template<ParamSchema>>();

  /**
   * Register a template under its stable name. Throws if the name is already
   * taken — names are the identity a scene references, so collisions are a bug.
   */
  register<P extends ParamSchema>(template: Template<P>): Template<P> {
    if (this.byName.has(template.name)) {
      throw new Error(`prefab: a template named '${template.name}' is already registered`);
    }
    this.byName.set(template.name, template);
    return template;
  }

  /** Look up a registered template by name, or `undefined` if none is registered. */
  get(name: string): Template<ParamSchema> | undefined {
    return this.byName.get(name);
  }

  /** Whether a template is registered under `name`. */
  has(name: string): boolean {
    return this.byName.has(name);
  }

  /** Iterate every registered template. */
  *templates(): IterableIterator<Template<ParamSchema>> {
    yield* this.byName.values();
  }
}
