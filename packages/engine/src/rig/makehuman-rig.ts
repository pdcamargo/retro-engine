import type { Vec3 } from '@retro-engine/math';
import { vec3 } from '@retro-engine/math';

/** One bone of a MakeHuman rig: its rest head/tail positions and parent name. */
export interface RigBone {
  readonly name: string;
  /** Rest-pose joint origin (the bone's pivot), in base-mesh space. */
  readonly head: Vec3;
  /** Rest-pose bone tip; with {@link head} it gives the bone's rest direction/length. */
  readonly tail: Vec3;
  /** Parent bone name, or `null` for a root. */
  readonly parent: string | null;
}

/**
 * A parsed MakeHuman rig: bones ordered parents-before-children, so a bone's
 * index in this list is a stable joint index a skeleton + skin weights address,
 * and the hierarchy can be built in one pass.
 */
export interface MakeHumanRig {
  readonly bones: readonly RigBone[];
  /** Bone name → index in {@link bones}. */
  readonly indexOf: ReadonlyMap<string, number>;
}

const toVec3 = (a: unknown): Vec3 => {
  const arr = Array.isArray(a) ? a : [0, 0, 0];
  return vec3.create(Number(arr[0]) || 0, Number(arr[1]) || 0, Number(arr[2]) || 0);
};

/**
 * Parse a MakeHuman `rig.<name>.json` into a {@link MakeHumanRig}. The document's
 * top-level keys are bone names; each bone carries `head`/`tail` (`default_position`)
 * and a `parent` (`""` for a root). Bones are returned topologically (every bone
 * after its parent) so joint entities + inverse binds build in order.
 *
 * @throws Error when the JSON is not an object or a bone cites a parent absent
 *   from the document (a broken hierarchy, not something to silently reroot).
 */
export const parseMakeHumanRig = (text: string): MakeHumanRig => {
  const doc = JSON.parse(text) as Record<string, unknown>;
  if (doc === null || typeof doc !== 'object') throw new Error('parseMakeHumanRig: document is not an object');

  const raw: RigBone[] = [];
  for (const [name, value] of Object.entries(doc)) {
    if (value === null || typeof value !== 'object') continue;
    const b = value as Record<string, unknown>;
    if (b.head === undefined || b.tail === undefined) continue; // metadata key
    const head = (b.head as Record<string, unknown>).default_position;
    const tail = (b.tail as Record<string, unknown>).default_position;
    const parentRaw = typeof b.parent === 'string' ? b.parent : '';
    raw.push({ name, head: toVec3(head), tail: toVec3(tail), parent: parentRaw === '' ? null : parentRaw });
  }

  const names = new Set(raw.map((b) => b.name));
  for (const b of raw) {
    if (b.parent !== null && !names.has(b.parent)) {
      throw new Error(`parseMakeHumanRig: bone '${b.name}' has unknown parent '${b.parent}'`);
    }
  }

  // Topological order: emit a bone once its parent has been emitted.
  const ordered: RigBone[] = [];
  const emitted = new Set<string>();
  while (ordered.length < raw.length) {
    const before = ordered.length;
    for (const b of raw) {
      if (emitted.has(b.name)) continue;
      if (b.parent === null || emitted.has(b.parent)) {
        ordered.push(b);
        emitted.add(b.name);
      }
    }
    if (ordered.length === before) {
      // A cycle (shouldn't happen for a valid rig) — emit the rest as-is to avoid hanging.
      for (const b of raw) if (!emitted.has(b.name)) ordered.push(b);
      break;
    }
  }

  const indexOf = new Map<string, number>();
  ordered.forEach((b, i) => indexOf.set(b.name, i));
  return { bones: ordered, indexOf };
};
