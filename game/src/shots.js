// KESTREL LAGOON — screenshot staging. Every shot is real game state:
// a seeded world, a real mission, real wanted level, real crew — staged
// through the same code paths the player uses. Nothing here is an overlay.
import { S, freshState, saveToSlot, showDialogue } from './state.js';

export const SHOT_NAMES = ['cover', 'title', 'combat', 'map'];

function recruitAll() {
  for (const c of S.crew) c.recruited = true;
}

function richLoadout() {
  S.ownedWeapons = [0, 1, 2, 3, 4];
  S.ammo = [{ mag: Infinity, reserve: Infinity }, { mag: 12, reserve: 84 }, { mag: 28, reserve: 140 }, { mag: 6, reserve: 24 }, { mag: 30, reserve: 120 }];
}

export function stageShot(shot, ctx) {
  const { missions, crew, police, combat, driving, player, screens } = ctx;
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
    driving.spawnPlayerCar('peregrine', -60, 0, Math.PI / 2);
    driving.getCar().speed = 41;
    S.speedKmh = 148;
    S.vehicleHealth = 71;
    police.addWanted(4, '');
    // Pre-place the full 4-star pursuit (6 units) at fixed road points, so
    // the update loop spawns nothing random and the frame is identical per run.
    for (const [x, z] of [[-25, 0], [10, 0], [45, 0], [-100, 0], [-140, 0], [-180, 0]])
      police.placeUnitAt(x, z, -60, 0);
    police.spawnHeliForShot();
    S.inSight = true;
    S.searchZone = 55; // mid-chase: the ring is drawn wide on the minimap
    S.stageTimer = 126; // 02:06 into the escape stage
    showDialogue('Mara Voss', 'WRENCH · Driver', '#ff5d8f', 'Bridge is hot — punch it, Rook! I\'ll hold the tail.', 30);
    crew.teleportBeside(-60, 0);
    screens.hideAll();
    return { ready: true };
  }

  if (shot === 'combat') {
    // Night, on foot, vs the Dredgers, crew flanking Rook.
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
    player.teleport(-356, 150, -Math.PI / 2);
    // One star of heat, 3 units pinned on nearby roads (the full 1-star
    // target, so no random unit can spawn onto the player mid-shot).
    police.addWanted(1, '');
    police.placeUnitAt(-396, 120, -356, 150);
    police.placeUnitAt(-440, 120, -356, 150);
    police.placeUnitAt(-360, 95, -356, 150);
    S.searchZone = 30;
    S.stageTimer = 84; // 01:24 into the kill stage
    showDialogue('Sana Reyes', 'FARSHOT · Lookout', '#ffd166', 'Five on the warehouse. I\'ve got the far one — go loud.', 30);
    crew.teleportBeside(-356, 150);
    screens.hideAll();
    return { ready: true };
  }

  if (shot === 'map') {
    S.clock = 12.0;
    S.cash = 31200; S.day = 12; S.rep = 520;
    S.jobsDone = ['j1', 'j2', 'j3', 'j4', 'j5'];
    S.cachesFound = cachesIds(9);
    S.propertiesOwned = ['anchor'];
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
