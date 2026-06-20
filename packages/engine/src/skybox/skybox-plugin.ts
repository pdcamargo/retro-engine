import { asAssetIndex, makeHandle } from '@retro-engine/assets';
import type { Entity } from '@retro-engine/ecs';
import { mat4 } from '@retro-engine/math';
import type { Mat4 } from '@retro-engine/math';
import { t } from '@retro-engine/reflect';

import { ASSET_TYPE } from '../asset/asset-stores';
import { Camera } from '../camera/camera';
import { ensureEnvironmentCubeResources } from '../environment/environment-cube';
import type { Image } from '../image/image';
import type { App } from '../index';
import type { PluginObject } from '../plugin';
import { Core3dLabel } from '../render-graph/core-3d';
import { OpaquePass3dLabel } from '../render-graph/opaque-pass-3d-node';
import { RenderGraph } from '../render-graph/render-graph';
import { TransparentPass3dLabel } from '../render-graph/transparent-pass-3d-node';
import { RenderSet } from '../render-set';
import { ShaderRegistry } from '../shader/shader-registry';
import { Extract, Query, Res, ResMut } from '../system-param';

import { Skybox } from './skybox';
import { makeSkyboxNode, SkyboxPass3dLabel } from './skybox-node';
import { SkyboxPipeline } from './skybox-pipeline';
import { SKYBOX_WGSL } from './skybox.wgsl';
import { ViewSkybox } from './view-skybox';

/**
 * Wires the per-camera {@link Skybox} background pass.
 *
 * Opt-in — not auto-installed, so a game without a sky pays nothing. Add it
 * with `app.addPlugin(new SkyboxPlugin())`. Requires a 3D camera path and the
 * image plugin (for the environment cube upload), both present in the default
 * engine setup.
 *
 * On `build`: registers the default `retro_engine::skybox` WGSL module (unless
 * a custom module name is supplied), registers the {@link Skybox} component's
 * reflection schema, inserts the {@link SkyboxPipeline} and {@link ViewSkybox}
 * render-world resources, and adds the extract + prepare systems.
 *
 * On `finish`: inserts the skybox pass into `Core3d` between the opaque and
 * transparent passes, so the sky fills the gaps opaque geometry left and
 * transparent geometry composites over it.
 *
 * **Custom skies.** Pass `{ shaderModule }` naming a WGSL module you registered
 * with the {@link ShaderRegistry} to replace the look (gradient, stars,
 * procedural) without forking. The module must keep the `@group(0)` view
 * binding, the `@group(1)` layout (uniform + cube texture + sampler), and the
 * `vs_main` / `fs_main` entry points (see {@link SKYBOX_WGSL}).
 */
export class SkyboxPlugin implements PluginObject {
  private readonly shaderModule: string;

  constructor(options: { shaderModule?: string } = {}) {
    this.shaderModule = options.shaderModule ?? 'retro_engine::skybox';
  }

  name(): string {
    return 'SkyboxPlugin';
  }

  category(): 'engine' {
    return 'engine';
  }

  build(app: App): void {
    const registry = app.getResource(ShaderRegistry);
    if (registry === undefined) {
      throw new Error('SkyboxPlugin: ShaderRegistry resource missing; ShaderPlugin must run before SkyboxPlugin.');
    }
    // Register the engine default. A custom module name is the caller's to
    // register before build(); re-registering the default here is idempotent.
    if (this.shaderModule === 'retro_engine::skybox') {
      registry.register('retro_engine::skybox', SKYBOX_WGSL);
    } else if (!registry.has(this.shaderModule)) {
      throw new Error(
        `SkyboxPlugin: custom shader module '${this.shaderModule}' is not registered; register it before adding the plugin.`,
      );
    }

    // Shared equirect→cube conversion, so an equirectangular `.hdr` works as a
    // skybox source even without the environment plugin present.
    ensureEnvironmentCubeResources(app);

    // `make` supplies a placeholder handle the decoder overwrites — the image
    // handle is required at author time, so the constructor has no sensible
    // zero-arg default of its own.
    app.registerComponent(
      Skybox,
      {
        image: t.handle<Image>(ASSET_TYPE.image),
        brightness: t.number,
        rotation: t.quat,
      },
      { name: 'Skybox', make: () => new Skybox({ image: makeHandle(asAssetIndex(0)) }) },
    );

    if (app.getResource(SkyboxPipeline) === undefined) {
      const pipeline = new SkyboxPipeline();
      pipeline.shaderModuleName = this.shaderModule;
      app.insertResource(pipeline);
    }
    if (app.getResource(ViewSkybox) === undefined) {
      app.insertResource(new ViewSkybox());
    }

    app.addSystem(
      'render',
      [Extract(Query([Camera, Skybox])), ResMut(ViewSkybox)],
      (q, viewSky) => {
        viewSky.byCamera.clear();
        for (const [entity, camera, skybox] of q.entries()) {
          if (!camera.isActive) continue;
          viewSky.byCamera.set(entity, {
            image: skybox.image,
            brightness: skybox.brightness,
            rotation: mat4.fromQuat(skybox.rotation),
          });
        }
      },
      { set: RenderSet.Extract, label: 'skybox-extract' },
    );

    app.addSystem(
      'render',
      [Res(ViewSkybox), ResMut(SkyboxPipeline)],
      (viewSky, pipeline) => {
        for (const [entity, params] of viewSky.byCamera) {
          pipeline.writeCameraUniform(
            app,
            entity as Entity,
            params.rotation as Mat4,
            params.brightness,
          );
        }
      },
      { set: RenderSet.Prepare, label: 'skybox-prepare' },
    );
  }

  finish(app: App): void {
    const graph = app.getResource(RenderGraph);
    if (graph === undefined) {
      throw new Error('SkyboxPlugin: RenderGraph resource missing at finish(); RenderGraphPlugin must build before SkyboxPlugin.');
    }
    const sub3d = graph.getSubGraph(Core3dLabel);
    if (sub3d === undefined) return;
    sub3d.addNode(makeSkyboxNode());
    sub3d.addEdge(OpaquePass3dLabel, SkyboxPass3dLabel);
    sub3d.addEdge(SkyboxPass3dLabel, TransparentPass3dLabel);
  }
}
