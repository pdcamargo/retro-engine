// Bun's bundler serves these via the `file` loader; importing one yields the
// URL the dev server / built bundle serves it from.
declare module '*.gltf' {
  const url: string;
  export default url;
}
declare module '*.bin' {
  const url: string;
  export default url;
}
declare module '*.png' {
  const url: string;
  export default url;
}
