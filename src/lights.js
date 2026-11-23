// KESTREL LAGOON — the light budget: every real-time light in the
// scene, pooled and capped. The city has 99 lamp posts but only a
// handful of live lights: a pool of 6 point lights hops to the lamps
// nearest the player, one warm light rides the player, and two
// spotlights are the player car's headlights. Nothing allocates per
// frame; intensities damp toward their targets so a hopping light
// never pops.
//
// Pattern: gta7 main.ts (MIT — the STREETLIGHT_POOL = 6 hop, the
// actor lamp, the twin headlight spots with their exact intensities,
// distances and angles). Kestrel's own code: the night-factor
// modulation (gta7 starts at midnight and never modulates), the
// preset-driven pool size, the intensity damping, and the Kestrel
// heading convention for the headlight aim.
//
// Budget (all lights, worst case, night + driving + Ultra):
//   hemi + sun + night ambient (render.js) ......... 3 (always on)
//   weather flash light ........................... 1 (rain only)
//   title stage light (main.js) ................... 1 (staged title only)
//   actor lamp + streetlight pool (here) .......... 1 + 6
//   headlights (here) ............................. 2
//   shop room lights (stores.js) .................. 3 (inside a shop only)
// The pool, the actor lamp and the headlights run in normal play ONLY
// — main.js gates update() out of ?shot= staging and the self-test,
// so the four final shots keep exactly their v8b lighting.
import * as THREE from 'three';

const POOL_SIZE = 6;
const POOL_COLOR = 0xffcf9a;
const POOL_INTENSITY = 45;
const POOL_DISTANCE = 28;
const POOL_DECAY = 1.6;
const POOL_HEIGHT = 6.8; // just under the lamp bulbs (7.2 m)
const ACTOR_COLOR = 0xffd9a8;
const ACTOR_INTENSITY = 60;
const ACTOR_DISTANCE = 40;
const ACTOR_DECAY = 2;
const ACTOR_HEIGHT = 3.5;
const HEAD_COLOR = 0xfff2d0;
const HEAD_INTENSITY = 90;
const HEAD_DISTANCE = 42;
const HEAD_ANGLE = 0.62;
const HEAD_PENUMBRA = 0.5;
const HEAD_DECAY = 1.1;
const DAMP = 3; // intensity damping rate (1/s) — hops fade, never pop

export function createLights(scene, lampSpots) {
  const actorLamp = new THREE.PointLight(ACTOR_COLOR, 0, ACTOR_DISTANCE, ACTOR_DECAY);
  actorLamp.position.set(0, ACTOR_HEIGHT, 0);
  scene.add(actorLamp);

  const pool = [];
  for (let i = 0; i < POOL_SIZE; i++) {
    const l = new THREE.PointLight(POOL_COLOR, 0, POOL_DISTANCE, POOL_DECAY);
    l.position.set(0, -50, 0); // parked underground until assigned
    scene.add(l);
    pool.push(l);
  }

  const headlights = [0, 1].map(() => {
    const light = new THREE.SpotLight(HEAD_COLOR, 0, HEAD_DISTANCE, HEAD_ANGLE, HEAD_PENUMBRA, HEAD_DECAY);
    const target = new THREE.Object3D();
    light.target = target;
    scene.add(light, target);
    return { light, target };
  });

  let poolSize = POOL_SIZE; // the graphics preset thins the pool (Low 3, Medium 4)
  let nightK = 0;
  let headlightsOn = false;

  function setPoolSize(n) {
    poolSize = Math.max(0, Math.min(POOL_SIZE, n));
  }

  // order[] is reused across frames: no per-frame allocation.
  const order = lampSpots.map((_, i) => i);
  function update(dt, playerPos, night, car) {
    nightK = night;
    const k = Math.min(1, DAMP * dt); // frame-rate-independent damping
    // The actor lamp rides the player and fades in with the dark.
    actorLamp.position.set(playerPos.x, ACTOR_HEIGHT, playerPos.z);
    const actorTarget = ACTOR_INTENSITY * nightK;
    actorLamp.intensity += (actorTarget - actorLamp.intensity) * k;

    // The pool hops to the lamps nearest the player (gta7: nearest-first
    // sort every call). Lights past the preset's pool size fade to 0.
    const d2 = (i) => {
      const dx = lampSpots[i].x - playerPos.x;
      const dz = lampSpots[i].z - playerPos.z;
      return dx * dx + dz * dz;
    };
    order.sort((a, b) => d2(a) - d2(b));
    for (let i = 0; i < POOL_SIZE; i++) {
      const s = lampSpots[order[Math.min(i, order.length - 1)]];
      pool[i].position.set(s.x, POOL_HEIGHT, s.z);
      const target = i < poolSize ? POOL_INTENSITY * nightK : 0;
      pool[i].intensity += (target - pool[i].intensity) * k;
    }

    // Headlights: on the car you're driving, at night; dark on foot.
    headlightsOn = !!car && nightK > 0;
    if (!headlightsOn) {
      for (const h of headlights) h.light.intensity = 0;
      return;
    }
    // Kestrel heading: forward is (sin h, cos h); right is (-cos h, sin h).
    const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
    const rx = -Math.cos(car.heading), rz = Math.sin(car.heading);
    for (let i = 0; i < headlights.length; i++) {
      const side = i === 0 ? -0.6 : 0.6;
      const h = headlights[i];
      h.light.position.set(car.x + fx * 2 + rx * side, 0.7, car.z + fz * 2 + rz * side);
      h.target.position.set(car.x + fx * 16, 0.1, car.z + fz * 16);
      h.light.intensity = HEAD_INTENSITY * nightK;
    }
  }

  return {
    setPoolSize, update,
    state() {
      return {
        poolSize, nightK, headlightsOn,
        actorIntensity: Math.round(actorLamp.intensity * 10) / 10,
        poolIntensities: pool.map((l) => Math.round(l.intensity)),
      };
    },
  };
}
