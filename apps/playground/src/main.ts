import { App } from '@retro-engine/engine';
import { createWebGPURenderer } from '@retro-engine/renderer-webgpu';

import { aoShowcasePlugin } from './ao-showcase-plugin';
import { assetShowcasePlugin } from './asset-showcase-plugin';
import { atlasShowcasePlugin } from './atlas-showcase-plugin';
import { gltfShowcasePlugin } from './gltf-showcase-plugin';
import { lightsShowcasePlugin } from './lights-showcase-plugin';
import { litShowcasePlugin } from './lit-showcase-plugin';
import { LoggingPlugin } from './logging-plugin';
import { materialShowcasePlugin } from './material-showcase-plugin';
import { motionVectorsShowcasePlugin } from './motion-vectors-showcase-plugin';
import { primitivesShowcasePlugin } from './primitives-showcase-plugin';
import { shapesShowcasePlugin } from './shapes-showcase-plugin';
import { sliceShowcasePlugin } from './slice-showcase-plugin';
import { spriteShowcasePlugin } from './sprite-showcase-plugin';
import { stressShowcasePlugin } from './stress-showcase-plugin';
import { taaShowcasePlugin } from './taa-showcase-plugin';

const canvas = document.getElementById('playground-canvas');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('playground: #playground-canvas missing or not a <canvas>');
}

// Mode switch:
//   `?mode=slice`   → Phase 8.5 9-slice sprite showcase (ADR-0034).
//   `?mode=atlas`   → Phase 8.2 texture-atlas showcase (ADR-0032).
//   `?mode=sprites` → Phase 8.1 sprite pipeline showcase (ADR-0031).
//   `?mode=shapes`  → Phase 8.7 Material2d showcase (ADR-0035).
//   `?mode=stress`  → mixed-load FPS harness (size=small|medium|large).
//   `?mode=lights`  → Phase 9 2D lighting showcase: point/spot/ambient lights,
//                     composite modes, shadow occluders, and (with `&normals=1`)
//                     normal-mapped lighting (ADR-0037/0041/0042/0043).
//   `?mode=lit`     → Phase 10 3D lighting showcase: a metallic×roughness PBR
//                     sphere grid under sun/point/spot/ambient lights (ADR-0044).
//   `?mode=material`→ StandardMaterial normalScale + doubleSided check: a
//                     normal-mapped plane row at scale 0/1/2 and a spinning
//                     single-sided vs double-sided plane pair (ADR-0058).
//   `?mode=motion-vectors` → Phase 12.8/12.10 device check: moving PBR meshes
//                     under Depth + Normal + MotionVector prepass
//                     (ADR-0050/0051). Add `&debug=motion` to blit the motion
//                     target (|velocity|) to screen, or `&blur=1` to see the
//                     Phase 12.10 MotionBlur effect (HDR camera streaks).
//   `?mode=taa`     → Phase 12.6 device check: temporal anti-aliasing on a
//                     high-contrast scene (HDR camera + Depth + MotionVector
//                     prepass). Press T to toggle TAA for an aliased/resolved
//                     A/B (ADR-0053).
//   `?mode=ao`      → Phase 12 device check: screen-space ambient occlusion
//                     (GTAO) on a scene of contacts + a concave corner (Depth +
//                     Normal prepass). Press O to toggle AO; add `&taa=1` to
//                     check AO stays stable under jitter (ADR-0054).
//   `?mode=gltf`    → glTF mapping check: fetches a real model, maps it with
//                     mapGltfAssets, and spawns the primitives (throwaway manual
//                     harness ahead of the GltfPlugin importer).
//   `?mode=assets`  → unified asset store device check (ADR-0055): a pulsing
//                     cube (materials.getMut), a breathing sphere
//                     (meshes.getMut), and a row of cubes spawned from runtime
//                     meshes.add / materials.add.
//   anything else   → Phase 7.5 primitives demo.
// All demos stay discoverable from one bundle.
const mode = new URLSearchParams(window.location.search).get('mode');
const showcase =
  mode === 'slice'
    ? sliceShowcasePlugin
    : mode === 'atlas'
      ? atlasShowcasePlugin
      : mode === 'sprites'
        ? spriteShowcasePlugin
        : mode === 'shapes'
          ? shapesShowcasePlugin
          : mode === 'stress'
            ? stressShowcasePlugin
            : mode === 'lights'
              ? lightsShowcasePlugin
              : mode === 'lit'
                ? litShowcasePlugin
                : mode === 'material'
                ? materialShowcasePlugin
                : mode === 'motion-vectors'
                  ? motionVectorsShowcasePlugin
                  : mode === 'taa'
                    ? taaShowcasePlugin
                    : mode === 'ao'
                      ? aoShowcasePlugin
                      : mode === 'assets'
                        ? assetShowcasePlugin
                        : mode === 'gltf'
                          ? gltfShowcasePlugin
                          : primitivesShowcasePlugin;

const renderer = createWebGPURenderer(canvas);
const app = new App({
  renderer,
  canvas,
  clearColor: { r: 0.08, g: 0.09, b: 0.12, a: 1 },
});
app.addPlugin(new LoggingPlugin());
app.addPlugin(showcase);

app.run().catch((err: unknown) => {
  console.error('[playground] failed to run', err);
});
