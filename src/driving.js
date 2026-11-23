// KESTREL LAGOON — arcade driving: acceleration, braking, handbrake drift,
// building and traffic collisions with damage, and carjacking (F pulls the
// driver out — the driver runs, the wanted level notices).
import * as THREE from 'three';
import { S, addRep, showToast } from './state.js';
import { buildCarMesh, modelById } from './vehicles.js';
import { resolveCircle, clampToWorld } from './city.js';

export function createDriving(scene, traffic, peds, audio, police) {
  let car = null; // {mesh, model, x, z, heading, speed, health, isPlayer}

  function spawnPlayerCar(modelId, x, z, heading) {
    const model = modelById(modelId);
    const mesh = buildCarMesh(model);
    mesh.position.set(x, 0, z);
    mesh.rotation.y = heading;
    scene.add(mesh);
    car = { mesh, model, x, z, heading, speed: 0, health: 100, isPlayer: true, skid: 0 };
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
    police.addWanted(1, 'Vehicle stolen');
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
    const top = car.model.topSpeed;
    const accel = car.model.accel;
    if (f > 0) car.speed += accel * dt * (1 - Math.max(0, car.speed) / (top * 1.15));
    else if (f < 0) car.speed -= (car.speed > 1 ? 34 : 10) * dt;
    else car.speed -= car.speed * 0.6 * dt; // rolling drag
    car.speed = Math.max(-12, Math.min(top, car.speed));
    const steerAuthority = Math.min(1, Math.abs(car.speed) / 8);
    const drift = input.handbrake ? 1.9 : 1;
    car.heading += s * 1.9 * steerAuthority * drift * dt * (car.speed >= 0 ? 1 : -1) * -1;
    car.heading += 0; // (heading sign kept explicit for the camera blend)
    const nx = car.x + Math.sin(car.heading) * car.speed * dt;
    const nz = car.z + Math.cos(car.heading) * car.speed * dt;
    // Collisions: buildings stop the car hard; traffic bumps it.
    const before = { x: car.x, z: car.z };
    const fixed = resolveCircle(colliders, nx, nz, 2.1);
    const hitWall = Math.hypot(fixed.x - nx, fixed.z - nz) > 0.01;
    car.x = fixed.x; car.z = fixed.z;
    const clamped = clampToWorld(car.x, car.z, 14);
    car.x = clamped.x; car.z = clamped.z;
    if (hitWall && Math.abs(car.speed) > 8) {
      damage(Math.abs(car.speed) * 0.35, 'crash');
      audio.crash();
      car.speed *= -0.25;
    }
    const other = traffic.nearestCar(car.x, car.z, 4.5, null);
    if (other && Math.abs(car.speed) > 6) {
      damage(4, 'traffic');
      audio.crash();
      car.speed *= 0.55;
      other.speed = Math.max(0, other.speed - 6);
    }
    car.skid = input.handbrake && Math.abs(car.speed) > 12 ? Math.min(1, car.skid + dt * 3) : Math.max(0, car.skid - dt * 4);
    car.mesh.position.set(car.x, 0, car.z);
    car.mesh.rotation.y = car.heading;
    car.mesh.rotation.z = car.skid * 0.06 * (s !== 0 ? s : 1);
    S.speedKmh = Math.abs(car.speed) * 3.6;
    S.gear = car.speed < 1 ? 1 : Math.min(6, 1 + Math.floor(Math.abs(car.speed) / 10));
    S.stats.distanceDriven += Math.abs(car.speed) * dt;
    void before;
    return car;
  }

  function getCar() { return car; }
  function destroyCar() { if (car) { scene.remove(car.mesh); car = null; S.inCar = false; } }

  return { spawnPlayerCar, enterCar, exitCar, damage, update, getCar, destroyCar };
}
