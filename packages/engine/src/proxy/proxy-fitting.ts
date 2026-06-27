/**
 * One axis's scale reference from a `.mhclo` header (`x_scale v1 v2 den`): the
 * proxy's per-axis offset is scaled by `|base[v1] − base[v2]| / den` along that
 * axis, so a garment's standoff from the body grows and shrinks with the body's
 * proportions rather than staying a fixed distance.
 */
export interface ProxyAxisScale {
  readonly v1: number;
  readonly v2: number;
  readonly den: number;
}

/**
 * The fitting data binding a garment ("proxy") to a body base mesh, parsed from a
 * MakeHuman `.mhclo` file. Each proxy vertex is pinned to a base-mesh triangle by
 * barycentric weights plus a scaled offset, so the garment follows the body's
 * *shape* (not just its pose). Stored as flat parallel arrays, one entry per
 * proxy vertex, in proxy-mesh vertex order — so it pairs with the proxy `.obj`
 * loaded in the same order.
 *
 * The proxy's own geometry (vertices/faces/UVs) lives in the `.obj` named by
 * {@link objFile}; this carries only the binding.
 */
export interface ProxyFitting {
  readonly name?: string;
  /** Relative path to the proxy geometry `.obj`, from the `.mhclo` header. */
  readonly objFile?: string;
  /** Number of proxy vertices (length of the binding). */
  readonly count: number;
  /** Base-mesh triangle per proxy vertex: `count × 3` base vertex indices. */
  readonly triIndices: Uint32Array;
  /** Barycentric weights parallel to {@link triIndices}: `count × 3`. */
  readonly baryWeights: Float32Array;
  /** Per-vertex offset (pre-scale) parallel to {@link triIndices}: `count × 3`. */
  readonly offsets: Float32Array;
  /** Per-axis offset scale references, when the header declared them. */
  readonly scale?: { readonly x: ProxyAxisScale; readonly y: ProxyAxisScale; readonly z: ProxyAxisScale };
}

const axisScale = (parts: readonly string[]): ProxyAxisScale | undefined => {
  if (parts.length < 4) return undefined;
  const v1 = Number.parseInt(parts[1]!, 10);
  const v2 = Number.parseInt(parts[2]!, 10);
  const den = Number.parseFloat(parts[3]!);
  if (!Number.isInteger(v1) || !Number.isInteger(v2) || !Number.isFinite(den) || den === 0) return undefined;
  return { v1, v2, den };
};

/**
 * Parse a MakeHuman `.mhclo` proxy file into a {@link ProxyFitting}.
 *
 * Header lines (`name`, `obj_file`, `x_scale`/`y_scale`/`z_scale v1 v2 den`, …)
 * precede a `verts` marker; every line after it is one proxy vertex's binding:
 * either nine numbers (`v1 v2 v3 w1 w2 w3 dx dy dz` — a barycentric triangle
 * binding) or a single number (`v` — an exact bind to one base vertex, weight 1,
 * no offset). Blank and `#`-comment lines are skipped.
 *
 * @throws Error when a vertex line is neither 1 nor ≥9 fields, or carries a
 *   non-finite number — the binding is topology-locked data, so a malformed line
 *   is corruption, not something to skip.
 */
export const parseMhclo = (text: string): ProxyFitting => {
  let name: string | undefined;
  let objFile: string | undefined;
  let xScale: ProxyAxisScale | undefined;
  let yScale: ProxyAxisScale | undefined;
  let zScale: ProxyAxisScale | undefined;

  const tri: number[] = [];
  const bary: number[] = [];
  const offs: number[] = [];

  const lines = text.split('\n');
  let inVerts = false;
  for (let l = 0; l < lines.length; l++) {
    const line = lines[l]!.trim();
    if (line.length === 0 || line.startsWith('#')) continue;

    if (!inVerts) {
      const parts = line.split(/\s+/);
      const key = parts[0];
      if (key === 'verts') {
        inVerts = true;
        continue;
      }
      if (key === 'name') name = line.slice(line.indexOf(' ') + 1).trim();
      else if (key === 'obj_file') objFile = line.slice(line.indexOf(' ') + 1).trim();
      else if (key === 'x_scale') xScale = axisScale(parts);
      else if (key === 'y_scale') yScale = axisScale(parts);
      else if (key === 'z_scale') zScale = axisScale(parts);
      continue;
    }

    const parts = line.split(/\s+/);
    if (parts.length === 1) {
      const v = Number.parseInt(parts[0]!, 10);
      if (!Number.isInteger(v) || v < 0) {
        throw new Error(`parseMhclo: line ${l + 1}: exact binding has a bad vertex index "${parts[0]}"`);
      }
      tri.push(v, v, v);
      bary.push(1, 0, 0);
      offs.push(0, 0, 0);
      continue;
    }
    if (parts.length < 9) {
      throw new Error(`parseMhclo: line ${l + 1}: expected 1 or 9 fields, got ${parts.length}: "${line}"`);
    }
    const nums = parts.slice(0, 9).map((p) => Number(p));
    if (nums.some((n) => !Number.isFinite(n))) {
      throw new Error(`parseMhclo: line ${l + 1}: non-finite number in binding: "${line}"`);
    }
    tri.push(nums[0]!, nums[1]!, nums[2]!);
    bary.push(nums[3]!, nums[4]!, nums[5]!);
    offs.push(nums[6]!, nums[7]!, nums[8]!);
  }

  const fitting: ProxyFitting = {
    count: tri.length / 3,
    triIndices: Uint32Array.from(tri),
    baryWeights: Float32Array.from(bary),
    offsets: Float32Array.from(offs),
  };
  return {
    ...fitting,
    ...(name !== undefined ? { name } : {}),
    ...(objFile !== undefined ? { objFile } : {}),
    ...(xScale !== undefined && yScale !== undefined && zScale !== undefined
      ? { scale: { x: xScale, y: yScale, z: zScale } }
      : {}),
  };
};
