// KESTREL LAGOON — vehicles: low-poly car factory (body, cabin, wheels,
// lights, police light bar) plus the traffic system that drives them along
// the road grid, stops for the player, and flees from gunfire.
import * as THREE from 'three';
import { VEHICLE_MODELS, WORLD } from './config.js';
import { ROAD_XS, ROAD_ZS, resolveCircle, clampToWorld } from './city.js';
import { makeRng } from './random.js';

export function modelById(id) {
  return VEHICLE_MODELS.find((m) => m.id === id) || VEHICLE_MODELS[1];
}

const WHEEL_GEO = new THREE.CylinderGeometry(0.55, 0.55, 0.5, 10);
const WHEEL_MAT = new THREE.MeshLambertMaterial({ color: 0x14181f });
const GLASS_MAT = new THREE.MeshLambertMaterial({ color: 0x9fd8e8 });
const LIGHT_MAT = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });
const TAIL_MAT = new THREE.MeshBasicMaterial({ color: 0xff2a2a });

export function buildCarMesh(model, opts = {}) {
  const g = new THREE.Group();
  const color = opts.color !== undefined ? opts.color : model.color;
  const bodyMat = new THREE.MeshLambertMaterial({ color });
  const isVan = model.kind === 'van';
  const isTruck = model.kind === 'truck';
  const bodyLen = isVan ? 5.6 : isTruck ? 5.4 : 4.6;
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.85, bodyLen), bodyMat);
  body.position.y = 0.75;
  g.add(body);
  if (isVan) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(2.05, 1.3, 3.4), bodyMat);
    box.position.set(0, 1.7, -0.6);
    g.add(box);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.8, 1.4), GLASS_MAT);
    cab.position.set(0, 1.45, 1.7);
    g.add(cab);
  } else if (isTruck) {
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.9, 1.6), GLASS_MAT);
    cab.position.set(0, 1.5, 1.2);
    g.add(cab);
    const bed = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.5, 2.4),
      new THREE.MeshLambertMaterial({ color: 0x2b2f3a }));
    bed.position.set(0, 1.3, -1.3);
    g.add(bed);
  } else {
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.75, 2.2), GLASS_MAT);
    cabin.position.set(0, 1.5, model.kind === 'sports' ? -0.3 : -0.1);
    g.add(cabin);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.14, 2.1), bodyMat);
    roof.position.set(0, 1.92, model.kind === 'sports' ? -0.3 : -0.1);
    g.add(roof);
    if (model.kind === 'sports') {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.12, 0.5),
        new THREE.MeshLambertMaterial({ color: 0x14181f }));
      wing.position.set(0, 1.45, -2.2);
      g.add(wing);
    }
  }
  // Wheels.
  const wheelZ = bodyLen / 2 - 0.8;
  for (const [wx, wz] of [[-1.0, wheelZ], [1.0, wheelZ], [-1.0, -wheelZ], [1.0, -wheelZ]]) {
    const w = new THREE.Mesh(WHEEL_GEO, WHEEL_MAT);
    w.rotation.z = Math.PI / 2;
    w.position.set(wx, 0.55, wz);
    g.add(w);
  }
  // Headlights + taillights.
  for (const sx of [-0.7, 0.7]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.25, 0.1), LIGHT_MAT);
    h.position.set(sx, 0.8, bodyLen / 2 + 0.02);
    g.add(h);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.22, 0.1), TAIL_MAT);
    t.position.set(sx, 0.85, -bodyLen / 2 - 0.02);
    g.add(t);
  }
  if (model.kind === 'police' || opts.police) {
    const bar = new THREE.Group();
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.3, 0.5),
      new THREE.MeshBasicMaterial({ color: 0xff2222 }));
    red.position.x = -0.45;
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.3, 0.5),
      new THREE.MeshBasicMaterial({ color: 0x2255ff }));
    blue.position.x = 0.45;
    bar.add(red); bar.add(blue);
    bar.position.y = 2.05;
    g.add(bar);
    g.userData.lightBar = bar;
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.12, 0.3, bodyLen * 0.9),
      new THREE.MeshLambertMaterial({ color: 0xf2f2f2 }));
    stripe.position.y = 0.8;
    g.add(stripe);
  }
  if (model.kind === 'taxi') {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.35, 0.5),
      new THREE.MeshBasicMaterial({ color: 0xfff2b0 }));
    sign.position.y = 2.05;
    g.add(sign);
  }
  g.userData.bodyLen = bodyLen;
  return g;
}

export function createTraffic(scene, seed, colliders) {
  const rng = makeRng(seed + 99);
  const cars = [];
  const civModels = VEHICLE_MODELS.filter((m) => m.kind !== 'police');

  function spawnCar(x, z, heading, model) {
    const mesh = buildCarMesh(model);
    mesh.position.set(x, 0, z);
    mesh.rotation.y = heading;
    scene.add(mesh);
    const car = {
      mesh, model, x, z, heading,
      speed: rng.range(8, 14), targetSpeed: rng.range(9, 15),
      onRoadX: null, onRoadZ: null, parked: false, fleeing: 0,
      driver: null, // a ped mesh standing in for the driver when stolen
    };
    cars.push(car);
    return car;
  }

  // Moving traffic on the roads.
  for (let i = 0; i < 26; i++) {
    const alongX = rng.chance(0.5);
    const model = rng.pick(civModels);
    if (alongX) {
      const z = rng.pick(ROAD_ZS) + rng.pick([-3.5, 3.5]);
      const x = rng.range(-WORLD.halfX + 20, WORLD.halfX - 20);
      const heading = z % 2 === 0 ? 0 : Math.PI;
      const car = spawnCar(x, z, rng.chance(0.5) ? Math.PI / 2 : -Math.PI / 2, model);
      car.onRoadZ = z;
    } else {
      const x = rng.pick(ROAD_XS) + rng.pick([-3.5, 3.5]);
      const z = rng.range(-WORLD.halfZ + 20, WORLD.halfZ - 20);
      const car = spawnCar(x, z, rng.chance(0.5) ? 0 : Math.PI, model);
      car.onRoadX = x;
    }
  }
  // Parked cars along kerbs.
  for (let i = 0; i < 14; i++) {
    const x = rng.pick(ROAD_XS) + rng.pick([-8.5, 8.5]);
    const z = rng.range(-WORLD.halfZ + 20, WORLD.halfZ - 20);
    const car = spawnCar(x, z, rng.chance(0.5) ? 0 : Math.PI, rng.pick(civModels));
    car.parked = true; car.speed = 0; car.targetSpeed = 0;
  }

  function nearestCar(x, z, maxDist, exclude) {
    let best = null, bd = maxDist;
    for (const c of cars) {
      if (c === exclude) continue;
      const d = Math.hypot(c.x - x, c.z - z);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  function update(dt, playerPos, gunfireAt) {
    for (const c of cars) {
      if (c.parked) continue;
      if (gunfireAt && Math.hypot(c.x - gunfireAt.x, c.z - gunfireAt.z) < 40) c.fleeing = 3;
      if (c.fleeing > 0) {
        c.fleeing -= dt;
        c.speed = Math.min(c.speed + 14 * dt, 24);
      } else {
        // Slow down for the car ahead and for the player.
        const ahead = nearestCar(c.x + Math.sin(c.heading) * 9, c.z + Math.cos(c.heading) * 9, 7, c);
        const playerNear = Math.hypot(c.x - playerPos.x, c.z - playerPos.z) < 8;
        const target = (ahead || playerNear) ? 0 : c.targetSpeed;
        c.speed += (target - c.speed) * Math.min(1, dt * 2);
      }
      c.x += Math.sin(c.heading) * c.speed * dt;
      c.z += Math.cos(c.heading) * c.speed * dt;
      // At the world edge, turn around onto the cross street.
      const clamped = clampToWorld(c.x, c.z, 16);
      if (clamped.x !== c.x || clamped.z !== c.z) {
        c.x = clamped.x; c.z = clamped.z;
        c.heading += Math.PI / 2 * (rng.chance(0.5) ? 1 : -1);
        // Snap back onto a road line.
        if (Math.abs(Math.sin(c.heading)) > 0.7) {
          const rz = ROAD_ZS.reduce((a, b) => Math.abs(b - c.z) < Math.abs(a - c.z) ? b : a);
          c.z = rz + 3.5;
        } else {
          const rx = ROAD_XS.reduce((a, b) => Math.abs(b - c.x) < Math.abs(a - c.x) ? b : a);
          c.x = rx + 3.5;
        }
      }
      const fixed = resolveCircle(colliders, c.x, c.z, 2.2);
      c.x = fixed.x; c.z = fixed.z;
      c.mesh.position.set(c.x, 0, c.z);
      c.mesh.rotation.y = c.heading;
    }
  }

  function removeCar(car) {
    scene.remove(car.mesh);
    const i = cars.indexOf(car);
    if (i >= 0) cars.splice(i, 1);
  }

  return { cars, update, nearestCar, spawnCar, removeCar };
}
