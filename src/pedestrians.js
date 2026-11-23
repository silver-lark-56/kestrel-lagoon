// KESTREL LAGOON — pedestrians: low-poly walkers on the pavements who
// stroll, chat, and run screaming from gunfire. Each one is a small
// articulated figure with a swinging walk cycle.
import * as THREE from 'three';
import { WORLD } from './config.js';
import { ROAD_XS, ROAD_ZS, resolveCircle, clampToWorld } from './city.js';
import { makeRng } from './random.js';

const SHIRTS = [0xff5d8f, 0x4de3ff, 0xffd166, 0x7ddf8e, 0xb388ff, 0xff8a5c, 0xf2f2f2, 0x3f6fb5];
const SKINS = [0xc98d5f, 0xe8b98d, 0x8a5a3b, 0x5a3a26, 0xf0c8a0];

export function buildPersonMesh(shirtColor, skinColor, scale = 1) {
  const g = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: skinColor });
  const shirt = new THREE.MeshLambertMaterial({ color: shirtColor });
  const pants = new THREE.MeshLambertMaterial({ color: 0x2b2f3a });
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.55), skin);
  head.position.y = 1.62;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.8, 0.45), shirt);
  torso.position.y = 1.05;
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.65, 0.35), pants);
  legL.position.set(-0.2, 0.32, 0);
  const legR = legL.clone(); legR.position.x = 0.2;
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.65, 0.28), shirt);
  armL.position.set(-0.52, 1.05, 0);
  const armR = armL.clone(); armR.position.x = 0.52;
  g.add(head, torso, legL, legR, armL, armR);
  g.userData = { head, torso, legL, legR, armL, armR };
  g.scale.setScalar(scale);
  return g;
}

export function createPedestrians(scene, seed, colliders) {
  const rng = makeRng(seed + 7);
  const peds = [];

  // opts.fleeing: spawn already running (seconds); opts.fleeFrom: the
  // point the ped runs away from — used by staged shots (a roadblock or
  // a firefight) where there is no live gunfire to trigger the flee.
  function spawnPed(x, z, opts = {}) {
    const mesh = buildPersonMesh(rng.pick(SHIRTS), rng.pick(SKINS), rng.range(0.92, 1.08));
    mesh.position.set(x, 0, z);
    scene.add(mesh);
    const ped = {
      mesh, x, z, heading: rng.range(0, Math.PI * 2),
      speed: rng.range(1.2, 2.2), walkPhase: rng.range(0, 6),
      target: null, fleeing: opts.fleeing || 0, fleeFrom: opts.fleeFrom || null,
      dead: false, pauseTimer: rng.range(0, 6),
    };
    peds.push(ped);
    return ped;
  }

  function randomSidewalkSpot() {
    const alongX = rng.chance(0.5);
    if (alongX) return { x: rng.range(-WORLD.halfX + 15, WORLD.halfX - 15), z: rng.pick(ROAD_ZS) + rng.pick([-9.5, 9.5]) };
    return { x: rng.pick(ROAD_XS) + rng.pick([-9.5, 9.5]), z: rng.range(-WORLD.halfZ + 15, WORLD.halfZ - 15) };
  }

  for (let i = 0; i < 42; i++) {
    const s = randomSidewalkSpot();
    spawnPed(s.x, s.z);
  }

  function update(dt, gunfireAt, playerPos) {
    for (const p of peds) {
      if (p.dead) continue;
      if (gunfireAt && Math.hypot(p.x - gunfireAt.x, p.z - gunfireAt.z) < 45) p.fleeing = 4;
      let moving = true;
      if (p.fleeing > 0) {
        p.fleeing -= dt;
        // Run away from the gunfire — or from the staged threat point
        // when there is no live gunfire (gunfireAt is null on a quiet
        // street, so a bare read here would throw).
        const from = gunfireAt || p.fleeFrom;
        if (from) p.heading = Math.atan2(p.x - from.x, p.z - from.z);
        p.speed = 6.5;
      } else {
        p.speed = 1.6;
        if (p.pauseTimer > 0) {
          p.pauseTimer -= dt;
          moving = false;
        } else if (!p.target || Math.hypot(p.target.x - p.x, p.target.z - p.z) < 3) {
          p.target = randomSidewalkSpot();
          if (rng.chance(0.25)) p.pauseTimer = rng.range(2, 8);
        } else {
          p.heading = Math.atan2(p.target.x - p.x, p.target.z - p.z);
        }
      }
      if (moving) {
        p.x += Math.sin(p.heading) * p.speed * dt;
        p.z += Math.cos(p.heading) * p.speed * dt;
        p.walkPhase += dt * (p.fleeing > 0 ? 11 : 6);
      }
      const fixed = resolveCircle(colliders, p.x, p.z, 0.8);
      p.x = fixed.x; p.z = fixed.z;
      const clamped = clampToWorld(p.x, p.z, 12);
      p.x = clamped.x; p.z = clamped.z;
      const u = p.mesh.userData;
      const swing = moving ? Math.sin(p.walkPhase) * 0.55 : 0;
      u.legL.rotation.x = swing; u.legR.rotation.x = -swing;
      u.armL.rotation.x = -swing; u.armR.rotation.x = swing;
      p.mesh.position.set(p.x, 0, p.z);
      p.mesh.rotation.y = p.heading;
    }
  }

  function nearestPed(x, z, maxDist) {
    let best = null, bd = maxDist;
    for (const p of peds) {
      if (p.dead) continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  function killPed(ped) {
    ped.dead = true;
    ped.mesh.rotation.x = -Math.PI / 2;
    ped.mesh.position.y = 0.4;
  }

  return { peds, update, nearestPed, killPed, spawnPed };
}
