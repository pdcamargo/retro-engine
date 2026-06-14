/**
 * WGSL for the editor grid pass.
 *
 * Registered with `ShaderRegistry` under `retro_engine::grid` at plugin build
 * time. The grid is drawn as a single camera-centered quad lying on the ground
 * plane; the lines themselves are computed *analytically* in the fragment
 * stage from world-space coordinates rather than rasterized as geometry. This
 * is what lets it stay crisp at steep / grazing angles: each line's coverage
 * is anti-aliased against the screen-space derivative of the world position
 * (`fwidth`), so a line that compresses to sub-pixel width near the horizon
 * fades out smoothly instead of shimmering and moiréing.
 *
 * Geometry: the vertex stage emits a quad centered on the camera's ground
 * projection (read from the shared view uniform) and sized to the grid's fade
 * extent, so the visible area is always covered without an unbounded mesh.
 * Because it is a real plane transformed by `view_proj`, depth comes from
 * rasterization for free and is consistent with the scene depth buffer — scene
 * geometry occludes the grid correctly with no manual depth reconstruction.
 *
 * The grid pattern is anchored to absolute world coordinates (not to the quad),
 * so the lines stay put in the world as the camera moves.
 */
export const GRID_WGSL = /* wgsl */ `
#import retro_engine::view

struct GridUniform {
  minor_color: vec4<f32>,
  major_color: vec4<f32>,
  x_axis_color: vec4<f32>,
  z_axis_color: vec4<f32>,
  // x = cell size, y = cells per major division, z = plane height, w = extent
  params0: vec4<f32>,
  // x = fade start, y = fade end (= extent), z/w = unused
  params1: vec4<f32>,
};

@group(1) @binding(0) var<uniform> grid: GridUniform;

struct VsOut {
  @builtin(position) clip_position: vec4<f32>,
  @location(0) world_xz: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VsOut {
  // Two triangles (6 vertices) forming a quad on the ground plane, centered on
  // the camera's horizontal position and sized to the grid extent.
  var corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(-1.0, 1.0),
  );
  let extent = grid.params0.w;
  let plane_y = grid.params0.z;
  let center = view.world_position.xz;
  let world_xz = center + corners[vi] * extent;
  let world_pos = vec3<f32>(world_xz.x, plane_y, world_xz.y);

  var out: VsOut;
  out.clip_position = view.view_proj * vec4<f32>(world_pos, 1.0);
  out.world_xz = world_xz;
  return out;
}

// Anti-aliased coverage of the grid lines at a given cell spacing. Returns 1 on
// a line, 0 between lines, with a one-pixel-wide ramp computed from the
// screen-space derivative of the (scaled) world coordinate.
fn line_coverage(coord: vec2<f32>, cell: f32) -> f32 {
  let c = coord / cell;
  let dd = fwidth(c);
  let dist = abs(fract(c - 0.5) - 0.5) / max(dd, vec2<f32>(1e-8));
  let nearest = min(dist.x, dist.y);
  return 1.0 - min(nearest, 1.0);
}

// Anti-aliased coverage of a single world axis line at value == 0.
fn axis_coverage(value: f32, deriv: f32) -> f32 {
  return 1.0 - min(abs(value) / max(deriv, 1e-8), 1.0);
}

// Straight-alpha "source over destination" composite.
fn over(dst: vec4<f32>, src: vec4<f32>) -> vec4<f32> {
  let out_a = src.a + dst.a * (1.0 - src.a);
  if (out_a <= 1e-6) {
    return vec4<f32>(0.0);
  }
  let out_rgb = (src.rgb * src.a + dst.rgb * dst.a * (1.0 - src.a)) / out_a;
  return vec4<f32>(out_rgb, out_a);
}

@fragment
fn fs_main(input: VsOut) -> @location(0) vec4<f32> {
  let cell = grid.params0.x;
  let major_every = grid.params0.y;
  let fade_start = grid.params1.x;
  let fade_end = grid.params1.y;

  let coord = input.world_xz;
  let deriv = fwidth(coord);

  let minor = line_coverage(coord, cell);
  let major = line_coverage(coord, cell * major_every);
  // The X axis runs along world X, i.e. the line where z == 0; the Z axis is
  // the line where x == 0.
  let x_axis = axis_coverage(coord.y, deriv.y);
  let z_axis = axis_coverage(coord.x, deriv.x);

  // Layer back-to-front: minor under major under the colored axes.
  var col = vec4<f32>(0.0);
  col = over(col, vec4<f32>(grid.minor_color.rgb, minor * grid.minor_color.a));
  col = over(col, vec4<f32>(grid.major_color.rgb, major * grid.major_color.a));
  col = over(col, vec4<f32>(grid.z_axis_color.rgb, z_axis * grid.z_axis_color.a));
  col = over(col, vec4<f32>(grid.x_axis_color.rgb, x_axis * grid.x_axis_color.a));

  // Radial distance fade so the grid dissolves toward the horizon instead of
  // ending on a hard edge — the key to looking right at steep angles.
  let dist = distance(coord, view.world_position.xz);
  col.a *= 1.0 - smoothstep(fade_start, fade_end, dist);

  if (col.a <= 0.001) {
    discard;
  }
  return col;
}
` as const;
