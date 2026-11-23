// KESTREL LAGOON — the city itself: roads, buildings, palms, marina,
// causeway bridge, airstrip, ferris wheel and neon. Built once from a seed;
// colliders and road queries live here so cars, peds and police share them.
import * as THREE from 'three';
import { WORLD } from './config.js';
import { makeRng } from './random.js';
import { facadeTexture, roadTexture, groundTexture, sandTexture, waterTexture, signTexture, runwayTexture } from './textures.js';

export const ROAD_XS = [-380, -304, -228, -152, -76, 0, 76, 152, 228, 304, 380];
export const ROAD_ZS = [-304, -228, -152, -76, 0, 76, 152, 228, 304];
const INLET = { x0: 318, z0: -64, x1: 386, z1: 64 }; // water cut, crossed by the causeway bridge
const AIRSTRIP = { x0: 330, z0: 190, x1: 450, z1: 350 };
const MARINA_BASIN = { x0: 150, z0: 210, x1: 330, z1: 350 };

function inRect(x, z, r) { return x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1; }
function rectsOverlap(a, b) { return a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0; }

export function isRoad(x, z) {
  const w = WORLD.roadWidth / 2 + 1;
  for (const rx of ROAD_XS) if (Math.abs(x - rx) < w) return true;
  for (const rz of ROAD_ZS) if (Math.abs(z - rz) < w) return true;
  return false;
}

// v8a #9: traffic-light state per intersection (pattern: fable city.js
// lightState — 16 s cycle, per-junction phase offset so neighbouring
// lights don't flip together). NS green on phase 0–8, EW green on
// 8–16; the last 2 s of each green is yellow. `time` is game-seconds
// (S.clock * 20), so one cycle is 16 real seconds.
export function lightState(ix, iz, axis, time) {
  const offset = ((ix * 7 + iz * 3) % 4) * 4;
  const phase = (((time + offset) % 16) + 16) % 16;
  const inGreen = axis === 'NS' ? phase : phase - 8;
  if (inGreen < 0 || inGreen >= 8) return 'red';
  return inGreen < 6 ? 'green' : 'yellow';
}

export function nearestRoadPoint(x, z) {
  let bx = ROAD_XS[0], bz = ROAD_ZS[0], bd = Infinity;
  for (const rx of ROAD_XS) { const d = Math.abs(x - rx); if (d < bd) { bd = d; bx = rx; } }
  let bd2 = Infinity;
  for (const rz of ROAD_ZS) { const d = Math.abs(z - rz); if (d < bd2) { bd2 = d; bz = rz; } }
  return bd <= bd2 ? { x: bx, z } : { x, z: bz };
}

export function buildCity(scene, seed) {
  const rng = makeRng(seed);
  const group = new THREE.Group();
  group.name = 'city';
  const colliders = [];
  const dynamic = { wheel: null, water: null, beacon: null, beaconRing: null };

  // --- Ground, sand ring, water -------------------------------------------
  const groundMat = new THREE.MeshLambertMaterial({ map: groundTexture() });
  groundMat.map.wrapS = groundMat.map.wrapT = THREE.RepeatWrapping;
  groundMat.map.repeat.set(12, 10);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.halfX * 2 + 120, WORLD.halfZ * 2 + 120), groundMat);
  ground.rotation.x = -Math.PI / 2; ground.position.y = 0; ground.receiveShadow = false;
  group.add(ground);

  const sandMat = new THREE.MeshLambertMaterial({ map: sandTexture() });
  sandMat.map.wrapS = sandMat.map.wrapT = THREE.RepeatWrapping;
  sandMat.map.repeat.set(16, 2);
  const sand = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.halfX * 2 + 260, WORLD.halfZ * 2 + 260), sandMat);
  sand.rotation.x = -Math.PI / 2; sand.position.y = -0.25;
  group.add(sand);

  const waterMat = new THREE.MeshLambertMaterial({ map: waterTexture(), transparent: true, opacity: 0.92 });
  waterMat.map.wrapS = waterMat.map.wrapT = THREE.RepeatWrapping;
  waterMat.map.repeat.set(20, 20);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), waterMat);
  water.rotation.x = -Math.PI / 2; water.position.y = WORLD.waterLevel;
  group.add(water);
  dynamic.water = water;

  // Lagoon inlet: a water strip cutting the east side; the bridge crosses it.
  const inlet = new THREE.Mesh(new THREE.PlaneGeometry(INLET.x1 - INLET.x0, INLET.z1 - INLET.z0), waterMat);
  inlet.rotation.x = -Math.PI / 2; inlet.position.set((INLET.x0 + INLET.x1) / 2, 0.05, (INLET.z0 + INLET.z1) / 2);
  group.add(inlet);

  // --- Roads ----------------------------------------------------------------
  const roadMat = new THREE.MeshLambertMaterial({ map: roadTexture() });
  roadMat.map.wrapS = roadMat.map.wrapT = THREE.RepeatWrapping;
  function roadPlane(w, d, x, z, y = 0.06) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), roadMat);
    m.rotation.x = -Math.PI / 2; m.position.set(x, y, z);
    group.add(m);
    return m;
  }
  for (const rx of ROAD_XS) roadPlane(WORLD.roadWidth, WORLD.halfZ * 2, rx, 0);
  for (const rz of ROAD_ZS) roadPlane(WORLD.halfX * 2, WORLD.roadWidth, 0, rz);
  // Causeway bridge over the inlet: raised deck + rails.
  const deck = new THREE.Mesh(new THREE.BoxGeometry(INLET.x1 - INLET.x0 + 8, 1.2, WORLD.roadWidth + 4),
    new THREE.MeshLambertMaterial({ color: 0x8a8f98 }));
  deck.position.set((INLET.x0 + INLET.x1) / 2, 0.4, 0);
  group.add(deck);
  roadPlane(INLET.x1 - INLET.x0 + 8, WORLD.roadWidth, (INLET.x0 + INLET.x1) / 2, 0, 1.05);
  const railMat = new THREE.MeshLambertMaterial({ color: 0xffc933 });
  for (const zs of [-9, 9]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(INLET.x1 - INLET.x0 + 8, 1, 0.5), railMat);
    rail.position.set((INLET.x0 + INLET.x1) / 2, 1.6, zs);
    group.add(rail);
  }

  // --- Buildings (instanced per facade palette) -----------------------------
  // v8a #1: six palettes in three styles — glass towers, brick low-rise,
  // concrete commercial. Style follows height (tall -> glass), so the
  // skyline reads as a real downtown instead of one repeated stucco box.
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  boxGeo.translate(0, 0.5, 0);
  const STYLES = ['glass', 'glass', 'brick', 'brick', 'concrete', 'concrete'];
  const palettes = [];
  for (let p = 0; p < 6; p++) {
    const tex = facadeTexture(seed * 7 + p * 13, 5, STYLES[p]);
    // Emissive map: the same lit windows + shopfront, glowing after dark.
    // Intensity is driven by render.applyTimeOfDay (0 by day, so the day
    // look is byte-identical to before).
    palettes.push({ mat: new THREE.MeshLambertMaterial({ map: tex.map, emissiveMap: tex.emissive, emissive: 0xffffff, emissiveIntensity: 0 }), list: [], setbacks: [] });
  }
  dynamic.facadeMats = palettes.map((p) => p.mat);
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x4a4f58 });
  const dummy = new THREE.Object3D();
  const blocks = [];
  for (let ix = 0; ix < ROAD_XS.length - 1; ix++) {
    for (let iz = 0; iz < ROAD_ZS.length - 1; iz++) {
      const cx = (ROAD_XS[ix] + ROAD_XS[ix + 1]) / 2;
      const cz = (ROAD_ZS[iz] + ROAD_ZS[iz + 1]) / 2;
      const bw = ROAD_XS[ix + 1] - ROAD_XS[ix] - WORLD.roadWidth - 8;
      const bd = ROAD_ZS[iz + 1] - ROAD_ZS[iz] - WORLD.roadWidth - 8;
      const rect = { x0: cx - bw / 2, z0: cz - bd / 2, x1: cx + bw / 2, z1: cz + bd / 2 };
      if (rectsOverlap(rect, INLET) || rectsOverlap(rect, AIRSTRIP)) continue;
      if (rectsOverlap(rect, MARINA_BASIN) && rng.chance(0.7)) continue; // marina stays open
      blocks.push({ cx, cz, bw, bd });
    }
  }
  // Silhouette variety (v8a #1): stepped setback tiers on tall towers,
  // rooftop clutter (AC units, antennas, water tanks) and a few glass
  // cylinder towers. All assignments derive from the building index or
  // its own dimensions — NO new rng calls here, so the city layout stays
  // byte-identical to v7 (the palette pick below still consumes exactly
  // one rng.int per building, only the range changes with height).
  const cylList = [];
  const roofProps = { ac: [], ant: [], tank: [] };
  let bi = 0, tallCount = 0;
  for (const b of blocks) {
    const downtown = Math.abs(b.cx) < 160 && Math.abs(b.cz) < 200;
    const n = downtown ? rng.int(1, 2) : rng.int(1, 3);
    for (let k = 0; k < n; k++) {
      const w = rng.range(14, Math.min(30, b.bw / n));
      const d = rng.range(14, Math.min(30, b.bd));
      const h = downtown ? rng.range(22, 58) : rng.range(8, 26);
      const x = b.cx + rng.range(-b.bw / 2 + w / 2, b.bw / 2 - w / 2);
      const z = b.cz + rng.range(-b.bd / 2 + d / 2, b.bd / 2 - d / 2);
      // View-corridor clamp, tiered: the inner band (|z| < 18) stays low
      // (14 m) so the city-name gantry and the police heli are never
      // hidden behind a tower; the outer band (18–45 m) may rise to
      // 26 m, giving the cover frame real urban enclosure — buildings
      // that flank the gantry instead of a flat 14 m skyline. The gantry
      // (bottom edge 15 m) still reads: outer-band towers stand beside
      // it, not in front of it.
      const inCorridor = Math.abs(z) < 45 && x > -140 && x < 160;
      const hh = !inCorridor ? h : Math.abs(z) < 18 ? Math.min(h, 14) : Math.min(h, 26);
      // Height picks the style: towers are glass, mid-rise is concrete,
      // low-rise is brick. One rng.int per building, as before.
      const pal = hh >= 30 ? rng.int(0, 1) : hh >= 14 ? rng.int(4, 5) : rng.int(2, 3);
      // Every 9th tall downtown tower is a glass cylinder (never in the
      // corridor: the clamp caps corridor height at 26 m < 34 m).
      let isCyl = false;
      if (downtown && hh >= 34) {
        tallCount++;
        if (tallCount % 9 === 0) {
          isCyl = true;
          cylList.push({ x, z, r: Math.min(w, d) / 2, h: hh });
        }
      }
      if (!isCyl) {
        palettes[pal].list.push({ x, z, w, h: hh, d });
        // Stepped setback tier on tall towers: a smaller box crowning
        // the roof, same facade — the skyline stops being a flat row.
        if (hh >= 30) palettes[pal].setbacks.push({ x, z, w: w * 0.62, h: hh * 0.22, d: d * 0.62, y: hh });
      }
      // Rooftop clutter on low/mid roofs (tall towers already have their
      // setback tier; inner-corridor roofs stay clean for the gantry).
      const innerCorridor = Math.abs(z) < 18 && x > -140 && x < 160;
      if (!isCyl && hh < 30 && !innerCorridor) {
        if (bi % 3 === 0) roofProps.ac.push({ x: x - w * 0.3, z: z + d * 0.28, y: hh });
        if (bi % 5 === 0) roofProps.ant.push({ x: x + w * 0.32, z: z - d * 0.28, y: hh });
        if (bi % 7 === 0) roofProps.tank.push({ x: x + w * 0.28, z: z + d * 0.3, y: hh });
      }
      bi++;
      colliders.push({ x0: x - w / 2, z0: z - d / 2, x1: x + w / 2, z1: z + d / 2 });
    }
  }
  for (const p of palettes) {
    if (p.list.length === 0) continue;
    const inst = new THREE.InstancedMesh(boxGeo, p.mat, p.list.length);
    p.list.forEach((b, i) => {
      dummy.position.set(b.x, 0, b.z);
      dummy.scale.set(b.w, b.h, b.d);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    });
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
    // Setback tiers: same facade, crowning the tall towers.
    if (p.setbacks.length > 0) {
      const tiers = new THREE.InstancedMesh(boxGeo, p.mat, p.setbacks.length);
      p.setbacks.forEach((b, i) => {
        dummy.position.set(b.x, b.y, b.z);
        dummy.scale.set(b.w, b.h, b.d);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        tiers.setMatrixAt(i, dummy.matrix);
      });
      tiers.instanceMatrix.needsUpdate = true;
      group.add(tiers);
    }
  }
  // Glass cylinder towers: palette-0 glass textures cloned with a 3x
  // horizontal repeat, so the window grid wraps the tower at a sane
  // scale instead of stretching once around the circumference.
  if (cylList.length > 0) {
    const cylMap = palettes[0].mat.map.clone();
    cylMap.wrapS = THREE.RepeatWrapping; cylMap.repeat.set(3, 1); cylMap.needsUpdate = true;
    const cylEm = palettes[0].mat.emissiveMap.clone();
    cylEm.wrapS = THREE.RepeatWrapping; cylEm.repeat.set(3, 1); cylEm.needsUpdate = true;
    const cylMat = new THREE.MeshLambertMaterial({ map: cylMap, emissiveMap: cylEm, emissive: 0xffffff, emissiveIntensity: 0 });
    dynamic.facadeMats.push(cylMat); // lit windows at night, like the rest
    const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 14);
    cylGeo.translate(0, 0.5, 0);
    const cyls = new THREE.InstancedMesh(cylGeo, cylMat, cylList.length);
    const caps = new THREE.InstancedMesh(cylGeo, roofMat, cylList.length);
    cylList.forEach((b, i) => {
      dummy.position.set(b.x, 0, b.z);
      dummy.scale.set(b.r, b.h, b.r);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      cyls.setMatrixAt(i, dummy.matrix);
      dummy.position.set(b.x, b.h, b.z);
      dummy.scale.set(b.r + 0.4, 0.6, b.r + 0.4);
      dummy.updateMatrix();
      caps.setMatrixAt(i, dummy.matrix);
    });
    cyls.instanceMatrix.needsUpdate = true;
    caps.instanceMatrix.needsUpdate = true;
    group.add(cyls); group.add(caps);
  }
  // Roof caps: one thin instanced box per building, slightly wider.
  const allB = palettes.flatMap((p) => p.list);
  const roofs = new THREE.InstancedMesh(boxGeo, roofMat, allB.length);
  allB.forEach((b, i) => {
    dummy.position.set(b.x, b.h, b.z);
    dummy.scale.set(b.w + 0.8, 0.6, b.d + 0.8);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    roofs.setMatrixAt(i, dummy.matrix);
  });
  roofs.instanceMatrix.needsUpdate = true;
  group.add(roofs);
  // Rooftop clutter (gta-clone pattern: AC units + antennas, plus water
  // tanks): instanced, one mesh per prop type.
  const propMat = new THREE.MeshLambertMaterial({ color: 0x55565c });
  const tankMat = new THREE.MeshLambertMaterial({ color: 0x8a8f98 });
  const propMeshes = [
    { list: roofProps.ac, geo: new THREE.BoxGeometry(2.2, 1.4, 2.2), mat: propMat, dy: 0.7 },
    { list: roofProps.ant, geo: new THREE.CylinderGeometry(0.08, 0.08, 7, 4), mat: propMat, dy: 3.5 },
    { list: roofProps.tank, geo: new THREE.CylinderGeometry(1.6, 1.6, 2.4, 10), mat: tankMat, dy: 1.2 },
    { list: roofProps.tank, geo: new THREE.ConeGeometry(1.8, 1.0, 10), mat: tankMat, dy: 2.9 },
  ];
  for (const pm of propMeshes) {
    if (pm.list.length === 0) continue;
    const im = new THREE.InstancedMesh(pm.geo, pm.mat, pm.list.length);
    pm.list.forEach((b, i) => {
      dummy.position.set(b.x, b.y + pm.dy, b.z);
      dummy.scale.set(1, 1, 1);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
    });
    im.instanceMatrix.needsUpdate = true;
    group.add(im);
  }

  // --- Palms (instanced trunks + crowns) ------------------------------------
  const palmSpots = [];
  for (let i = 0; i < 110; i++) {
    const x = rng.range(-WORLD.halfX + 10, WORLD.halfX - 10);
    const z = rng.range(-WORLD.halfZ + 10, WORLD.halfZ - 10);
    if (isRoad(x, z) || inRect(x, z, INLET) || inRect(x, z, AIRSTRIP)) continue;
    if (colliders.some((c) => x > c.x0 - 3 && x < c.x1 + 3 && z > c.z0 - 3 && z < c.z1 + 3)) continue;
    palmSpots.push({ x, z, s: rng.range(0.8, 1.4), lean: rng.range(-0.12, 0.12) });
  }
  // Boulevard palms: lined rows along the two showcase roads (the sunset
  // chase road z=0 and the warehouse road z=152), so the camera always has
  // palms in frame — the lagoon's postcard look. Road half-width is 7.
  for (let x = -380; x <= 380; x += 38) {
    for (const zs of [-9, 9]) {
      // The palm at (4, 9) stands between the cover camera and the GULL
      // TACOS billboard (27, 14): its crown clips the sign's top edge.
      // Skip it so the sign reads clean.
      if (x === 0 && zs === 9) continue;
      palmSpots.push({ x: x + 4, z: zs, s: 1.15, lean: 0 });
    }
    for (const zs of [143, 161]) palmSpots.push({ x: x + 20, z: zs, s: 1.05, lean: 0 });
  }
  const trunkGeo = new THREE.CylinderGeometry(0.35, 0.5, 7, 5);
  trunkGeo.translate(0, 3.5, 0);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x8a6a4a });
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, palmSpots.length);
  const crownGeo = new THREE.ConeGeometry(3.4, 3.2, 6);
  crownGeo.translate(0, 1.4, 0);
  const crownMat = new THREE.MeshLambertMaterial({ color: 0x2f9e57 });
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, palmSpots.length);
  palmSpots.forEach((p, i) => {
    dummy.position.set(p.x, 0, p.z); dummy.scale.set(p.s, p.s, p.s);
    dummy.rotation.set(p.lean, rng.range(0, Math.PI * 2), 0);
    dummy.updateMatrix(); trunks.setMatrixAt(i, dummy.matrix);
    dummy.position.set(p.x, 6.6 * p.s, p.z);
    dummy.rotation.set(Math.PI, 0, 0);
    dummy.updateMatrix(); crowns.setMatrixAt(i, dummy.matrix);
  });
  trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  group.add(trunks); group.add(crowns);

  // --- Street lamps -----------------------------------------------------------
  const lampSpots = [];
  for (const rx of ROAD_XS) for (let z = -300; z <= 300; z += 76) lampSpots.push({ x: rx + 9, z });
  const poleGeo = new THREE.CylinderGeometry(0.18, 0.22, 7, 5);
  poleGeo.translate(0, 3.5, 0);
  const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshLambertMaterial({ color: 0x2b2f3a }), lampSpots.length);
  const bulbGeo = new THREE.SphereGeometry(0.55, 8, 6);
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffe9a8 });
  const bulbs = new THREE.InstancedMesh(bulbGeo, bulbMat, lampSpots.length);
  lampSpots.forEach((p, i) => {
    dummy.position.set(p.x, 0, p.z); dummy.scale.set(1, 1, 1); dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix(); poles.setMatrixAt(i, dummy.matrix);
    dummy.position.set(p.x, 7.2, p.z); dummy.updateMatrix(); bulbs.setMatrixAt(i, dummy.matrix);
  });
  poles.instanceMatrix.needsUpdate = true;
  bulbs.instanceMatrix.needsUpdate = true;
  group.add(poles); group.add(bulbs);

  // --- Traffic lights ---------------------------------------------------------
  // v8a #9: one pole per intersection (NE kerb), two heads (NS + EW),
  // three bulbs each. Fully deterministic from ix/iz — no rng calls,
  // so the city layout stream is untouched. Bulb colours update ~5x/s
  // from lightState via dynamic.updateTrafficLights.
  const lightBulbs = []; // {ix, iz, axis, role} in mesh order
  const tlSpots = [];
  for (let ix = 0; ix < ROAD_XS.length; ix++) {
    for (let iz = 0; iz < ROAD_ZS.length; iz++) {
      tlSpots.push({ x: ROAD_XS[ix] + 6.8, z: ROAD_ZS[iz] + 6.8, ix, iz });
    }
  }
  const tlPoleGeo = new THREE.CylinderGeometry(0.12, 0.16, 5.5, 5);
  tlPoleGeo.translate(0, 2.75, 0);
  const tlPoles = new THREE.InstancedMesh(tlPoleGeo, new THREE.MeshLambertMaterial({ color: 0x3a3f47 }), tlSpots.length);
  const tlHeadsNS = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 1.8, 0.3), new THREE.MeshLambertMaterial({ color: 0x22262b }), tlSpots.length);
  const tlHeadsEW = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 1.8, 0.5), new THREE.MeshLambertMaterial({ color: 0x22262b }), tlSpots.length);
  const tlBulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), tlSpots.length * 6);
  const BULB_Y = { red: 5.2, yellow: 4.7, green: 4.2 };
  let bulbIdx = 0;
  tlSpots.forEach((p, i) => {
    dummy.position.set(p.x, 0, p.z); dummy.scale.set(1, 1, 1); dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix(); tlPoles.setMatrixAt(i, dummy.matrix);
    // NS head faces south (-z, toward northbound traffic); EW head west.
    dummy.position.set(p.x, 4.7, p.z - 0.15); dummy.updateMatrix(); tlHeadsNS.setMatrixAt(i, dummy.matrix);
    dummy.position.set(p.x - 0.15, 4.7, p.z); dummy.updateMatrix(); tlHeadsEW.setMatrixAt(i, dummy.matrix);
    for (const role of ['red', 'yellow', 'green']) {
      dummy.position.set(p.x, BULB_Y[role], p.z - 0.32); dummy.updateMatrix();
      tlBulbs.setMatrixAt(bulbIdx, dummy.matrix);
      lightBulbs.push({ ix: p.ix, iz: p.iz, axis: 'NS', role });
      bulbIdx++;
    }
    for (const role of ['red', 'yellow', 'green']) {
      dummy.position.set(p.x - 0.32, BULB_Y[role], p.z); dummy.updateMatrix();
      tlBulbs.setMatrixAt(bulbIdx, dummy.matrix);
      lightBulbs.push({ ix: p.ix, iz: p.iz, axis: 'EW', role });
      bulbIdx++;
    }
  });
  tlPoles.instanceMatrix.needsUpdate = true;
  tlHeadsNS.instanceMatrix.needsUpdate = true;
  tlHeadsEW.instanceMatrix.needsUpdate = true;
  tlBulbs.instanceMatrix.needsUpdate = true;
  group.add(tlPoles); group.add(tlHeadsNS); group.add(tlHeadsEW); group.add(tlBulbs);
  const TL_LIT = { red: new THREE.Color(0xff2a2a), yellow: new THREE.Color(0xffd42a), green: new THREE.Color(0x2aff66) };
  const TL_DARK = new THREE.Color(0x1a1a1a);
  let lastLightUpdate = -1;
  dynamic.updateTrafficLights = (time) => {
    if (Math.abs(time - lastLightUpdate) < 0.2) return;
    lastLightUpdate = time;
    for (let i = 0; i < lightBulbs.length; i++) {
      const b = lightBulbs[i];
      tlBulbs.setColorAt(i, lightState(b.ix, b.iz, b.axis, time) === b.role ? TL_LIT[b.role] : TL_DARK);
    }
    if (tlBulbs.instanceColor) tlBulbs.instanceColor.needsUpdate = true;
  };
  dynamic.bulbMat = bulbMat;

  // --- Neon signs + billboards -------------------------------------------------
  const SIGNS = [
    // Faces west, 100 m ahead of the sunset chase at capture time: the
    // city-name gantry over the road, dead centre of the cover frame.
    // 24 m wide on two posts, bottom edge at 15 m — above the 14 m
    // view-corridor clamp, so no building can ever cover it.
    { text: 'KESTREL LAGOON', fg: '#ff5d8f', bg: '#14181f', x: 45, z: 0, y: 18, w: 24, h: 6, ry: -Math.PI / 2 },
    { text: 'NEON QUAY', fg: '#4de3ff', bg: '#14181f', x: -76, z: -300, y: 18, w: 30, h: 8, ry: 0 },
    { text: 'CLUB VOLTAGE', fg: '#ffd166', bg: '#2a1040', x: 76, z: -228, y: 14, w: 30, h: 8, ry: 0 },
    // The burning club of CH7 (HARBOR FIRE): a neon club sign on the
    // Quay road's east verge at the job objective, with fire at its
    // feet — the combat shot's landmark. Low (y=5.2, spans 2.2–8.2 m)
    // so it stacks UNDER the NEON QUAY sign in the combat frame instead
    // of covering it: a first try at y=10 sat at the same screen height
    // as NEON QUAY and hid its right half. x=-66 sits in the
    // building-free verge strip (road centre -76, blocks start at -65).
    { text: 'CLUB EMBER', fg: '#ff8a5c', bg: '#2a1040', x: -66, z: -264, y: 5.2, w: 14, h: 6, ry: 0, posts: true },
    { text: 'GULL MARINA', fg: '#7ddf8e', bg: '#10202a', x: 300, z: 228, y: 16, w: 30, h: 8, ry: Math.PI / 2 },
    { text: 'PIER 9', fg: '#ff8a5c', bg: '#14181f', x: 228, z: 304, y: 12, w: 18, h: 6, ry: 0 },
    // Roadside neon billboards along the chase road, low (y=10) so they
    // never cover the gantry sign or the heli. They face west, toward the
    // oncoming chase, so their text reads from the cover camera.
    { text: 'LAGOON 88.3', fg: '#4de3ff', bg: '#14181f', x: 15, z: -14, y: 10, w: 12, h: 5, ry: -Math.PI / 2, posts: true },
    { text: 'GULL TACOS', fg: '#ffd166', bg: '#14181f', x: 27, z: 14, y: 10, w: 12, h: 5, ry: -Math.PI / 2, posts: true },
  ];
  const postMat = new THREE.MeshLambertMaterial({ color: 0x2b2f3a });
  for (const s of SIGNS) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h),
      new THREE.MeshBasicMaterial({ map: signTexture(s.text, s.fg, s.bg) }));
    m.position.set(s.x, s.y, s.z); m.rotation.y = s.ry;
    group.add(m);
    if (s.posts) {
      // Two posts under a roadside billboard. Its width runs along z
      // when it faces east/west (ry ±90°), along x when it faces
      // north/south (ry 0/180°) — CLUB EMBER faces south.
      const alongX = Math.abs(Math.sin(s.ry)) < 0.5;
      for (const off of [-s.w * 0.35, s.w * 0.35]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, s.y - s.h / 2, 5), postMat);
        if (alongX) post.position.set(s.x + off, (s.y - s.h / 2) / 2, s.z);
        else post.position.set(s.x, (s.y - s.h / 2) / 2, s.z + off);
        group.add(post);
      }
    }
  }

  // Gantry posts: the city-name sign spans the chase road on two posts
  // at the kerbs, so it reads as a highway gantry, not a floating board.
  for (const pz of [-11.5, 11.5]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 15, 6), postMat);
    post.position.set(45, 7.5, pz);
    group.add(post);
  }

  // --- The burning club (CH7) --------------------------------------------------
  // Flame cones + a warm glow sprite at the foot of the CLUB EMBER sign:
  // the Dredgers' arson, visible from the combat camera as firelight on
  // the street. Static set dressing; MeshBasicMaterial so it glows at night.
  {
    const flameOuter = new THREE.MeshBasicMaterial({ color: 0xff7a1a });
    const flameInner = new THREE.MeshBasicMaterial({ color: 0xffd166 });
    const outerGeo = new THREE.ConeGeometry(1.1, 2.8, 6);
    const innerGeo = new THREE.ConeGeometry(0.6, 1.8, 6);
    for (const [fx, fz] of [[-68, -264], [-67, -262], [-66, -265]]) {
      const outer = new THREE.Mesh(outerGeo, flameOuter);
      outer.position.set(fx, 1.4, fz);
      const inner = new THREE.Mesh(innerGeo, flameInner);
      inner.position.set(fx, 0.9, fz);
      group.add(outer, inner);
    }
    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = 128; glowCanvas.height = 128;
    const gg = glowCanvas.getContext('2d');
    const grad = gg.createRadialGradient(64, 64, 4, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,180,80,0.85)');
    grad.addColorStop(0.5, 'rgba(255,120,30,0.35)');
    grad.addColorStop(1, 'rgba(255,100,20,0)');
    gg.fillStyle = grad; gg.fillRect(0, 0, 128, 128);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(glowCanvas), transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    glow.position.set(-67, 2.5, -264);
    glow.scale.set(11, 7, 1);
    group.add(glow);
  }

  // --- Marina: docks + boats ---------------------------------------------------
  const dockMat = new THREE.MeshLambertMaterial({ color: 0x9a7a52 });
  for (let i = 0; i < 4; i++) {
    const dock = new THREE.Mesh(new THREE.BoxGeometry(4, 0.6, 40), dockMat);
    dock.position.set(190 + i * 30, 0.2, 320);
    group.add(dock);
  }
  const hullMat = new THREE.MeshLambertMaterial({ color: 0xf2f2f2 });
  const hullMat2 = new THREE.MeshLambertMaterial({ color: 0xff5d8f });
  for (let i = 0; i < 8; i++) {
    const boat = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 12), i % 2 ? hullMat2 : hullMat);
    hull.position.y = 0.6;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(3, 1.8, 5), new THREE.MeshLambertMaterial({ color: 0x2fa8b8 }));
    cabin.position.set(0, 2.4, -1);
    boat.add(hull); boat.add(cabin);
    boat.position.set(182 + i * 22, -0.4, 300 + (i % 3) * 12);
    boat.rotation.y = rng.range(-0.2, 0.2);
    group.add(boat);
  }

  // --- Airstrip: runway + hangars + parked plane --------------------------------
  const runway = new THREE.Mesh(new THREE.PlaneGeometry(24, 150),
    new THREE.MeshLambertMaterial({ map: runwayTexture() }));
  runway.rotation.x = -Math.PI / 2; runway.position.set(400, 0.08, 270);
  group.add(runway);
  const hangarMat = new THREE.MeshLambertMaterial({ color: 0xb8c0cc });
  for (const hz of [210, 250]) {
    const hangar = new THREE.Mesh(new THREE.BoxGeometry(30, 12, 24), hangarMat);
    hangar.position.set(350, 6, hz);
    group.add(hangar);
    colliders.push({ x0: 335, z0: hz - 12, x1: 365, z1: hz + 12 });
  }
  const plane = new THREE.Group();
  const fus = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 12, 8),
    new THREE.MeshLambertMaterial({ color: 0xf2f2f2 }));
  fus.rotation.x = Math.PI / 2; plane.add(fus);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(16, 0.3, 2.6),
    new THREE.MeshLambertMaterial({ color: 0xff5d8f }));
  plane.add(wing);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(5, 0.3, 1.6),
    new THREE.MeshLambertMaterial({ color: 0xff5d8f }));
  tail.position.z = -5.4; plane.add(tail);
  plane.position.set(400, 2, 320); plane.rotation.y = 0.4;
  group.add(plane);

  // --- Ferris wheel at the marina ------------------------------------------------
  const wheel = new THREE.Group();
  const rim = new THREE.Mesh(new THREE.TorusGeometry(16, 0.7, 8, 28),
    new THREE.MeshLambertMaterial({ color: 0xff5d8f }));
  wheel.add(rim);
  for (let i = 0; i < 8; i++) {
    const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 32, 4),
      new THREE.MeshLambertMaterial({ color: 0xf2f2f2 }));
    spoke.rotation.z = (i / 8) * Math.PI;
    wheel.add(spoke);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2, 2.4),
      new THREE.MeshLambertMaterial({ color: [0x4de3ff, 0xffd166, 0x7ddf8e, 0xff8a5c][i % 4] }));
    const a = (i / 8) * Math.PI * 2;
    cab.position.set(Math.cos(a) * 16, Math.sin(a) * 16, 0);
    wheel.add(cab);
  }
  const legL = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 20, 4),
    new THREE.MeshLambertMaterial({ color: 0x8a8f98 }));
  legL.position.set(-6, -8, 0); legL.rotation.z = 0.35;
  const legR = legL.clone(); legR.position.x = 6; legR.rotation.z = -0.35;
  wheel.add(legL); wheel.add(legR);
  wheel.position.set(240, 20, 330);
  group.add(wheel);
  dynamic.wheel = wheel;

  // --- Objective beacon (moved by the mission system) ----------------------------
  const beacon = new THREE.Group();
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.4, 60, 10, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
  beam.position.y = 30;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(4, 0.35, 8, 24),
    new THREE.MeshBasicMaterial({ color: 0xffd166 }));
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.4;
  beacon.add(beam); beacon.add(ring);
  beacon.visible = false;
  group.add(beacon);
  dynamic.beacon = beacon;
  dynamic.beaconRing = ring;

  scene.add(group);
  return { group, colliders, dynamic, palmSpots };
}

// Push a circle (x, z, radius) out of every building AABB it overlaps.
export function resolveCircle(colliders, x, z, r) {
  for (const c of colliders) {
    const nx = Math.max(c.x0, Math.min(x, c.x1));
    const nz = Math.max(c.z0, Math.min(z, c.z1));
    const dx = x - nx, dz = z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      if (d2 > 0.0001) {
        const d = Math.sqrt(d2);
        x = nx + (dx / d) * r; z = nz + (dz / d) * r;
      } else {
        // Centre inside the box: push out along the smallest penetration.
        const pl = x - c.x0, pr = c.x1 - x, pt = z - c.z0, pb = c.z1 - z;
        const m = Math.min(pl, pr, pt, pb);
        if (m === pl) x = c.x0 - r; else if (m === pr) x = c.x1 + r;
        else if (m === pt) z = c.z0 - r; else z = c.z1 + r;
      }
    }
  }
  return { x, z };
}

export function clampToWorld(x, z, m = 10) {
  return {
    x: Math.max(-WORLD.halfX + m, Math.min(WORLD.halfX - m, x)),
    z: Math.max(-WORLD.halfZ + m, Math.min(WORLD.halfZ - m, z)),
  };
}
