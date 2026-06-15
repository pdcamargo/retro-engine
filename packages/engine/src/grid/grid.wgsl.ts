/**
 * WGSL for the editor grid pass.
 *
 * Registered with `ShaderRegistry` under `retro_engine::grid` at plugin build
 * time. The grid is drawn as a single camera-centered quad lying on a world
 * plane; the lines themselves are computed *analytically* in the fragment
 * stage from world-space coordinates rather than rasterized as geometry. This
 * is what lets it stay crisp at steep / grazing angles: each line's coverage
 * is anti-aliased against the screen-space derivative of the world position
 * (`fwidth`), so a line that compresses to sub-pixel width near the horizon
 * fades out smoothly instead of shimmering and moiréing.
 *
 * The pass serves both editor viewing modes from one Core3d node:
 *
 * - **XZ ground plane** (perspective 3D camera): the quad is sized to the
 *   grid's fade extent and a radial distance fade dissolves it toward the
 *   horizon — the case a 3D camera looks down onto.
 * - **XY work plane** (orthographic 2D camera): the quad is sized to the
 *   orthographic view extent (read from the projection matrix) so it always
 *   fills the viewport, with no distance fade — an orthographic camera has no
 *   horizon to fade toward.
 *
 * `plane` (a uniform flag) selects which world plane carries the grid;
 * orthographic vs. perspective is detected from the projection matrix. Either
 * way the quad is a real world-space plane transformed by `view_proj`, so
 * depth comes from rasterization for free and is consistent with the scene
 * depth buffer — scene geometry occludes the grid correctly with no manual
 * depth reconstruction. The grid pattern is anchored to absolute world
 * coordinates, so lines stay put as the camera moves; the quad merely
 * guarantees the visible area is covered.
 */
export const GRID_WGSL = /* wgsl */ `
#import retro_engine::view

struct GridUniform {
  minor_color: vec4<f32>,
  major_color: vec4<f32>,
  x_axis_color: vec4<f32>,
  z_axis_color: vec4<f32>,
  // x = cell size, y = cells per major division, z = plane constant, w = extent
  params0: vec4<f32>,
  // x = fade start, y = fade end (= extent), z = plane (0 = XZ, 1 = XY), w = unused
  params1: vec4<f32>,
};

@group(1) @binding(0) var<uniform> grid: GridUniform;

struct VsOut {
  @builtin(position) clip_position: vec4<f32>,
  // The two in-plane world coordinates (XZ → world x/z, XY → world x/y).
  @location(0) coord: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VsOut {
  // Two triangles (6 vertices) forming a quad on the grid plane, centered on
  // the camera's projection onto that plane and sized to cover the visible area.
  var corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
    vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(-1.0, 1.0),
  );
  let plane_const = grid.params0.z;
  let extent = grid.params0.w;
  let plane_xy = grid.params1.z > 0.5;
  // Orthographic projections have m[3][3] == 1; perspective has 0.
  let is_ortho = view.projection[3][3] > 0.5;
  // For an orthographic camera the visible world half-extent is 1 / proj[i][i];
  // for perspective there is no fixed extent, so fall back to the fade radius.
  let ortho_half = vec2<f32>(1.0 / view.projection[0][0], 1.0 / view.projection[1][1]);
  let size = select(vec2<f32>(extent, extent), abs(ortho_half), is_ortho);

  var center: vec2<f32>;
  if (plane_xy) {
    center = view.world_position.xy;
  } else {
    center = view.world_position.xz;
  }
  let coord = center + corners[vi] * size;

  var world_pos: vec3<f32>;
  if (plane_xy) {
    world_pos = vec3<f32>(coord.x, coord.y, plane_const);
  } else {
    world_pos = vec3<f32>(coord.x, plane_const, coord.y);
  }

  var out: VsOut;
  out.clip_position = view.view_proj * vec4<f32>(world_pos, 1.0);
  out.coord = coord;
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
  let plane_xy = grid.params1.z > 0.5;
  let is_ortho = view.projection[3][3] > 0.5;

  let coord = input.coord;
  let deriv = fwidth(coord);

  let minor = line_coverage(coord, cell);
  let major = line_coverage(coord, cell * major_every);
  // First colored axis runs where the second in-plane coordinate is 0 (XZ →
  // world X axis at z=0; XY → world X axis at y=0); the second axis is where
  // the first coordinate is 0 (XZ → Z axis, XY → Y axis, reusing its color).
  let h_axis = axis_coverage(coord.y, deriv.y);
  let v_axis = axis_coverage(coord.x, deriv.x);

  // Layer back-to-front: minor under major under the colored axes.
  var col = vec4<f32>(0.0);
  col = over(col, vec4<f32>(grid.minor_color.rgb, minor * grid.minor_color.a));
  col = over(col, vec4<f32>(grid.major_color.rgb, major * grid.major_color.a));
  col = over(col, vec4<f32>(grid.z_axis_color.rgb, v_axis * grid.z_axis_color.a));
  col = over(col, vec4<f32>(grid.x_axis_color.rgb, h_axis * grid.x_axis_color.a));

  // Radial distance fade dissolves a perspective ground grid toward the horizon
  // instead of ending on a hard edge. An orthographic view fills the screen
  // uniformly, so it keeps full opacity.
  if (!is_ortho) {
    var cam: vec2<f32>;
    if (plane_xy) {
      cam = view.world_position.xy;
    } else {
      cam = view.world_position.xz;
    }
    let dist = distance(coord, cam);
    col.a *= 1.0 - smoothstep(fade_start, fade_end, dist);
  }

  if (col.a <= 0.001) {
    discard;
  }
  return col;
}
` as const;
