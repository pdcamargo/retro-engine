import type { CommandManifest, JsonSchema } from '@retro-engine/mcp-protocol';

import type { CommandContext } from './context';

/**
 * One editor-control command. The single unit a developer adds to extend what an
 * AI can do: declare a name, a JSON-Schema for its arguments, and a handler that
 * runs against the live {@link CommandContext}. The handler's return value is
 * sent back to the AI as JSON, so it must be JSON-serializable.
 */
export interface CommandDef {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly domain: string;
  /** Whether the command writes editor/scene state (drives audit logging). */
  readonly mutating: boolean;
  readonly inputSchema: JsonSchema;
  /**
   * When present and it returns `false`, the command is hidden from the catalog
   * and rejected if invoked (e.g. `studio.eval` while eval is disabled).
   */
  readonly available?: (ctx: CommandContext) => boolean;
  handler(ctx: CommandContext, args: unknown): unknown | Promise<unknown>;
}

/** Identity helper — returns its argument, typed as a {@link CommandDef}. */
export const defineCommand = (def: CommandDef): CommandDef => def;

/**
 * The set of commands a studio exposes. Built-in commands are added at boot;
 * plugins can add more before the bridge connects (or at runtime, refreshing the
 * catalog). One registry is the single source of truth for the MCP tool list.
 */
export class CommandRegistry {
  private readonly commands = new Map<string, CommandDef>();

  /** Register a command. Re-registering the same name replaces it. */
  add(def: CommandDef): this {
    this.commands.set(def.name, def);
    return this;
  }

  /** Register several commands. */
  addAll(defs: Iterable<CommandDef>): this {
    for (const def of defs) this.add(def);
    return this;
  }

  get(name: string): CommandDef | undefined {
    return this.commands.get(name);
  }

  /** All registered commands, in insertion order. */
  list(): readonly CommandDef[] {
    return [...this.commands.values()];
  }

  /** Whether a command is currently available in `ctx` (default-true when it has no gate). */
  isAvailable(def: CommandDef, ctx: CommandContext): boolean {
    return def.available === undefined || def.available(ctx);
  }

  /** The catalog of currently-available commands, for a Hello/Catalog frame. */
  manifest(ctx: CommandContext): CommandManifest[] {
    const out: CommandManifest[] = [];
    for (const def of this.commands.values()) {
      if (!this.isAvailable(def, ctx)) continue;
      out.push({
        name: def.name,
        title: def.title,
        description: def.description,
        domain: def.domain,
        mutating: def.mutating,
        inputSchema: def.inputSchema,
      });
    }
    return out;
  }
}
