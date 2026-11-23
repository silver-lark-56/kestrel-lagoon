// KESTREL LAGOON — arcade driving: acceleration, braking, handbrake drift,
// building and traffic collisions with damage, and carjacking (F pulls the
// driver out — the driver runs, the wanted level notices).
//
// The car carries a velocity VECTOR (vx, vz); the step itself lives in
// vehicle-model.js (gta7 pattern: forward/lateral decomposition + grip
// bleed + handbrake drift). `car.speed` stays a plain-looking property
// for the staging code (shots.js sets getCar().speed = 41): it reads the
// forward speed and writes the velocity along the current heading.
import * as THREE from 'three';
import { S, addRep, showToast } from './state.js';
import { buildCarMesh, modelById } from './vehicles.js';
import { resolveCircle, clampToWorld } from './city.js';
import { stepVehicle, configFor, forwardSpeed, lateralSpeed, speedOf } from './vehicle-model.js';

export function createDriving(scene, traffic, peds, audio, police) {
  let car = null; // {mesh, model, x, z, heading, vx, vz, health, isPlayer, skid, cfg}

  function spawnPlayerCar(modelId, x, z, heading) {
    const model = modelById(modelId);
    const mesh = buildCarMesh(model);
    mesh.position.set(x, 0, z);
    mesh.rotation.y = heading;
    scene.add(mesh);
    car = { mesh, model, x, z, heading, vx: 0, vz: 0, health: 100, isPlayer: true, skid: 0, cfg: configFor(model) };
    Object.defineProperty(car, 'speed', {
      get() { return forwardSpeed(car); },
      set(v) { car.vx = Math.sin(car.heading) * v; car.vz = Math.cos(car.heading) * v; },
      enumerable: true, configurable: true,
    });
    S.inCar = true;
    S.vehicleName = model.name;
    S.vehicleHealth = 100;
    return car;
  }

  function enterCar(nearCar) {
    if (!nearCar) return false;
    // The driver bails and runs.
    if (nearCar.driver) {
      const d = nearCar.driver;
      d.fleeing = 6;
      nearCar.driver = null;
    }
    traffic.removeCar(nearCar);
    spawnPlayerCar(nearCar.model.id, nearCar.x, nearCar.z, nearCar.heading);
    S.stats.carsStolen += 1;
    addRep(5);
    police.commitCrime('carjack', 'Vehicle stolen', { x: nearCar.x, z: nearCar.z });
    showToast(`Vehicle stolen: ${nearCar.model.name}`);
    return true;
  }

  function exitCar() {
    if (!car) return null;
    const spot = { x: car.x - Math.sin(car.heading + Math.PI / 2) * 2.5, z: car.z - Math.cos(car.heading + Math.PI / 2) * 2.5 };
    // Leave the car parked where it stands, as traffic.
    const parked = traffic.spawnCar(car.x, car.z, car.heading, car.model);
    parked.parked = true; parked.speed = 0; parked.targetSpeed = 0;
    scene.remove(car.mesh);
    car = null;
    S.inCar = false;
    S.speedKmh = 0;
    return spot;
  }

  function damage(amount, why) {
    if (!car) return;
    car.health = Math.max(0, car.health - amount);
    S.vehicleHealth = car.health;
    if (car.health <= 0) {
      showToast('Your ride is wrecked!');
      audio.crash();
      exitCar();
      void why;
    }
  }

  function update(dt, input, colliders, frozen) {
    if (!car || frozen) return car;
    const { f, s } = input.axis();
    // The pure step moves the car and rotates the velocity with it.
    stepVehicle(car, { throttle: f, steer: s, handbrake: input.handbrake }, car.cfg, dt);
    // Collisions: buildings stop the car hard; traffic bumps it.
    const intended = { x: car.x, z: car.z };
    const fixed = resolveCircle(colliders, car.x, car.z, 2.1);
    const pushX = fixed.x - intended.x, pushZ = fixed.z - intended.z;
    const hitWall = Math.hypot(pushX, pushZ) > 0.01;
    car.x = fixed.x; car.z = fixed.z;
    const clamped = clampToWorld(car.x, car.z, 14);
    if (clamped.x !== car.x) { car.x = clamped.x; car.vx = 0; }
    if (clamped.z !== car.z) { car.z = clamped.z; car.vz = 0; }
    const v = speedOf(car);
    if (hitWall && v > 8) {
      damage(v * 0.35, 'crash');
      audio.crash();
      // Bounce off the wall: reflect the velocity component along the
      // push-out normal with 0.25 restitution, keep the tangential slide.
      const n = Math.hypot(pushX, pushZ) || 1;
      const nx = pushX / n, nz = pushZ / n;
      const vn = car.vx * nx + car.vz * nz;
      if (vn < 0) {
        car.vx -= 1.25 * vn * nx;
        car.vz -= 1.25 * vn * nz;
      }
    }
    const other = traffic.nearestCar(car.x, car.z, 4.5, null);
    if (other && v > 6) {
      damage(4, 'traffic');
      audio.crash();
      car.vx *= 0.55; car.vz *= 0.55;
      other.speed = Math.max(0, other.speed - 6);
    }
    // Skid: handbrake at speed, or a big sideways slide from the drift.
    const vLat = Math.abs(lateralSpeed(car));
    const sliding = (input.handbrake && Math.abs(forwardSpeed(car)) > 12) || vLat > 8;
    car.skid = sliding ? Math.min(1, car.skid + dt * 3) : Math.max(0, car.skid - dt * 4);
    car.mesh.position.set(car.x, 0, car.z);
    car.mesh.rotation.y = car.heading;
    car.mesh.rotation.z = car.skid * 0.06 * (s !== 0 ? s : 1);
    S.speedKmh = speedOf(car) * 3.6;
    S.gear = forwardSpeed(car) < 1 ? 1 : Math.min(6, 1 + Math.floor(Math.abs(forwardSpeed(car)) / 10));
    S.stats.distanceDriven += speedOf(car) * dt;
    return car;
  }

  function getCar() { return car; }
  function destroyCar() { if (car) { scene.remove(car.mesh); car = null; S.inCar = false; } }

  return { spawnPlayerCar, enterCar, exitCar, damage, update, getCar, destroyCar };
}
