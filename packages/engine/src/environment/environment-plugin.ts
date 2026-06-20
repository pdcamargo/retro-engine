import { asAssetIndex, makeHandle } from '@retro-engine/assets';
import { mat4 } from '@retro-engine/math';
import { t } from '@retro-engine/reflect';

import { ASSET_TYPE } from '../asset/asset-stores';
import { Camera } from '../camera/camera';
import { RenderImages } from '../image/image-plugin';
import type { Image } from '../image/image';
import type { App } from '../index';
import { ENVIRONMENT_PARAMS_FLOAT_COUNT, GpuLights } from '../light3d/gpu-lights';
import type { PluginObject } from '../plugin';
import { RenderSet } from '../render-set';
import { ShaderRegistry } from '../shader/shader-registry';
import { Extract, Query, ResMut } from '../system-param';

import { ActiveEnvironment } from './active-environment';
import { ensureEnvironmentCubeResources, resolveEnvironmentCubeView } from './environment-cube';
import { EnvironmentMapLight } from './environment-map-light';
import { EnvironmentPrefilter, RenderEnvironmentMaps } from './environment-prefilter';
import { ENVIRONMENT_PREFILTER_WGSL } from './environment.wgsl';

/**
 * Wires image-based lighting from an environment cubemap.
 *
 * Opt-in — add with `app.addPlugin(new EnvironmentMapPlugin())`. Requires
 * `Light3dPlugin` (it feeds the prefiltered maps into the shared `GpuLights`
 * `@group(2)` bind group, where they replace the flat ambient term) and the
 * image plugin (for the source cube upload).
 *
 * On `build`: registers the prefilter WGSL, the {@link EnvironmentMapLight}
 * component schema, the prefilter + cache + active-environment render resources,
 * and the extract + prepare systems. The prepare system bakes each source image
 * once (diffuse irradiance + specular mip chain; the BRDF LUT is baked globally
 * on first init), caches the result, and binds it into `GpuLights`.
 *
 * The derived prefilter maps are never serialized — only the authored
 * `EnvironmentMapLight.environmentMap` handle is.
 */
export class EnvironmentMapPlugin implements PluginObject {
  name(): string {
    return 'EnvironmentMapPlugin';
  }

  category(): 'engine' {
    return 'engine';
  }

  build(app: App): void {
    const registry = app.getResource(ShaderRegistry);
    if (registry === undefined) {
      throw new Error('EnvironmentMapPlugin: ShaderRegistry missing; ShaderPlugin must run before EnvironmentMapPlugin.');
    }
    registry.register('retro_engine::environment_prefilter', ENVIRONMENT_PREFILTER_WGSL);
    ensureEnvironmentCubeResources(app);

    app.registerComponent(
      EnvironmentMapLight,
      {
        environmentMap: t.handle<Image>(ASSET_TYPE.image),
        intensity: t.number,
        diffuseIntensity: t.number,
        specularIntensity: t.number,
        rotation: t.quat,
      },
      {
        name: 'EnvironmentMapLight',
        make: () => new EnvironmentMapLight({ environmentMap: makeHandle(asAssetIndex(0)) }),
      },
    );

    if (app.getResource(RenderEnvironmentMaps) === undefined) {
      app.insertResource(new RenderEnvironmentMaps());
    }
    if (app.getResource(EnvironmentPrefilter) === undefined) {
      app.insertResource(new EnvironmentPrefilter());
    }
    if (app.getResource(ActiveEnvironment) === undefined) {
      app.insertResource(new ActiveEnvironment());
    }

    app.addSystem(
      'render',
      [Extract(Query([Camera, EnvironmentMapLight])), ResMut(ActiveEnvironment)],
      (q, active) => {
        active.handle = undefined;
        for (const [, camera, env] of q.entries()) {
          if (!camera.isActive) continue;
          active.handle = env.environmentMap;
          active.intensity = env.intensity;
          active.diffuseIntensity = env.diffuseIntensity;
          active.specularIntensity = env.specularIntensity;
          mat4.fromQuat(env.rotation, active.rotation);
          break; // global environment: first active camera wins
        }
      },
      { set: RenderSet.Extract, label: 'environment-extract' },
    );

    const scratch = new Float32Array(ENVIRONMENT_PARAMS_FLOAT_COUNT);
    const writeOff = (gpuLights: GpuLights): void => {
      scratch.fill(0);
      scratch[4] = 1; // identity rotation diagonal
      scratch[9] = 1;
      scratch[14] = 1;
      scratch[19] = 1;
      gpuLights.writeEnvironmentParams(app.renderer, scratch);
      gpuLights.setEnvironmentTextures(app.renderer, undefined, undefined, undefined);
    };

    app.addSystem(
      'render',
      [
        ResMut(ActiveEnvironment),
        ResMut(RenderEnvironmentMaps),
        ResMut(EnvironmentPrefilter),
        ResMut(RenderImages),
        ResMut(GpuLights),
      ],
      (active, cache, prefilter, renderImages, gpuLights) => {
        if (!gpuLights.ensureInitialised(app.renderer)) return;

        const handle = active.handle;
        if (handle === undefined) {
          writeOff(gpuLights);
          return;
        }
        const renderImage = renderImages.get(handle);
        if (renderImage === undefined || !prefilter.ensureInitialised(app)) {
          writeOff(gpuLights);
          return;
        }

        // Cube sources prefilter directly; an equirectangular (e.g. `.hdr`)
        // source is converted to a cube first (shared with the skybox).
        const cube = resolveEnvironmentCubeView(app, handle, renderImage);
        if (cube === undefined) {
          writeOff(gpuLights);
          return;
        }

        let baked = cache.get(handle.index);
        if (baked === undefined) {
          baked = prefilter.bakeEnvironment(app, cube.view);
          cache.set(handle.index, baked);
        }

        scratch[0] = 1; // has-environment
        scratch[1] = active.diffuseIntensity * active.intensity;
        scratch[2] = active.specularIntensity * active.intensity;
        scratch[3] = baked.maxMip;
        scratch.set(active.rotation as Float32Array, 4);
        gpuLights.writeEnvironmentParams(app.renderer, scratch);
        gpuLights.setEnvironmentTextures(
          app.renderer,
          baked.irradianceView,
          baked.specularView,
          prefilter.brdfLutView,
        );
      },
      { set: RenderSet.Prepare, label: 'environment-prepare' },
    );
  }
}
