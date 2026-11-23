// KESTREL LAGOON — walk-in shops: the three shops have real interiors
// you walk into (GTA-style), instead of only a proximity menu. Each
// shop gets a roadside door marker (sign + glowing ring) and a
// furnished room far off the island — the room lives at x = 3000 with
// the other interiors, so it never collides with the city — with a
// counter, a clerk, themed props and its own lights. Walk into the
// ring to enter, walk to the counter and press E to shop (the same
// shop action as outside), walk to the yellow ring to leave.
//
// Pattern: fable stores.js (NO LICENSE — pattern only, Kestrel's own
// code): INTERIOR_X = 3000, one room per shop, three shared room
// lights moved to the active interior, door/exit/counter rings, the
// enter/exit cooldown. Kestrel's own parts: the door placement (the
// nearest road point, offset 8.5 m toward the shop — guaranteed open
// ground, since the city colliders are buildings-only), the shop
// catalogue (arms/auto/boathouse from config.js, not fable's six),
// the reuse of the existing useShop action at the counter, and the
// world-position plumbing in main.js (cops, crew and traffic wait at
// the door while the player is inside).
import * as THREE from 'three';
import { S, showBanner, showToast } from './state.js';
import { SHOPS } from './config.js';
import { nearestRoadPoint } from './city.js';
import { buildPersonMesh } from './pedestrians.js';

export const INTERIOR_X = 3000; // interiors live far off the island, GTA-style
const ROOM_W = 16, ROOM_D = 12, ROOM_H = 4;
const DOOR_OFFSET = 8.5; // door sits 1.5 m past the road edge — open ground by construction
const ENTER_RADIUS = 2.0;
const EXIT_RADIUS = 1.4;
const COUNTER_RADIUS = 2.2;
const ENTER_COOLDOWN = 1.2;

const SHOP_COLORS = { arms: 0xff8a5c, auto: 0x4de3ff, boathouse: 0x7ddf8e };
const SHOP_COLOR_CSS = { arms: '#ff8a5c', auto: '#4de3ff', boathouse: '#7ddf8e' };
const SHOP_SUB = {
  arms: 'Harbor Arms — guns, ammo, armour',
  auto: 'Lagoon Auto — respray & repair (bring a car)',
  boathouse: 'The Boathouse — save & rest',
};
const CLERK_SHIRT = { arms: 0x3a3a3a, auto: 0x2b6cb0, boathouse: 0x7ddf8e };

function signTexture(text, color) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#101418'; g.fillRect(0, 0, 512, 128);
  g.strokeStyle = color; g.lineWidth = 6; g.strokeRect(8, 8, 496, 112);
  g.font = 'bold 52px Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = color;
  g.shadowColor = color; g.shadowBlur = 16;
  g.fillText(text, 256, 66);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function ringMesh(color, radius, opacity) {
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, 1.2, 24, 1, true),
    new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  return m;
}

export function createStores(scene, ctx) {
  const { player, audio } = ctx;
  // Three shared room lights, moved to whichever interior the player is
  // in (constant light count = no shader recompiles). Parked far below
  // the world at intensity 0 while the player is outside.
  const roomLights = [];
  for (let i = 0; i < 3; i++) {
    const l = new THREE.PointLight(0xfff1dc, 0, 16, 1.6);
    l.position.set(0, -100, 0);
    scene.add(l);
    roomLights.push(l);
  }

  const stores = [];
  let inside = null; // the store entry the player is in, or null
  let cooldown = 0;
  let counterToasted = false;
  // The exit ring only works once the player has walked at least 3 m
  // from the spawn: without this, a player who enters while still
  // holding their entry keys can walk straight to the exit ring (1.8 m
  // behind the spawn) during the 1.2 s cooldown, stand on it, and get
  // bounced straight back out the moment the cooldown ends — the
  // cooldown alone only delays the false exit, it does not prevent it.
  // Walking to the counter (4.4 m) always arms it.
  let exitArmed = false;

  function buildStore(def, index) {
    // The door goes on the roadside next to the shop: the nearest road
    // point, stepped 8.5 m toward the shop — 1.5 m past the road edge,
    // 2.5 m short of the block edge, on ground no building can occupy
    // (the city colliders are buildings-only). The shop's own position
    // can sit inside a building footprint, so the door never goes there.
    const road = nearestRoadPoint(def.x, def.z);
    let dx = def.x - road.x, dz = def.z - road.z;
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl; dz /= dl;
    const doorX = road.x + dx * DOOR_OFFSET;
    const doorZ = road.z + dz * DOOR_OFFSET;
    // The storefront faces the road (back toward the street).
    const rot = Math.atan2(road.x - doorX, road.z - doorZ);
    const color = SHOP_COLORS[def.id] || 0xffffff;
    const s = { def, doorX, doorZ, rot, index };

    // Storefront: a sign board on two posts + the glowing door ring.
    const front = new THREE.Group();
    front.position.set(doorX, 0, doorZ);
    front.rotation.y = rot;
    scene.add(front);
    const postMat = new THREE.MeshLambertMaterial({ color: 0x2b2f3a });
    for (const px of [-2, 2]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 2.6, 0.18), postMat);
      post.position.set(px, 1.3, 0);
      front.add(post);
    }
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(4.6, 1.3, 0.15),
      [
        new THREE.MeshLambertMaterial({ color: 0x111418 }),
        new THREE.MeshLambertMaterial({ color: 0x111418 }),
        new THREE.MeshLambertMaterial({ color: 0x111418 }),
        new THREE.MeshLambertMaterial({ color: 0x111418 }),
        new THREE.MeshBasicMaterial({ map: signTexture(def.name.toUpperCase(), SHOP_COLOR_CSS[def.id] || '#ffffff') }),
        new THREE.MeshLambertMaterial({ color: 0x111418 }),
      ],
    );
    sign.position.set(0, 2.9, 0);
    front.add(sign);
    const ring = ringMesh(color, 1.1, 0.3);
    ring.position.set(doorX, 0.6, doorZ);
    scene.add(ring);
    s.ring = ring;

    buildInterior(s);
    stores.push(s);
  }

  function buildInterior(s) {
    const ox = INTERIOR_X, oz = INTERIOR_X + s.index * 120;
    const W = ROOM_W, D = ROOM_D, H = ROOM_H;
    // Spawn near the door, 1.8 m clear of the exit ring: standing still
    // after the entry cooldown must not bounce the player straight out.
    s.int = {
      x: ox, z: oz,
      spawnX: ox, spawnZ: oz + D / 2 - 3,
      exitX: ox, exitZ: oz + D / 2 - 1.2,
      counterX: ox, counterZ: oz - D / 2 + 4.6,
    };
    const room = new THREE.Group();
    room.position.set(ox, 0, oz);
    scene.add(room);
    const kind = s.def.id;
    const floorMat = new THREE.MeshLambertMaterial({ color: kind === 'arms' ? 0x3c3f44 : kind === 'auto' ? 0x4a4a48 : 0x8a6f4d });
    const floor = new THREE.Mesh(new THREE.BoxGeometry(W, 0.2, D), floorMat);
    floor.position.y = -0.1;
    room.add(floor);
    const wallMat = new THREE.MeshLambertMaterial({ color: kind === 'arms' ? 0x7a2f2f : kind === 'auto' ? 0x3a4a5a : 0xe8dcc0 });
    const walls = [
      [0, H / 2, -D / 2, W, H, 0.3], [0, H / 2, D / 2, W, H, 0.3],
      [-W / 2, H / 2, 0, 0.3, H, D], [W / 2, H / 2, 0, 0.3, H, D],
    ];
    for (const [x, y, z, w, h, d] of walls) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat);
      m.position.set(x, y, z);
      room.add(m);
    }
    const ceil = new THREE.Mesh(new THREE.BoxGeometry(W, 0.3, D), new THREE.MeshLambertMaterial({ color: 0xdddddd }));
    ceil.position.y = H;
    room.add(ceil);
    // The door, drawn on the +z wall (the exit is the yellow ring in
    // front of it — the wall itself stays solid).
    const door = new THREE.Mesh(new THREE.BoxGeometry(2.2, 3, 0.2), new THREE.MeshLambertMaterial({ color: 0x0d1b26 }));
    door.position.set(0, 1.5, D / 2 - 0.25);
    room.add(door);
    // Ceiling fixtures (emissive boxes — the light comes from the three
    // shared room lights, parked at these spots while the player is in).
    for (const [lx, lz] of [[-4, -2], [4, -2], [0, 3]]) {
      const fixture = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 0.4),
        new THREE.MeshBasicMaterial({ color: 0xfff6e0 }));
      fixture.position.set(lx, H - 0.2, lz);
      room.add(fixture);
    }
    s.int.lights = [[-4, H - 0.4, -2], [4, H - 0.4, -2], [0, H - 0.4, 3]];
    // Counter + top slab.
    const counter = new THREE.Mesh(new THREE.BoxGeometry(7, 1.1, 1.2),
      new THREE.MeshLambertMaterial({ color: kind === 'auto' ? 0x8a2f2f : 0x2b2b2b }));
    counter.position.set(0, 0.55, -D / 2 + 2.6);
    room.add(counter);
    const top = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.08, 1.4),
      new THREE.MeshLambertMaterial({ color: 0xeeeeee }));
    top.position.set(0, 1.12, -D / 2 + 2.6);
    room.add(top);
    // Themed props, one set per shop.
    const darkMetal = new THREE.MeshLambertMaterial({ color: 0x1a1a1a });
    if (kind === 'arms') {
      for (let k = 0; k < 6; k++) {
        for (const side of [-1, 1]) {
          const rack = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 1.4), darkMetal);
          rack.position.set(side * (W / 2 - 0.3), 1.6 + (k % 3) * 0.7, -3 + Math.floor(k / 3) * 3);
          room.add(rack);
        }
      }
      const target = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.8, 0.05),
        new THREE.MeshLambertMaterial({ color: 0xf4f4f4 }));
      target.position.set(0, 2.2, -D / 2 + 0.2);
      room.add(target);
      const rings = new THREE.Mesh(new THREE.RingGeometry(0.15, 0.5, 24),
        new THREE.MeshBasicMaterial({ color: 0xff2020, side: THREE.DoubleSide }));
      rings.position.set(0, 2.3, -D / 2 + 0.24);
      room.add(rings);
    } else if (kind === 'auto') {
      const bench = new THREE.Mesh(new THREE.BoxGeometry(4, 0.9, 1),
        new THREE.MeshLambertMaterial({ color: 0x5a4a3a }));
      bench.position.set(-W / 2 + 2.4, 0.45, -2);
      room.add(bench);
      for (let k = 0; k < 3; k++) {
        const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12), darkMetal);
        tire.position.set(W / 2 - 1.6, 0.15 + k * 0.32, -3.5);
        room.add(tire);
      }
      const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.1, 12),
        new THREE.MeshLambertMaterial({ color: 0x2b6cb0 }));
      drum.position.set(W / 2 - 1.6, 0.55, 1);
      room.add(drum);
    } else {
      // Boathouse: crates, barrels, coiled rope.
      const crateMat = new THREE.MeshLambertMaterial({ color: 0x9a7a4a });
      for (const [cx, cz, cs] of [[-5.5, -3, 1], [-4.4, -3.2, 0.7], [-5.2, -1.5, 0.8], [5.5, -3, 1.1]]) {
        const crate = new THREE.Mesh(new THREE.BoxGeometry(cs, cs, cs), crateMat);
        crate.position.set(cx, cs / 2, cz);
        room.add(crate);
      }
      for (const [bx, bz] of [[5.2, 1], [6.1, 1.6]]) {
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1, 12),
          new THREE.MeshLambertMaterial({ color: 0x6b4a2a }));
        barrel.position.set(bx, 0.5, bz);
        room.add(barrel);
      }
    }
    // The clerk, behind the counter, facing the door.
    const clerk = buildPersonMesh(CLERK_SHIRT[kind] || 0x888888, 0xe8b98d, 1.0,
      { hair: 0x1c1c22, hairStyle: 'short' });
    clerk.position.set(ox, 0, oz - D / 2 + 1.4);
    clerk.rotation.y = 0;
    scene.add(clerk);
    s.clerk = clerk;
    // Interior colliders: the four walls + the counter (world coords).
    s.colliders = [
      { x0: ox - W / 2, z0: oz - D / 2 - 0.15, x1: ox + W / 2, z1: oz - D / 2 + 0.15 },
      { x0: ox - W / 2, z0: oz + D / 2 - 0.15, x1: ox + W / 2, z1: oz + D / 2 + 0.15 },
      { x0: ox - W / 2 - 0.15, z0: oz - D / 2, x1: ox - W / 2 + 0.15, z1: oz + D / 2 },
      { x0: ox + W / 2 - 0.15, z0: oz - D / 2, x1: ox + W / 2 + 0.15, z1: oz + D / 2 },
      { x0: ox - 3.5, z0: oz - D / 2 + 2.0, x1: ox + 3.5, z1: oz - D / 2 + 3.2 },
    ];
    // Exit ring (yellow, by the door) + shop ring (shop colour, at the counter).
    const exitRing = ringMesh(0xffd24a, 0.9, 0.3);
    exitRing.position.set(s.int.exitX, 0.6, s.int.exitZ);
    scene.add(exitRing);
    s.exitRing = exitRing;
    const shopRing = ringMesh(SHOP_COLORS[kind] || 0xffffff, 0.9, 0.3);
    shopRing.position.set(s.int.counterX, 0.6, s.int.counterZ);
    scene.add(shopRing);
    s.shopRing = shopRing;
  }

  SHOPS.forEach((def, i) => buildStore(def, i));

  function enter(s) {
    inside = s;
    cooldown = ENTER_COOLDOWN;
    counterToasted = false;
    exitArmed = false;
    roomLights.forEach((l, i) => {
      const [lx, ly, lz] = s.int.lights[i];
      l.position.set(s.int.x + lx, ly, s.int.z + lz);
      l.intensity = 18;
    });
    S.interior = s.def.id;
    player.teleport(s.int.spawnX, s.int.spawnZ, Math.PI);
    if (audio && audio.click) audio.click();
    showBanner(s.def.name.toUpperCase(), SHOP_SUB[s.def.id] || '');
  }

  function exit() {
    if (!inside) return;
    const s = inside;
    inside = null;
    cooldown = ENTER_COOLDOWN;
    counterToasted = false;
    exitArmed = false;
    for (const l of roomLights) l.intensity = 0;
    S.interior = null;
    player.teleport(
      s.doorX + Math.sin(s.rot) * 1.5,
      s.doorZ + Math.cos(s.rot) * 1.5,
      s.rot,
    );
    if (audio && audio.click) audio.click();
  }

  function update(dt, playerPos, inCar) {
    cooldown = Math.max(0, cooldown - dt);
    const t = performance.now() / 1000;
    for (const s of stores) {
      s.ring.material.opacity = 0.25 + 0.12 * Math.sin(t * 3 + s.index);
      if (s.exitRing) s.exitRing.material.opacity = 0.25 + 0.12 * Math.sin(t * 3 + s.index + 1);
      if (s.shopRing) s.shopRing.material.opacity = 0.25 + 0.12 * Math.sin(t * 3 + s.index + 2);
    }
    if (inside) {
      const s = inside;
      // Arm the exit once the player has actually walked into the shop
      // (see the exitArmed note above).
      if (!exitArmed) {
        const dSpawn = Math.hypot(playerPos.x - s.int.spawnX, playerPos.z - s.int.spawnZ);
        if (dSpawn > 3) exitArmed = true;
      }
      const dExit = Math.hypot(playerPos.x - s.int.exitX, playerPos.z - s.int.exitZ);
      if (exitArmed && cooldown <= 0 && dExit < EXIT_RADIUS) { exit(); return; }
      const dCounter = Math.hypot(playerPos.x - s.int.counterX, playerPos.z - s.int.counterZ);
      if (dCounter < COUNTER_RADIUS) {
        if (!counterToasted) {
          counterToasted = true;
          showToast(`Press E — ${s.def.name}`);
        }
      } else {
        counterToasted = false;
      }
      return;
    }
    if (cooldown > 0 || inCar) return;
    for (const s of stores) {
      if (Math.hypot(playerPos.x - s.doorX, playerPos.z - s.doorZ) < ENTER_RADIUS) {
        enter(s);
        return;
      }
    }
  }

  return {
    update, exit,
    get inside() { return inside; },
    get colliders() { return inside ? inside.colliders : null; },
    doorPos() {
      return inside ? { x: inside.doorX, z: inside.doorZ } : null;
    },
    // The shop whose counter the player stands at (for the E key), or null.
    counterShop(playerPos) {
      if (!inside) return null;
      const d = Math.hypot(playerPos.x - inside.int.counterX, playerPos.z - inside.int.counterZ);
      return d < COUNTER_RADIUS ? inside.def : null;
    },
    state() {
      return {
        inside: S.interior,
        doors: stores.map((s) => ({ id: s.def.id, x: Math.round(s.doorX * 10) / 10, z: Math.round(s.doorZ * 10) / 10 })),
      };
    },
  };
}
