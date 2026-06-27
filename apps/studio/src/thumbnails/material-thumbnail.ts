/**
 * Authored fields a material preview cares about, read straight from a `.remat`
 * file's `material.data`. Every field is optional — a material that omits one
 * (e.g. `UnlitMaterial` has no `metallic`) falls back to a sensible default.
 */
interface PreviewParams {
  readonly baseColor: readonly [number, number, number];
  readonly metallic: number;
  readonly roughness: number;
  readonly emissive: readonly [number, number, number];
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Pull the preview-relevant scalars out of a parsed `.remat` `material.data`. */
const paramsFromData = (data: Record<string, unknown>): PreviewParams => {
  const rgb = (v: unknown, fallback: readonly [number, number, number]): [number, number, number] =>
    Array.isArray(v) && v.length >= 3
      ? [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0]
      : [fallback[0], fallback[1], fallback[2]];
  const num = (v: unknown, fallback: number): number => (typeof v === 'number' ? v : fallback);
  // StandardMaterial uses `baseColor`; UnlitMaterial uses `color`.
  const base = 'baseColor' in data ? data.baseColor : data.color;
  return {
    baseColor: rgb(base, [0.8, 0.8, 0.8]),
    metallic: clamp01(num(data.metallic, 0)),
    roughness: clamp01(num(data.roughness, 0.5)),
    emissive: rgb(data.emissive, [0, 0, 0]),
  };
};

const LIGHT = ((): readonly [number, number, number] => {
  const v: [number, number, number] = [0.4, 0.6, 0.7];
  const m = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / m, v[1] / m, v[2] / m];
})();

/** A cheap vertical sky gradient sampled by a reflected ray's `y`, for fake env reflection. */
const sky = (y: number): [number, number, number] => {
  const t = clamp01(y * 0.5 + 0.5);
  // horizon (warm grey) → zenith (cool light) → ground (dark).
  const r = 0.18 + 0.55 * t;
  const g = 0.2 + 0.58 * t;
  const b = 0.24 + 0.66 * t;
  return [r, g, b];
};

/**
 * Render a material to a flat-shaded `size`×`size` RGBA8 sphere preview on the
 * CPU — analogous to {@link renderMeshThumbnail}, but the subject is a fixed
 * sphere and the shading is a lightweight analytic PBR approximation (Lambert
 * diffuse, Blinn-Phong specular whose tightness tracks roughness, a Fresnel rim,
 * and a faked environment reflection that dominates for metals). Self-contained,
 * no GPU pass: it produces the same buffer shape as image/mesh thumbnails. A true
 * GPU PBR + IBL render is the eventual quality upgrade.
 *
 * `bytes` is the raw `.remat` file; only `baseColor`/`color`, `metallic`,
 * `roughness`, and `emissive` are read, so it previews any material type.
 */
/** A decoded base-color texture to sample onto the preview sphere (sRGB RGBA8). */
export interface PreviewTexture {
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
}

/** sRGB byte → linear [0,1], so a sampled texel shades in the same space as the base-color factor. */
const srgbToLinear = (byte: number): number => {
  const c = byte / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const clampIdx = (x: number, max: number): number => (x < 0 ? 0 : x > max ? max : x);

/**
 * Render a material preview sphere. When `texture` is given (the material's
 * base-color map), it is sampled per pixel via a spherical UV from the surface
 * normal and modulates the base color — so a textured material shows a textured
 * ball, not the flat texture nor a flat-coloured sphere.
 */
export const renderMaterialThumbnail = (bytes: Uint8Array, size: number, texture?: PreviewTexture): Uint8Array => {
  const file = JSON.parse(new TextDecoder().decode(bytes)) as {
    material?: { data?: Record<string, unknown> };
  };
  const p = paramsFromData(file.material?.data ?? {});

  const f0r = 0.04 + (p.baseColor[0] - 0.04) * p.metallic;
  const f0g = 0.04 + (p.baseColor[1] - 0.04) * p.metallic;
  const f0b = 0.04 + (p.baseColor[2] - 0.04) * p.metallic;
  const kd = 1 - p.metallic;
  const a = Math.max(0.025, p.roughness * p.roughness);
  const specExp = Math.max(1, 2 / (a * a) - 2); // GGX-ish Blinn-Phong exponent
  const specNorm = (specExp + 8) / 25; // keep peak highlight bounded

  const out = new Uint8ClampedArray(size * size * 4);
  const half = size / 2;
  const r = size * 0.44; // sphere radius in pixels

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const i = (py * size + px) * 4;
      // Pixel → sphere local coords; y up.
      const u = (px + 0.5 - half) / r;
      const v = (half - (py + 0.5)) / r;
      const d2 = u * u + v * v;

      if (d2 > 1) {
        // Background: soft dark radial vignette, matching the mesh thumb mood.
        const fall = clamp01((d2 - 1) * 0.6);
        const bg = 26 - fall * 10;
        out[i] = bg;
        out[i + 1] = bg + 4;
        out[i + 2] = bg + 3;
        out[i + 3] = 255;
        continue;
      }

      const nz = Math.sqrt(1 - d2);
      // Normal = (u, v, nz), already unit length.

      // Base-color albedo: the base factor, modulated by the texture sampled at a
      // spherical UV of the surface normal (longitude from x/z, latitude from y).
      let albedoR = p.baseColor[0];
      let albedoG = p.baseColor[1];
      let albedoB = p.baseColor[2];
      if (texture !== undefined) {
        const texU = Math.atan2(u, nz) / (2 * Math.PI) + 0.5;
        const texV = Math.acos(v < -1 ? -1 : v > 1 ? 1 : v) / Math.PI;
        const tx = clampIdx(Math.floor(texU * texture.width), texture.width - 1);
        const ty = clampIdx(Math.floor(texV * texture.height), texture.height - 1);
        const ti = (ty * texture.width + tx) * 4;
        albedoR *= srgbToLinear(texture.data[ti] ?? 255);
        albedoG *= srgbToLinear(texture.data[ti + 1] ?? 255);
        albedoB *= srgbToLinear(texture.data[ti + 2] ?? 255);
      }

      const nDotV = nz; // view dir = (0,0,1)
      const nDotL = Math.max(0, u * LIGHT[0] + v * LIGHT[1] + nz * LIGHT[2]);

      // Half vector H = normalize(L + V).
      const hx = LIGHT[0];
      const hy = LIGHT[1];
      const hz = LIGHT[2] + 1;
      const hl = Math.hypot(hx, hy, hz) || 1;
      const nDotH = Math.max(0, (u * hx + v * hy + nz * hz) / hl);

      const fres = (f0: number): number => f0 + (1 - f0) * (1 - nDotV) ** 5;
      const spec = specNorm * nDotH ** specExp * nDotL;

      // Env reflection: reflect view (0,0,1) about N → r = 2*nz*N - V; only the
      // reflected ray's y is needed to sample the vertical sky gradient.
      const ry = 2 * nz * v;
      const env = sky(ry);
      const envStrength = (0.2 + 0.8 * p.metallic) * (1 - p.roughness * 0.65);

      const shade = (base: number, f0: number, em: number, envC: number): number => {
        const ambient = base * 0.12 * kd;
        const diffuse = base * nDotL * kd;
        const f = fres(f0);
        const specular = f * spec;
        const reflection = f0 * envC * envStrength;
        let c = ambient + diffuse + specular + reflection + em;
        c = c / (c + 1); // Reinhard tonemap
        return c ** (1 / 2.2) * 255; // gamma
      };

      out[i] = shade(albedoR, f0r, p.emissive[0], env[0]);
      out[i + 1] = shade(albedoG, f0g, p.emissive[1], env[1]);
      out[i + 2] = shade(albedoB, f0b, p.emissive[2], env[2]);
      out[i + 3] = 255;
    }
  }

  return new Uint8Array(out.buffer);
};
