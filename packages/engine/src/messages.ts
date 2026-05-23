import type { ComponentType } from '@retro-engine/ecs';

import type { Param } from './system-param';

/**
 * One buffered message of type `T`: the user-supplied payload and the world
 * mutation tick at the moment of write. Consumers do not construct these —
 * the buffer is populated through {@link MessageWriter}.
 */
export interface MessageEntry<T> {
  readonly payload: T;
  readonly tick: number;
}

/**
 * The value handed to systems that take a {@link MessageWriter} param. Call
 * `.write(message)` to append a payload to the type's frame-buffered channel.
 *
 * Writes against a message type that was never registered via
 * {@link "@retro-engine/engine".App.addMessage} throw — explicit registration
 * surfaces "I forgot to wire my plugin's message types into the app" as an
 * error, not silent partial functionality.
 */
export interface MessageWriterHandle<T> {
  write(message: T): void;
}

const ctorName = (ctor: ComponentType): string => ctor.name || '<anonymous>';

/**
 * Per-app registry of message buffers, keyed by message class. Owned by
 * {@link "@retro-engine/engine".App}; surfaced through `App.addMessage`,
 * `MessageWriter`, and `MessageReader`. The {@link MessageRegistry.drainAll}
 * step is wired into `App.advanceFrame`'s end-of-frame phase, immediately
 * after the world's removed-buffer drain, so the per-frame visibility
 * contract holds: a message written in frame F is visible to readers running
 * in frame F (irrespective of stage ordering), and gone in frame F+1.
 *
 * @internal Engine-private; consumers go through `App.addMessage` and the
 * `MessageWriter` / `MessageReader` params.
 */
export class MessageRegistry {
  private readonly buffers = new Map<ComponentType, MessageEntry<unknown>[]>();

  /**
   * Register `ctor` as a known message type. Idempotent — registering twice
   * with the same constructor is a silent no-op (does not reset the buffer).
   */
  register(ctor: ComponentType): void {
    if (this.buffers.has(ctor)) return;
    this.buffers.set(ctor, []);
  }

  /** Whether `ctor` has been registered via {@link MessageRegistry.register}. */
  isRegistered(ctor: ComponentType): boolean {
    return this.buffers.has(ctor);
  }

  /**
   * Append a new entry for `ctor`. Throws if the type was never registered —
   * the explicit-registration discipline is enforced here, not at writer
   * resolve time, so a system that resolves a `MessageWriter` but never
   * calls `.write` does not error.
   */
  push(ctor: ComponentType, payload: unknown, tick: number): void {
    const bucket = this.buffers.get(ctor);
    if (!bucket) {
      throw new Error(
        `MessageWriter.write: message type '${ctorName(ctor)}' is not registered — call app.addMessage(${ctorName(ctor)}) before writing`,
      );
    }
    bucket.push({ payload, tick });
  }

  /**
   * Read the current entry buffer for `ctor` without draining. Returns an
   * empty array for unregistered types — readers are silent on missing
   * registration so a system can be wired up before its source plugin runs.
   */
  entriesOf(ctor: ComponentType): readonly MessageEntry<unknown>[] {
    return this.buffers.get(ctor) ?? [];
  }

  /**
   * Clear every registered type's entry buffer in place; the registration
   * set is preserved. Called by `App.advanceFrame` at frame boundary.
   */
  drainAll(): void {
    for (const bucket of this.buffers.values()) bucket.length = 0;
  }
}

const messageWriterCache = new WeakMap<object, Param<MessageWriterHandle<unknown>>>();
const messageReaderCache = new WeakMap<object, Param<Iterable<unknown>>>();

/**
 * Declares a system's intent to **write** frame-buffered messages of type
 * `T`. The resolved value is a {@link MessageWriterHandle} whose `.write(msg)`
 * appends a fresh entry to the type's per-frame buffer, stamped with a
 * strictly-increasing world tick.
 *
 * The message type must be registered via
 * {@link "@retro-engine/engine".App.addMessage} before any system writes to
 * it; writing against an unregistered type throws. Readers, by contrast, are
 * silent on missing registration — see {@link MessageReader}.
 *
 * Tokens are cached per constructor: `MessageWriter(Foo) === MessageWriter(Foo)`.
 *
 * @example
 * ```ts
 * class Death { constructor(readonly entity: Entity) {} }
 * app.addMessage(Death);
 * app.addSystem('update', [MessageWriter(Death), Query([Health], { changed: [Health] })], (writer, q) => {
 *   for (const [hp] of q) if (hp.value <= 0) writer.write(new Death(...));
 * });
 * ```
 */
export function MessageWriter<T extends object>(
  ctor: ComponentType<T>,
): Param<MessageWriterHandle<T>> {
  const cached = messageWriterCache.get(ctor);
  if (cached) return cached as Param<MessageWriterHandle<T>>;
  const param: Param<MessageWriterHandle<T>> = {
    resolve(ctx) {
      const registry = ctx.app.getMessageRegistry();
      const world = ctx.world;
      return {
        write(message: T): void {
          const tick = world.advanceTick();
          registry.push(ctor as ComponentType, message, tick);
        },
      };
    },
  };
  messageWriterCache.set(ctor, param as Param<MessageWriterHandle<unknown>>);
  return param;
}

/**
 * Declares a system's intent to **read** frame-buffered messages of type
 * `T`. The resolved value is a lazy {@link Iterable} over every payload
 * whose tick is strictly greater than the calling system's `lastSeenTick`
 * (i.e. "every message written since I last ran"). The per-system tick
 * snapshot is the same one `Changed<T>` / `Added<T>` filters and
 * `RemovedComponents` rely on; readers compose with the rest of the
 * change-detection surface for free.
 *
 * Reads against an unregistered message type yield nothing — silent, not
 * thrown, so a reader can be wired before its source plugin runs.
 *
 * Tokens are cached per constructor: `MessageReader(Foo) === MessageReader(Foo)`.
 *
 * **v1 lifetime.** Per-type buffers drain at frame boundary, after every
 * stage runs. A runIf-gated reader that did not run during frame F loses
 * frame F's messages — same hazard pattern that `RemovedComponents`
 * carries.
 *
 * @example
 * ```ts
 * app.addSystem('postUpdate', [MessageReader(Death)], (msgs) => {
 *   for (const death of msgs) console.log(`${death.entity} died`);
 * });
 * ```
 */
export function MessageReader<T extends object>(
  ctor: ComponentType<T>,
): Param<Iterable<T>> {
  const cached = messageReaderCache.get(ctor);
  if (cached) return cached as Param<Iterable<T>>;
  const param: Param<Iterable<T>> = {
    resolve(ctx) {
      const sinceTick = ctx.lastSeenTick;
      const registry = ctx.app.getMessageRegistry();
      const entries = registry.entriesOf(ctor as ComponentType);
      return {
        *[Symbol.iterator](): IterableIterator<T> {
          for (const e of entries) {
            if (e.tick > sinceTick) yield e.payload as T;
          }
        },
      };
    },
  };
  messageReaderCache.set(ctor, param as Param<Iterable<unknown>>);
  return param;
}
