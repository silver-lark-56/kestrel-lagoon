// KESTREL LAGOON — pedestrians: walkers on the pavements who stroll,
// chat, and run screaming from gunfire. Each one is a small articulated
// figure with a swinging walk cycle — capsule limbs and a sphere head
// (v8a art pass), with hair styles and accessories carried over from
// the character portraits.
import * as THREE from 'three';
import { WORLD } from './config.js';
import { ROAD_XS, ROAD_ZS, resolveCircle, clampToWorld } from './city.js';
import { makeRng } from './random.js';

const SHIRTS = [0xff5d8f, 0x4de3ff, 0xffd166, 0x7ddf8e, 0xb388ff, 0xff8a5c, 0xf2f2f2, 0x3f6fb5];
const SKINS = [0xc98d5f, 0xe8b98d, 0x8a5a3b, 0x5a3a26, 0xf0c8a0];
const HAIRS = [0x1c1c22, 0x2b2018, 0x3a2415, 0x6b4a2b, 0x8a8a8a, 0xd8d8e0];
const HAIR_STYLES = ['short', 'bun', 'braids', 'bob', 'slick', 'flat', 'mohawk'];

// Shared geometries: one set for every person in the city.
const HEAD_GEO = new THREE.SphereGeometry(0.24, 12, 10);
const TORSO_GEO = new THREE.CapsuleGeometry(0.26, 0.25, 4, 10);
const LEG_GEO = new THREE.CapsuleGeometry(0.11, 0.55, 4, 8);
const ARM_GEO = new THREE.CapsuleGeometry(0.09, 0.45, 4, 8);
const SHOE_GEO = new THREE.BoxGeometry(0.17, 0.1, 0.34);
const HAIR_CAP_GEO = new THREE.SphereGeometry(0.26, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
const HAIR_BOB_GEO = new THREE.SphereGeometry(0.27, 12, 10);
const BUN_GEO = new THREE.SphereGeometry(0.11, 8, 6);
const BRAID_GEO = new THREE.CylinderGeometry(0.05, 0.04, 0.55, 6);
const MOHAWK_GEO = new THREE.BoxGeometry(0.07, 0.16, 0.42);
const FLAT_GEO = new THREE.CylinderGeometry(0.23, 0.24, 0.06, 12);
const CAP_GEO = new THREE.CylinderGeometry(0.26, 0.27, 0.12, 12);
const BRIM_GEO = new THREE.BoxGeometry(0.3, 0.03, 0.22);
const BANDANA_GEO = new THREE.CylinderGeometry(0.255, 0.26, 0.13, 12);
const SHOE_MAT = new THREE.MeshLambertMaterial({ color: 0x1c1f26 });

// v8a art pass (LOCAL — none of the six reference repos solves the blocky
// character; all six are low-poly too): capsule limbs + sphere head,
// human proportions (~1.85 m, head 1/7.5 of height), shoes, and hair
// carried over from the character portraits (bun / mohawk / braids /
// bob / slick / short / flat). Limbs pivot at the hip/shoulder joints
// (pivot Groups), so the walk cycle swings from the joint instead of
// the limb's middle — the userData interface is unchanged, so the
// existing animation code works untouched. opts: { hair, hairStyle,
// pants, accessory ('cap' | 'bandana'), accessoryColor }.
export function buildPersonMesh(shirtColor, skinColor, scale = 1, opts = {}) {
  const g = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: skinColor });
  const shirt = new THREE.MeshLambertMaterial({ color: shirtColor });
  const pants = new THREE.MeshLambertMaterial({ color: opts.pants !== undefined ? opts.pants : 0x2b2f3a });
  const hairMat = new THREE.MeshLambertMaterial({ color: opts.hair !== undefined ? opts.hair : 0x1c1c22 });
  const head = new THREE.Mesh(HEAD_GEO, skin);
  head.position.y = 1.62;
  g.add(head);
  // Hair, from the portrait's hairStyle.
  const style = opts.hairStyle || 'short';
  const addHair = (geo, x, y, z, sx = 1, sy = 1, sz = 1) => {
    const m = new THREE.Mesh(geo, hairMat);
    m.position.set(x, y, z); m.scale.set(sx, sy, sz);
    g.add(m);
    return m;
  };
  if (style === 'mohawk') {
    addHair(MOHAWK_GEO, 0, 1.88, 0);
  } else if (style === 'bob') {
    addHair(HAIR_BOB_GEO, 0, 1.6, -0.02);
  } else if (style === 'flat') {
    addHair(FLAT_GEO, 0, 1.84, 0);
  } else if (style === 'slick') {
    addHair(HAIR_CAP_GEO, 0, 1.66, 0, 1, 0.6, 1);
  } else {
    addHair(HAIR_CAP_GEO, 0, 1.64, 0);
    if (style === 'bun') addHair(BUN_GEO, 0, 1.78, -0.22);
    if (style === 'braids') addHair(BRAID_GEO, 0, 1.42, -0.24);
  }
  // Accessories: a cap (Rook) or a bandana (Dredgers).
  if (opts.accessory === 'cap') {
    const capMat = new THREE.MeshLambertMaterial({ color: opts.accessoryColor || 0x1c2a4a });
    const cap = new THREE.Mesh(CAP_GEO, capMat);
    cap.position.y = 1.8;
    const brim = new THREE.Mesh(BRIM_GEO, capMat);
    brim.position.set(0, 1.76, 0.32);
    g.add(cap, brim);
  } else if (opts.accessory === 'bandana') {
    const bandMat = new THREE.MeshLambertMaterial({ color: opts.accessoryColor || 0x222226 });
    const band = new THREE.Mesh(BANDANA_GEO, bandMat);
    band.position.y = 1.7;
    g.add(band);
  }
  const torso = new THREE.Mesh(TORSO_GEO, shirt);
  torso.position.y = 1.19;
  g.add(torso);
  // Limbs hang from pivot groups at the joints; the walk cycle rotates
  // the pivots (userData.legL etc. ARE the pivots).
  function limb(geo, mat, px, py, drop, shoe) {
    const pivot = new THREE.Group();
    pivot.position.set(px, py, 0);
    const m = new THREE.Mesh(geo, mat);
    m.position.y = drop;
    pivot.add(m);
    if (shoe) {
      const s = new THREE.Mesh(SHOE_GEO, SHOE_MAT);
      s.position.set(0, -0.8, 0.05);
      pivot.add(s);
    }
    g.add(pivot);
    return pivot;
  }
  const legL = limb(LEG_GEO, pants, -0.14, 0.85, -0.38, true);
  const legR = limb(LEG_GEO, pants, 0.14, 0.85, -0.38, true);
  const armL = limb(ARM_GEO, shirt, -0.33, 1.45, -0.28, false);
  const armR = limb(ARM_GEO, shirt, 0.33, 1.45, -0.28, false);
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
    const mesh = buildPersonMesh(rng.pick(SHIRTS), rng.pick(SKINS), rng.range(0.92, 1.08),
      { hair: rng.pick(HAIRS), hairStyle: rng.pick(HAIR_STYLES) });
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

  // v8d #12: scare — every ped inside the radius runs from the point
  // for `seconds` (the horn, neonbay pattern). Returns how many fled.
  function scare(x, z, radius, seconds) {
    let n = 0;
    for (const p of peds) {
      if (p.dead || p.fleeing > 0) continue;
      if (Math.hypot(p.x - x, p.z - z) < radius) {
        p.fleeing = seconds;
        p.fleeFrom = { x, z };
        n++;
      }
    }
    return n;
  }

  return { peds, update, nearestPed, killPed, spawnPed, scare };
}
