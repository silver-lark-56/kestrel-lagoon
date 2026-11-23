// KESTREL LAGOON — vehicles: extruded-profile car factory (2D side
// silhouettes swept into 3D bodies with clearcoat paint, glass
// greenhouses, bumpers and lights) plus the traffic system that drives
// them along the road grid, stops for the player, and flees from gunfire.
import * as THREE from 'three';
import { VEHICLE_MODELS, WORLD } from './config.js';
import { ROAD_XS, ROAD_ZS, resolveCircle, clampToWorld, lightState } from './city.js';
import { makeRng } from './random.js';

export function modelById(id) {
  return VEHICLE_MODELS.find((m) => m.id === id) || VEHICLE_MODELS[1];
}

// v8a #11: cars as extruded 2D side profiles (technique + profile shapes
// adapted from NEONBAY vehicle.js, MIT). Each profile is a closed [x, y]
// silhouette (x: -rear .. +front, y: height above ground); the body and
// the glasshouse are separate extrusions, so a car reads as sculpted
// metal + glass instead of stacked boxes. Profiles are authored ~4.6 m
// long and scaled in x to each model's bodyLen.
const PROFILES = {
  hyper: { body: [[-2.3, 0.26], [2.2, 0.26], [2.33, 0.4], [2.2, 0.6], [0.9, 0.78], [-1.9, 0.9], [-2.32, 0.84], [-2.35, 0.5]], cab: [[-1.4, 0.86], [-0.4, 1.13], [0.45, 1.13], [1.3, 0.74]] },
  coupe: { body: [[-2.2, 0.3], [2.13, 0.3], [2.25, 0.46], [2.19, 0.68], [0.98, 0.88], [-1.52, 0.97], [-2.13, 0.92], [-2.25, 0.58]], cab: [[-1.82, 0.93], [-0.7, 1.26], [0.22, 1.27], [1.06, 0.89]] },
  sedan: { body: [[-2.45, 0.32], [2.38, 0.32], [2.48, 0.52], [2.4, 0.8], [1.35, 0.92], [-1.98, 0.98], [-2.45, 0.9], [-2.5, 0.58]], cab: [[-2.03, 0.96], [-1.25, 1.46], [0.57, 1.47], [1.42, 0.93]] },
  suv: { body: [[-2.45, 0.42], [2.4, 0.42], [2.48, 0.7], [2.4, 1.07], [1.5, 1.14], [-2.45, 1.14], [-2.5, 0.76]], cab: [[-2.36, 1.12], [-2.22, 1.84], [0.92, 1.86], [1.62, 1.14]] },
  van: { body: [[-2.7, 0.42], [2.7, 0.42], [2.74, 0.8], [2.65, 1.12], [2.12, 1.28], [-2.7, 1.28]], cab: [[-2.7, 1.22], [-2.7, 2.35], [1.45, 2.35], [2.16, 1.28]] },
  // Pickup: Kestrel's own profile (NEONBAY has no truck) — flat hood,
  // tall glasshouse, open bed behind it at rail height; the bed floor
  // is a separate dark inset below the rails.
  truck: { body: [[-2.7, 0.38], [2.65, 0.38], [2.7, 0.7], [2.6, 1.0], [1.15, 1.05], [-1.05, 1.08], [-2.7, 1.08]], cab: [[-1.0, 1.02], [-0.8, 1.62], [0.3, 1.62], [1.1, 1.02]] },
};
const KIND_PROFILE = { sports: 'coupe', sedan: 'sedan', taxi: 'sedan', suv: 'suv', truck: 'truck', van: 'van', police: 'sedan' };
const PROFILE_MODEL = { peregrine: 'hyper', sunbeam: 'coupe' }; // the two sports cars differ

const geoCache = {};
function profileGeos(name, bodyLen, width) {
  const key = `${name}|${bodyLen}|${width}`;
  if (geoCache[key]) return geoCache[key];
  const pr = PROFILES[name];
  const span = Math.max(...pr.body.map((p) => p[0])) - Math.min(...pr.body.map((p) => p[0]));
  const sx = bodyLen / span;
  const extrude = (pts, w) => {
    const s = new THREE.Shape();
    pts.forEach(([x, y], n) => (n ? s.lineTo(x * sx, y) : s.moveTo(x * sx, y)));
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: w - 0.2, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.07, bevelSegments: 3, steps: 1, curveSegments: 4 });
    g.translate(0, 0, -(w - 0.2) / 2);
    g.rotateY(-Math.PI / 2); // shape +x (front) -> world +z (front)
    g.computeVertexNormals();
    return g;
  };
  const front = Math.max(...pr.body.map((p) => p[0])) * sx;
  const rear = Math.min(...pr.body.map((p) => p[0])) * sx;
  const cabRear = Math.min(...pr.cab.map((p) => p[0])) * sx;
  const out = {
    body: extrude(pr.body, width),
    cab: extrude(pr.cab, width * 0.84),
    front, rear, cabRear,
    cabTop: Math.max(...pr.cab.map((p) => p[1])),
    headY: name === 'suv' || name === 'van' ? 0.9 : name === 'hyper' ? 0.5 : 0.66,
  };
  geoCache[key] = out;
  return out;
}

const paintCache = new Map();
function paint(hex) {
  if (!paintCache.has(hex)) paintCache.set(hex, new THREE.MeshPhysicalMaterial({ color: hex, metalness: 0.5, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.35 }));
  return paintCache.get(hex);
}
const GLASS_MAT = new THREE.MeshPhysicalMaterial({ color: 0x0a0e14, metalness: 0.9, roughness: 0.08, envMapIntensity: 1.4 });
const TRIM_MAT = new THREE.MeshStandardMaterial({ color: 0x0d0d0e, roughness: 0.5, metalness: 0.3 });
const WHEEL_GEO = new THREE.CylinderGeometry(0.55, 0.55, 0.5, 12);
const WHEEL_MAT = new THREE.MeshStandardMaterial({ color: 0x14181f, roughness: 0.85, metalness: 0.1 });
const LIGHT_MAT = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });
const TAIL_MAT = new THREE.MeshBasicMaterial({ color: 0xff2a2a });

export function buildCarMesh(model, opts = {}) {
  const g = new THREE.Group();
  const color = opts.color !== undefined ? opts.color : model.color;
  const isVan = model.kind === 'van';
  const isTruck = model.kind === 'truck';
  const bodyLen = isVan ? 5.6 : isTruck ? 5.4 : 4.6;
  const width = model.kind === 'suv' || isVan || isTruck ? 2.1 : 2.0;
  const profile = PROFILE_MODEL[model.id] || model.profile || KIND_PROFILE[model.kind] || 'sedan';
  const geos = profileGeos(profile, bodyLen, width);
  const bodyMat = paint(color);
  const body = new THREE.Mesh(geos.body, bodyMat);
  g.add(body);
  // Glasshouse: dark glass for cars; the van's upper box stays painted
  // (its cab outline IS the cargo box) with a separate windshield.
  if (isVan) {
    const upper = new THREE.Mesh(geos.cab, bodyMat);
    g.add(upper);
    // Windshield seated on the cab's sloped front face (the face runs
    // from (2.16, 1.28) to (1.45, 2.35) in profile space, x5.6/5.44).
    const shield = new THREE.Mesh(new THREE.BoxGeometry(width * 0.8, 0.72, 0.06), GLASS_MAT);
    shield.position.set(0, 1.76, 1.93);
    shield.rotation.x = -0.6;
    g.add(shield);
  } else {
    const cab = new THREE.Mesh(geos.cab, GLASS_MAT);
    g.add(cab);
  }
  if (isTruck) {
    // Open bed: a dark inset floor below the rail line + a painted roof
    // panel over the tall glasshouse.
    const bed = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.3, (geos.cabRear - geos.rear) * 0.9),
      new THREE.MeshStandardMaterial({ color: 0x1c1f26, roughness: 0.9 }));
    bed.position.set(0, 0.92, (geos.rear + geos.cabRear) / 2);
    g.add(bed);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.08, 1.35), bodyMat);
    roof.position.set(0, 1.66, 0.05);
    g.add(roof);
  }
  if (model.kind === 'sports') {
    // Rear wing on two struts, above the rear deck.
    const wingMat = new THREE.MeshStandardMaterial({ color: 0x14181f, roughness: 0.4, metalness: 0.4 });
    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.07, 0.42), wingMat);
    wing.position.set(0, 1.12, geos.rear + 0.3);
    g.add(wing);
    for (const sx of [-0.6, 0.6]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.22, 0.14), wingMat);
      strut.position.set(sx, 1.0, geos.rear + 0.3);
      g.add(strut);
    }
  }
  // Bumpers: dark trim bars front + rear.
  for (const [bz, by] of [[geos.front + 0.04, 0.42], [geos.rear - 0.04, 0.45]]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(width * 0.92, 0.22, 0.12), TRIM_MAT);
    b.position.set(0, by, bz);
    g.add(b);
  }
  // Wheels.
  const wheelZ = bodyLen / 2 - 0.8;
  for (const [wx, wz] of [[-1.0, wheelZ], [1.0, wheelZ], [-1.0, -wheelZ], [1.0, -wheelZ]]) {
    const w = new THREE.Mesh(WHEEL_GEO, WHEEL_MAT);
    w.rotation.z = Math.PI / 2;
    w.position.set(wx, 0.55, wz);
    g.add(w);
  }
  // Headlights + taillights, seated on the profile's nose and tail.
  for (const sx of [-0.68, 0.68]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.1), LIGHT_MAT);
    h.position.set(sx, geos.headY, geos.front + 0.06);
    g.add(h);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.14, 0.1), TAIL_MAT);
    t.position.set(sx, geos.headY + 0.1, geos.rear - 0.06);
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
    bar.position.y = geos.cabTop + 0.18;
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
    sign.position.y = geos.cabTop + 0.2;
    g.add(sign);
  }
  g.userData.bodyLen = bodyLen;
  return g;
}

// v8a #9 helpers: the next road line ahead in `dir` (+1/-1), and the
// index of the road line nearest to a position.
function nextLineIndex(lines, v, dir) {
  if (dir > 0) { for (let i = 0; i < lines.length; i++) if (lines[i] > v) return i; }
  else { for (let i = lines.length - 1; i >= 0; i--) if (lines[i] < v) return i; }
  return -1;
}
function nearestLineIndex(lines, v) {
  let bi = 0, bd = Infinity;
  for (let i = 0; i < lines.length; i++) { const d = Math.abs(lines[i] - v); if (d < bd) { bd = d; bi = i; } }
  return bi;
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

  function update(dt, playerPos, gunfireAt, lightTime) {
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
        // Traffic lights (v8a #9, fable pattern): stop at a red light
        // at the next intersection; a yellow light stops the car only
        // if it is far enough out to brake in time. Fleeing cars run
        // the lights (they never reach this branch).
        let lightStop = false;
        if (lightTime !== undefined) {
          const alongX = Math.abs(Math.sin(c.heading)) > 0.7;
          const dir = alongX ? Math.sign(Math.sin(c.heading)) : Math.sign(Math.cos(c.heading));
          if (alongX) {
            const ix = nextLineIndex(ROAD_XS, c.x, dir);
            if (ix >= 0) {
              const dist = Math.abs(ROAD_XS[ix] - c.x) - 6; // stop at the road edge
              if (dist > 0 && dist < 14) {
                const st = lightState(ix, nearestLineIndex(ROAD_ZS, c.z), 'EW', lightTime);
                if (st === 'red' || (st === 'yellow' && dist > 6)) lightStop = true;
              }
            }
          } else {
            const iz = nextLineIndex(ROAD_ZS, c.z, dir);
            if (iz >= 0) {
              const dist = Math.abs(ROAD_ZS[iz] - c.z) - 6;
              if (dist > 0 && dist < 14) {
                const st = lightState(nearestLineIndex(ROAD_XS, c.x), iz, 'NS', lightTime);
                if (st === 'red' || (st === 'yellow' && dist > 6)) lightStop = true;
              }
            }
          }
        }
        const target = (ahead || playerNear || lightStop) ? 0 : c.targetSpeed;
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
