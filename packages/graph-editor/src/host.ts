/**
 * Tracks the set of open graph documents alongside the {@link GraphEnvironment}
 * they are authored against, and which one is active. A single host is shared by
 * the editor panel(s) that render graphs and by the MCP command layer that
 * mutates them, so an agent can address "the active graph" or a specific
 * document by GUID.
 */

import type { GraphDocument } from './document';
import type { GraphEnvironment } from './environment';

/** A brief descriptor of an open document, for listing over MCP. */
export interface OpenGraphInfo {
  readonly guid: string;
  readonly kindId: string;
  readonly nodeCount: number;
  readonly edgeCount: number;
}

/** Registry of open graph documents keyed by GUID, plus the shared environment. */
export class GraphHost {
  readonly env: GraphEnvironment;
  private readonly docs = new Map<string, GraphDocument>();
  private activeGuid: string | null = null;

  constructor(env: GraphEnvironment) {
    this.env = env;
  }

  /** Register a document. The first opened becomes active. */
  open(doc: GraphDocument): void {
    this.docs.set(doc.guid, doc);
    this.activeGuid ??= doc.guid;
  }

  /** Remove a document; if it was active, another (if any) becomes active. */
  close(guid: string): void {
    this.docs.delete(guid);
    if (this.activeGuid === guid) this.activeGuid = this.docs.keys().next().value ?? null;
  }

  get(guid: string): GraphDocument | undefined {
    return this.docs.get(guid);
  }

  /** The active document, or `undefined` if none is open. */
  active(): GraphDocument | undefined {
    return this.activeGuid !== null ? this.docs.get(this.activeGuid) : undefined;
  }

  /** Resolve a document by GUID, defaulting to the active one when GUID is omitted. */
  resolve(guid?: string): GraphDocument | undefined {
    return guid !== undefined ? this.docs.get(guid) : this.active();
  }

  /** Make `guid` the active document; returns whether it is open. */
  setActive(guid: string): boolean {
    if (!this.docs.has(guid)) return false;
    this.activeGuid = guid;
    return true;
  }

  list(): OpenGraphInfo[] {
    return [...this.docs.values()].map((doc) => ({
      guid: doc.guid,
      kindId: doc.kindId,
      nodeCount: doc.nodeOrder.length,
      edgeCount: Object.keys(doc.edges).length,
    }));
  }
}
