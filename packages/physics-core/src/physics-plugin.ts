import type { Entity } from '@retro-engine/ecs';
import type { App, PluginObject } from '@retro-engine/engine';
import { MessageWriter, Query, RemovedComponents, Res, Time, Transform } from '@retro-engine/engine';
import { vec2, vec3 } from '@retro-engine/math';
import { t } from '@retro-engine/reflect';

import type { PhysicsBackend } from './backend';
import { CollisionEvent } from './backend';
import {
  AngularVelocity2d,
  CharacterController2d,
  Collider2d,
  ExternalForce2d,
  LinearVelocity2d,
  RigidBody2d,
} from './components-2d';
import {
  AngularVelocity3d,
  CharacterController3d,
  Collider3d,
  ExternalForce3d,
  LinearVelocity3d,
  RigidBody3d,
} from './components-3d';
import { Friction, GravityScale, Restitution, Sensor } from './material';
import { Gravity } from './gravity';
import { NullPhysicsBackend } from './null-backend';
import { Physics } from './physics';
import { applyReadback2d, applyReadback3d, snapshot2d, snapshot3d } from './bridge';

const BODY_TYPE = ['dynamic', 'kinematic', 'static'] as const;

/** Options for {@link PhysicsPlugin}. */
export interface PhysicsPluginOptions {
  /**
   * The solver to run. Defaults to a {@link NullPhysicsBackend} (nothing
   * simulates) — inject `@retro-engine/physics-rapier`'s backend for real
   * dynamics. The backend's `init()` is kicked off at build time; the bridge
   * skips stepping until it reports `ready()`.
   */
  readonly backend?: PhysicsBackend;
}

/**
 * Registers the physics components (reflection) and runs the Sync → Step →
 * Writeback bridge in the fixed timestep against the injected backend. Add it to
 * an `App`; author bodies with `RigidBody2d`/`3d` + `Collider2d`/`3d` on entities
 * that have a `Transform`.
 *
 * Opt-in (not part of `CorePlugin`) and headless-safe — with the default null
 * backend nothing moves, which is what tests and component-only worlds want.
 */
export class PhysicsPlugin implements PluginObject {
  private readonly backend: PhysicsBackend;

  constructor(options: PhysicsPluginOptions = {}) {
    this.backend = options.backend ?? new NullPhysicsBackend();
  }

  name(): string {
    return 'PhysicsPlugin';
  }

  build(app: App): void {
    void this.backend.init();
    if (app.getResource(Gravity) === undefined) app.insertResource(new Gravity());
    app.insertResource(new Physics(this.backend));
    app.messageRegistry.register(CollisionEvent);

    this.registerComponents(app);

    const backend = this.backend;
    app.addSystem(
      'fixedUpdate',
      [
        Res(Gravity),
        Res(Time),
        Query([Transform, RigidBody2d, Collider2d]),
        Query([Transform, RigidBody3d, Collider3d]),
        RemovedComponents(RigidBody2d),
        RemovedComponents(RigidBody3d),
        MessageWriter(CollisionEvent),
        Query([CharacterController2d]),
        Query([CharacterController3d]),
      ],
      (gravity, time, bodies2d, bodies3d, removed2d, removed3d, collisions, chars2d, chars3d) => {
        if (!backend.ready()) return;
        backend.setGravity('2d', [gravity.gravity2d[0] ?? 0, gravity.gravity2d[1] ?? 0]);
        backend.setGravity('3d', [
          gravity.gravity3d[0] ?? 0,
          gravity.gravity3d[1] ?? 0,
          gravity.gravity3d[2] ?? 0,
        ]);

        // Sync: authored components → backend bodies.
        for (const [entity, transform, body, collider] of bodies2d.entries()) {
          const angular = app.world.getComponent(entity, AngularVelocity2d);
          backend.upsertBody(
            entity,
            snapshot2d(
              body,
              collider,
              transform,
              app.world.getComponent(entity, Sensor) !== undefined,
              app.world.getComponent(entity, LinearVelocity2d),
              angular?.value ?? 0,
              app.world.getComponent(entity, ExternalForce2d)?.value,
              this.materialOf(app, entity),
            ),
          );
        }
        for (const [entity, transform, body, collider] of bodies3d.entries()) {
          backend.upsertBody(
            entity,
            snapshot3d(
              body,
              collider,
              transform,
              app.world.getComponent(entity, Sensor) !== undefined,
              app.world.getComponent(entity, LinearVelocity3d),
              app.world.getComponent(entity, AngularVelocity3d),
              app.world.getComponent(entity, ExternalForce3d)?.value,
              this.materialOf(app, entity),
            ),
          );
        }
        for (const entity of removed2d) backend.removeBody(entity);
        for (const entity of removed3d) backend.removeBody(entity);

        // Character controllers: move by the collision-corrected amount (after
        // the bodies are synced, before the step). Overrides the kinematic body's
        // next translation set during sync.
        for (const [entity, cc] of chars2d.entries()) {
          const result = backend.moveCharacter(
            entity,
            {
              dimension: '2d',
              offset: cc.offset,
              up: [cc.up[0] ?? 0, cc.up[1] ?? 1],
              maxSlopeClimbAngle: cc.maxSlopeClimbAngle,
              minSlopeSlideAngle: cc.minSlopeSlideAngle,
              autostepHeight: cc.autostepHeight,
              autostepMinWidth: cc.autostepMinWidth,
              snapToGroundDistance: cc.snapToGroundDistance,
            },
            [cc.desiredTranslation[0] ?? 0, cc.desiredTranslation[1] ?? 0],
          );
          if (result !== null) cc.grounded = result.grounded;
          vec2.set(0, 0, cc.desiredTranslation);
        }
        for (const [entity, cc] of chars3d.entries()) {
          const result = backend.moveCharacter(
            entity,
            {
              dimension: '3d',
              offset: cc.offset,
              up: [cc.up[0] ?? 0, cc.up[1] ?? 1, cc.up[2] ?? 0],
              maxSlopeClimbAngle: cc.maxSlopeClimbAngle,
              minSlopeSlideAngle: cc.minSlopeSlideAngle,
              autostepHeight: cc.autostepHeight,
              autostepMinWidth: cc.autostepMinWidth,
              snapToGroundDistance: cc.snapToGroundDistance,
            },
            [cc.desiredTranslation[0] ?? 0, cc.desiredTranslation[1] ?? 0, cc.desiredTranslation[2] ?? 0],
          );
          if (result !== null) cc.grounded = result.grounded;
          vec3.set(0, 0, 0, cc.desiredTranslation);
        }

        // Step.
        backend.step(time.fixed.delta);

        // Surface this step's collision start/stop events to ECS.
        for (const event of backend.drainCollisionEvents()) collisions.write(event);

        // Writeback: simulated state → authored components.
        for (const [entity, transform] of bodies2d.entries()) {
          const readback = backend.readBody(entity);
          if (readback !== undefined) {
            applyReadback2d(readback, transform, app.world.getComponent(entity, LinearVelocity2d));
          }
        }
        for (const [entity, transform] of bodies3d.entries()) {
          const readback = backend.readBody(entity);
          if (readback !== undefined) {
            applyReadback3d(
              readback,
              transform,
              app.world.getComponent(entity, LinearVelocity3d),
              app.world.getComponent(entity, AngularVelocity3d),
            );
          }
        }
      },
      { name: 'physics-step' },
    );
  }

  /** The active backend, for teardown / advanced use. */
  getBackend(): PhysicsBackend {
    return this.backend;
  }

  private materialOf(app: App, entity: Entity): {
    restitution?: number;
    friction?: number;
    gravityScale?: number;
  } {
    const restitution = app.world.getComponent(entity, Restitution)?.coefficient;
    const friction = app.world.getComponent(entity, Friction)?.coefficient;
    const gravityScale = app.world.getComponent(entity, GravityScale)?.value;
    return {
      ...(restitution !== undefined ? { restitution } : {}),
      ...(friction !== undefined ? { friction } : {}),
      ...(gravityScale !== undefined ? { gravityScale } : {}),
    };
  }

  private registerComponents(app: App): void {
    app.registerComponent(RigidBody2d, { bodyType: t.enum(...BODY_TYPE) }, { name: 'RigidBody2d', make: () => new RigidBody2d() });
    app.registerComponent(
      Collider2d,
      { shape: t.enum('circle', 'rectangle', 'capsule'), radius: t.number, halfExtents: t.vec2, halfHeight: t.number },
      { name: 'Collider2d', make: () => new Collider2d() },
    );
    app.registerComponent(LinearVelocity2d, { value: t.vec2 }, { name: 'LinearVelocity2d', make: () => new LinearVelocity2d() });
    app.registerComponent(AngularVelocity2d, { value: t.number }, { name: 'AngularVelocity2d', make: () => new AngularVelocity2d() });
    app.registerComponent(ExternalForce2d, { value: t.vec2 }, { name: 'ExternalForce2d', make: () => new ExternalForce2d() });

    app.registerComponent(RigidBody3d, { bodyType: t.enum(...BODY_TYPE) }, { name: 'RigidBody3d', make: () => new RigidBody3d() });
    app.registerComponent(
      Collider3d,
      { shape: t.enum('sphere', 'cuboid', 'capsule'), radius: t.number, halfExtents: t.vec3, halfHeight: t.number },
      { name: 'Collider3d', make: () => new Collider3d() },
    );
    app.registerComponent(LinearVelocity3d, { value: t.vec3 }, { name: 'LinearVelocity3d', make: () => new LinearVelocity3d() });
    app.registerComponent(AngularVelocity3d, { value: t.vec3 }, { name: 'AngularVelocity3d', make: () => new AngularVelocity3d() });
    app.registerComponent(ExternalForce3d, { value: t.vec3 }, { name: 'ExternalForce3d', make: () => new ExternalForce3d() });

    app.registerComponent(Restitution, { coefficient: t.number }, { name: 'Restitution', make: () => new Restitution() });
    app.registerComponent(Friction, { coefficient: t.number }, { name: 'Friction', make: () => new Friction() });
    app.registerComponent(GravityScale, { value: t.number }, { name: 'GravityScale', make: () => new GravityScale() });
    app.registerComponent(Sensor, {}, { name: 'Sensor', make: () => new Sensor() });

    app.registerComponent(
      CharacterController2d,
      {
        offset: t.number,
        up: t.vec2,
        maxSlopeClimbAngle: t.number,
        minSlopeSlideAngle: t.number,
        autostepHeight: t.number,
        autostepMinWidth: t.number,
        snapToGroundDistance: t.number,
        desiredTranslation: t.vec2.skip(),
        grounded: t.boolean.skip(),
      },
      { name: 'CharacterController2d', make: () => new CharacterController2d() },
    );
    app.registerComponent(
      CharacterController3d,
      {
        offset: t.number,
        up: t.vec3,
        maxSlopeClimbAngle: t.number,
        minSlopeSlideAngle: t.number,
        autostepHeight: t.number,
        autostepMinWidth: t.number,
        snapToGroundDistance: t.number,
        desiredTranslation: t.vec3.skip(),
        grounded: t.boolean.skip(),
      },
      { name: 'CharacterController3d', make: () => new CharacterController3d() },
    );
  }
}
