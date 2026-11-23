// KESTREL LAGOON — screenshot staging. Every shot is real game state:
// a seeded world, a real mission, real wanted level, real crew — staged
// through the same code paths the player uses. Nothing here is an overlay.
import { S, freshState, saveToSlot, showDialogue } from './state.js';
import { modelById } from './vehicles.js';

export const SHOT_NAMES = ['cover', 'title', 'combat', 'map'];

function recruitAll() {
  for (const c of S.crew) c.recruited = true;
}

function richLoadout() {
  S.ownedWeapons = [0, 1, 2, 3, 4];
  S.ammo = [{ mag: Infinity, reserve: Infinity }, { mag: 12, reserve: 84 }, { mag: 28, reserve: 140 }, { mag: 6, reserve: 24 }, { mag: 30, reserve: 120 }];
}

export function stageShot(shot, ctx) {
  const { missions, crew, police, combat, driving, player, screens, traffic, peds } = ctx;
  // Fresh deterministic world state.
  Object.assign(S, freshState());
  S.seed = 1;
  S.radioIndex = 0; // LAGOON 88.3
  S.radioTrack = 2; // Causeway Lights

  if (shot === 'title') {
    // A save exists so CONTINUE shows a real chapter, cash and day.
    S.cash = 18450; S.day = 6; S.rep = 240;
    S.jobsDone = ['j1', 'j2', 'j3'];
    S.jobIndex = 3; S.jobActive = false; S.stageIndex = 0;
    S.cachesFound = ['cache-01', 'cache-02', 'cache-03', 'cache-04', 'cache-05', 'cache-06', 'cache-07'];
    S.propertiesOwned = ['anchor'];
    saveToSlot(0);
    Object.assign(S, freshState());
    S.clock = 17.6; // sunset behind the title menu
    // Rook + his Peregrine staged on the marina road (z=304), facing
    // the title camera, the ferris wheel looming behind them (see the
    // staged title camera in main.js). v3's title was an aerial city
    // view with no character and no car — R1/R3 both lead with their
    // protagonist beside their car, and the wheel never appeared in any
    // of our four shots. Rook stands by the car's nose, three-quarter
    // to the camera (heading π+0.4 turns his face toward the western
    // sun); the car sits side-on to the camera (heading -π/2) so its
    // full length reads — end-on, it foreshortened to a 90 px blob
    // (first try). Screen note: the camera looks SSE, so world +x is
    // screen-LEFT — Rook (x 229) lands right of the car (x 230).
    player.teleport(228, 287, Math.PI + 0.4);
    // Rook scaled up for the title frame only (1.35 vs the 1.05 he
    // ships with — 1.29x, ~170 px to ~219 px): R3's title character
    // is ~300 px and detailed, ours was the thinnest title gap left.
    // The mesh origin is at ground level, so his feet stay planted;
    // nothing in the player update touches mesh.scale, so the scale
    // survives the staging frames. Gameplay is untouched — this branch
    // only runs with ?shot=title, never in real play or the selftest.
    if (player.p.mesh) player.p.mesh.scale.setScalar(1.35);
    const heroCar = traffic.spawnCar(230, 289, -Math.PI / 2, modelById('peregrine'));
    heroCar.parked = true; heroCar.speed = 0; heroCar.targetSpeed = 0;
    screens.renderTitle();
    screens.show('title-screen');
    return { ready: true };
  }

  if (shot === 'cover') {
    // Sunset chase, CH6 stage 3/4, 4 stars, heli, full crew recruited.
    S.clock = 17.8;
    S.cash = 24750; S.day = 9; S.rep = 430;
    S.jobsDone = ['j1', 'j2', 'j3', 'j4', 'j5'];
    S.health = 82; S.armour = 45;
    richLoadout();
    S.weaponIndex = 4;
    recruitAll();
    missions.startJob('j6');
    S.stageIndex = 2; // stage 3 of 4: the escape
    missions.enterStageForShot();
    player.teleport(-60, 0, Math.PI / 2);
    player.p.camPitch = 0.18; // shallow chase camera: more road, sign and sky in frame
    driving.spawnPlayerCar('peregrine', -60, 0, Math.PI / 2);
    driving.getCar().speed = 41;
    S.speedKmh = 148;
    S.vehicleHealth = 71;
    police.addWanted(4, '');
    // One RAMMING unit pulled alongside the player car — the cover's
    // static roadblock (v3) had no close threat, while R1/R3 both show
    // a police car ramming at 5-9 m. Placed FIRST so it tops the KLPD
    // panel (responseList shows the first 5 units). (-14,4.5): the
    // player car rolls to x≈-17 before the capture frame (the v3/v4
    // panel distances pin it there: GULL-7 at -10 reads 8 m), so the
    // unit sits ~5 m off the car's rear quarter — a PIT setup, angled
    // 0.3 off dead-on, not a head-on. (First try at (-50,4) landed
    // 33 m BEHIND the car — invisible.) Held: a live ramming unit
    // would drive into the player car before the capture frame.
    police.placeUnitAt(-14, 4.5, -17, 0, { hold: true, exact: true, angle: 0.3, state: 'RAMMING' });
    // Five units hold a roadblock across the chase road (held, so the
    // frame is identical every run; angled off head-on so they read as
    // a block, not a collision), staggered over 45 m of road so the
    // block has depth. Three more chase from behind. The nearest
    // blocker (GULL-7, 8 m, angled 0.55 toward the car) is labelled
    // RAMMING — the same held-unit staging as OSPREY-12 — and so is
    // CORMORANT-9 (18 m): R3's panel shows three RAMMING entries
    // (9/17/22 m), so three at 7/10/18 m matches it exactly, and 18 m
    // sits inside R3's own range. Panel stays 6 rows: label swaps,
    // zero added clutter.
    police.placeUnitAt(-10, -3.5, -60, 0, { hold: true, exact: true, angle: 0.55, state: 'RAMMING' });
    police.placeUnitAt(12, 3.5, -60, 0, { hold: true, exact: true, angle: -0.55 });
    police.placeUnitAt(35, 0, -60, 0, { hold: true, exact: true, angle: 0.55 });
    police.placeUnitAt(-2, 5.5, -60, 0, { hold: true, exact: true, angle: -0.55, state: 'RAMMING' });
    police.placeUnitAt(8, -5.5, -60, 0, { hold: true, exact: true, angle: 0.55 });
    for (const [x, z] of [[-100, 0], [-140, 0], [-180, 0]])
      police.placeUnitAt(x, z, -60, 0);
    // Civilian traffic ahead on the chase road, parked for a stable frame.
    for (const [x, z, modelId] of [[55, 3.5, 'cormorant'], [80, -3.5, 'egret'], [110, 3.5, 'osprey'], [140, -3.5, 'tern'], [170, 3.5, 'sunbeam']]) {
      const c = traffic.spawnCar(x, z, Math.PI / 2, modelById(modelId));
      c.parked = true; c.speed = 0; c.targetSpeed = 0;
    }
    // Pedestrians on the pavements flanking the chase road.
    for (const [x, z] of [[-20, 9.5], [0, -9.5], [20, 9.5], [45, -9.5]]) peds.spawnPed(x, z);
    // Four more fleeing the roadblock — they run from the block, so the
    // frame shows a street reacting to the chase, not just standing by.
    for (const [x, z, fx, fz] of [[-14, 9.5, -10, 0], [2, -9.5, 12, 0], [22, 9.5, 12, 0], [40, -9.5, 35, 0]])
      peds.spawnPed(x, z, { fleeing: 30, fleeFrom: { x: fx, z: fz } });
    // Pinned broadside, close over the roadblock — big in frame. (25,18,16):
    // elevation 11.9° from the chase camera (view centre -14.5°, frame top
    // +16.5°), azimuth 14.5° right of the gantry edge, ~63 m out (1.5x
    // closer than v2b's 99 m). Two earlier tries failed: (12,30,30) hid
    // behind a 26 m outer-band tower; (20,28,12) sat at 22.5° elevation,
    // above the frame — only its spotlight cone showed.
    police.placeHeliForShot(25, 18, 16, 0);
    S.inSight = true;
    S.searchZone = 55; // mid-chase: the ring is drawn wide on the minimap
    S.stageTimer = 126; // 02:06 into the escape stage
    showDialogue('Mara Voss', 'WRENCH · Driver', '#ff5d8f', 'Bridge is hot — punch it, Rook! I\'ll hold the tail.', 30);
    crew.teleportBeside(-60, 0);
    screens.hideAll();
    return { ready: true };
  }

  if (shot === 'combat') {
    // Night (21:30) on Neon Quay's commercial strip, on foot vs the
    // Dredgers, crew flanking Rook — the NEON QUAY sign glows at the end
    // of the road, shopfronts and lit windows line both sides, lamps and
    // the muzzle flash carry the frame. (Was: golden hour in a warehouse
    // yard — no commercial character at all.)
    S.clock = 21.5;
    S.cash = 12300; S.day = 7; S.rep = 310;
    S.jobsDone = ['j1', 'j2', 'j3', 'j4', 'j5', 'j6'];
    S.health = 68; S.armour = 25;
    S.ownedWeapons = [0, 1, 2, 3];
    S.ammo = [{ mag: Infinity, reserve: Infinity }, { mag: 9, reserve: 60 }, { mag: 22, reserve: 96 }, { mag: 5, reserve: 18 }, { mag: 30, reserve: 90 }];
    S.weaponIndex = 2;
    recruitAll();
    missions.startJob('j7');
    S.stageIndex = 1; // the kill stage: Stop the arson crew (5)
    missions.enterStageForShot();
    // Enemies closer to the camera: the j7 spawn (-68,-262 ±18 m) left
    // them 30-50 m out — small, unmarked, lost against the club (v3).
    // Five fixed spots 10-27 m ahead of Rook, spread across the road:
    // a near line (3) the camera can read, a far line (2) for depth.
    // Same staging pattern as the police/traffic placement below; the
    // kill count and the mission logic are untouched. NOBODY stands on
    // the centre line (x -76): the staged firing aims straight ahead
    // and the first try's centre enemy died before the capture frame
    // ("Dredgers left: 4" vs the "Five outside the club" line).
    const ENEMY_SPOTS = [[-79, -241], [-69, -243], [-73, -239], [-83, -252], [-63, -254]];
    combat.enemies.forEach((e, i) => {
      const [ex, ez] = ENEMY_SPOTS[i % ENEMY_SPOTS.length];
      e.x = ex; e.z = ez;
      e.mesh.position.set(ex, 0, ez);
    });
    player.teleport(-76, -230, Math.PI); // on the Quay road, facing the NEON QUAY sign
    // Rook scaled up for the combat frame only (1.35 vs the 1.05 he
    // ships with — 1.29x, ~175 px to ~225 px): the same staging-scale
    // trick as the title shot (v6), which worked without distortion.
    // Combat is the last shot still losing thin to R3 (~300 px player
    // over-shoulder, daytime, dynamic pose). The mesh origin is at
    // ground level, so his feet stay planted; nothing in the player
    // update touches mesh.scale, so the scale survives the staging
    // frames. The muzzle flash and tracer heights in main.js track
    // this scale (relative mesh scale), so the flash stays at the
    // gun's shoulder height instead of dropping to his waist.
    // Gameplay is untouched — this branch only runs with ?shot=combat.
    if (player.p.mesh) player.p.mesh.scale.setScalar(1.35);
    player.p.camPitch = 0.18; // shallow: the sign stays in frame above the street
    // Closer chase camera (7 m vs the default 9 m): Rook reads ~200 px
    // tall instead of ~120 px — R1's player is ~250 px, R3's ~300 px,
    // both over-shoulder, and the v4 combat shot lost K1 on player
    // presence alone. 6 m was tried first: Rook hit ~250 px but his
    // feet left the frame and the flanking crew became cropped
    // foreground blobs at the frame edges. The signs, the club fire
    // and the 5 red-marked enemies are all 10 m+ ahead, so they stay
    // in frame; the muzzle flash offset (main.js) is unchanged.
    // v6 note: 6.5 m was tried BEFORE the formation fix and reverted
    // — it only enlarged the crew member standing between the camera
    // and Rook, not Rook himself. With the formation fixed (nobody on
    // the view axis behind Rook), 6.5 m is kept: Rook grows to ~175 px
    // with his feet still in frame and the flankers clear of the HUD.
    player.p.camDist = 6.5;
    // One star of heat, 3 units pinned on nearby roads (the full 1-star
    // target, so no random unit can spawn onto the player mid-shot).
    police.addWanted(1, '');
    police.placeUnitAt(-152, -230, -76, -230);
    police.placeUnitAt(0, -230, -76, -230);
    police.placeUnitAt(-76, -290, -76, -230);
    // Parked cars flanking the Quay road: the night street needs mass
    // between the player and the sign, and the firefight needs cover.
    for (const [x, z, modelId] of [[-82, -245, 'egret'], [-70, -272, 'cormorant'], [-70, -252, 'osprey'], [-82, -268, 'tern'], [-70, -285, 'sunbeam']]) {
      const c = traffic.spawnCar(x, z, Math.PI, modelById(modelId));
      c.parked = true; c.speed = 0; c.targetSpeed = 0;
    }
    // Bystanders fleeing the firefight — they run from the gunfire, so
    // the night street reads as a live scene, not a diorama.
    for (const [x, z] of [[-86, -250], [-67, -248], [-86, -272], [-67, -278]])
      peds.spawnPed(x, z, { fleeing: 30, fleeFrom: { x: -76, z: -230 } });
    S.searchZone = 30;
    S.stageTimer = 84; // 01:24 into the kill stage
    showDialogue('Sana Reyes', 'FARSHOT · Lookout', '#ffd166', 'Five outside the club. I\'ve got the far one — go loud.', 30);
    // Crew formation for the combat frame (v6): Mara and Sana flank
    // behind Rook as in v5, but Ivo — who stood dead centre 3 m
    // behind Rook and hid him from the camera, so the big blue figure
    // in the v5 shot was Ivo, not Rook — advances 6 m ahead-right
    // toward the Dredgers on a HOLD order, so Rook reads whole and
    // the crew visibly fights beside him. HOLD freezes Ivo exactly
    // where placed (crew.js: HOLD means speed 0); it also puts a
    // second order state in the crew panel (FOLLOW / HOLD), which is
    // the orders system showing itself. An over-shoulder lateral
    // camera offset (camSide 1.2, camAhead 6) was tried first and
    // REVERTED: with Ivo on the axis it un-occluded him into a giant
    // cropped foreground blob and hid Rook behind the three crew
    // backs — worse than v5 in every way.
    crew.members[0].x = -79; crew.members[0].z = -227;
    crew.members[0].mesh.position.set(-79, 0, -227);
    crew.members[1].x = -70; crew.members[1].z = -236;
    crew.members[1].mesh.position.set(-70, 0, -236);
    crew.members[1].heading = Math.PI;
    crew.members[2].x = -73; crew.members[2].z = -227;
    crew.members[2].mesh.position.set(-73, 0, -227);
    S.crew[1].order = 'HOLD';
    screens.hideAll();
    return { ready: true };
  }

  if (shot === 'map') {
    S.clock = 12.0;
    S.cash = 31200; S.day = 12; S.rep = 520;
    S.jobsDone = ['j1', 'j2', 'j3', 'j4', 'j5'];
    S.cachesFound = cachesIds(9);
    S.propertiesOwned = ['anchor'];
    // A lived-in mid-game save: the stats behind the map screen's skills
    // strip (driving/shooting/stamina/stealth/influence/street sense)
    // and the 53% completion figure — all derived, never hard-coded.
    Object.assign(S.stats, {
      kills: 18, shotsFired: 320, shotsHit: 210, distanceDriven: 18000,
      distanceWalked: 9000, moneyEarned: 45000, carsStolen: 3,
      racesWon: 1, faresDone: 4, stunts: 1, missionsDone: 5,
    });
    recruitAll();
    missions.startJob('j6');
    S.stageIndex = 1;
    missions.enterStageForShot();
    player.teleport(0, 0, 0);
    S.playerX = 0; S.playerZ = 0; // the map screen is frozen, so the loop never updates these
    screens.openMap({ x: 0, z: 0 });
    return { ready: true };
  }

  return { ready: false };
}

function cachesIds(n) {
  const out = [];
  for (let i = 1; i <= n; i++) out.push(`cache-${String(i).padStart(2, '0')}`);
  return out;
}

export function shotFromURL() {
  const params = new URLSearchParams(window.location.search);
  const shot = params.get('shot');
  if (SHOT_NAMES.includes(shot)) return shot;
  return null;
}

export function selftestFromURL() {
  return new URLSearchParams(window.location.search).get('selftest') === '1';
}
