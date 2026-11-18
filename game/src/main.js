// KESTREL LAGOON — main: boots every system in dependency order, runs the
// frame loop, routes input actions, expires timed UI, handles death and
// respawn, and drives the ?shot= staging and the ?selftest= scripted check.
import * as THREE from 'three';
import { S, freshState, resetState, loadFromSlot, saveToSlot, loadSettings, saveSettings } from './state.js';
import { createInput, weaponSlotOf, ACT_ENTER, ACT_RELOAD, ACT_MAP, ACT_PAUSE, ACT_INTERACT, ACT_RADIO_PREV, ACT_CAMERA, ACT_CREW_CYCLE, ACT_CREW_ABILITY, ACT_CREW_SELECT } from './input.js';
import { createAudio } from './audio.js';
import { createRender } from './render.js';
import { buildCity } from './city.js';
import { createTraffic } from './vehicles.js';
import { createPedestrians } from './pedestrians.js';
import { createPlayer } from './player.js';
import { createDriving } from './driving.js';
import { createPolice } from './police.js';
import { createCombat } from './combat.js';
import { createCrew } from './crew.js';
import { createMissions } from './missions.js';
import { createActivities } from './activities.js';
import { createHud } from './hud.js';
import { createScreens } from './screens.js';
import { stageShot, shotFromURL, selftestFromURL } from './shots.js';

window.__errors = [];
window.addEventListener('error', (e) => window.__errors.push(String(e.message || e.error)));
window.addEventListener('unhandledrejection', (e) => window.__errors.push('rejection: ' + String(e.reason)));

const canvas = document.getElementById('game-canvas');
const render = createRender(canvas);
const { scene, camera } = render;

// Warm stage light for the title shot only: at sunset the sun sits WSW
// behind the title camera, so Rook's camera-facing side is lit only by
// the hemisphere light and he renders as a dark silhouette (v4) — while
// R1/R3's protagonists are bright and detailed. A point light between
// the camera and Rook lifts his front without touching the rest of the
// scene (30 m cutoff; the ferris wheel is ~50 m out, the sky untouched).
const titleLight = new THREE.PointLight(0xffd9a0, 60, 30, 2);
titleLight.position.set(228, 4.5, 282);
titleLight.visible = false;
scene.add(titleLight);
const audio = createAudio();
const input = createInput(canvas);
loadSettings();

const city = buildCity(scene, 1);
render.bindLamps(city.dynamic.bulbMat);
render.bindFacades(city.dynamic.facadeMats);
const traffic = createTraffic(scene, 1, city.colliders);
const peds = createPedestrians(scene, 1, city.colliders);
const playerObj = createPlayer(scene);
const police = createPolice(scene, city.colliders, audio);
const driving = createDriving(scene, traffic, peds, audio, police);
const combat = createCombat(scene, camera, audio, police, peds);
const crew = createCrew(scene, city.colliders, driving, police);
const missions = createMissions({ city, driving, combat, police, crew, traffic, audio });
const activities = createActivities({ city, driving, police, audio });
const hud = createHud({ police, combat, crew });
const screens = createScreens({ missions, activities, audio });

const ctx = { city, traffic, peds, player: playerObj, driving, police, combat, crew, missions, activities, hud, screens, audio, input, render };

let lastTime = performance.now() / 1000;
let titleOrbit = 0;
let shotName = shotFromURL();
let selftest = selftestFromURL();
let shotFrames = 0;
let deathTimer = 0;

// Self-test state (declared up here: startSelftest runs during boot, below).
let stSteps = [];
let stIndex = 0;
let stWaitFrames = 0; // frames left before the current step is checked
let stResults = [];
let stSavedCash = 0;

screens.onStartGame = (fresh) => {
  if (fresh) {
    resetState();
    playerObj.teleport(-200, 140, Math.PI * 0.25);
    crew.teleportBeside(-200, 140);
  } else {
    loadFromSlot(0);
    playerObj.teleport(-210, 150, Math.PI * 0.25);
    crew.teleportBeside(-210, 150);
  }
  audio.start();
  screens.hideAll();
  saveSettings();
};
screens.onResume = () => { /* loop continues */ };
screens.onQuitToTitle = () => { saveSettings(); };
screens.wire();
screens.renderTitle();
screens.show('title-screen');

// --- Shot staging / self-test -------------------------------------------------
if (shotName) {
  stageShot(shotName, ctx);
  if (shotName === 'cover') input.hold('KeyW', true);
}
if (selftest) {
  screens.hideAll();
  startSelftest();
}

window.addEventListener('resize', () => render.resize());

function expireTimedUI(now) {
  if (S.dialogue && now > S.dialogue.until) S.dialogue = null;
  if (S.banner && now > S.banner.until) S.banner = null;
  if (S.toast && now > S.toast.until) S.toast = null;
}

function handleActions(actions) {
  const slot = weaponSlotOf(actions);
  if (slot >= 0) combat.switchWeapon(slot);
  if (actions & ACT_ENTER) {
    if (S.inCar) {
      const spot = driving.exitCar();
      if (spot) playerObj.teleport(spot.x, spot.z, playerObj.p.heading);
    } else {
      const near = traffic.nearestCar(playerObj.p.x, playerObj.p.z, 5, null);
      if (near) {
        driving.enterCar(near);
        playerObj.p.x = near.x; playerObj.p.z = near.z;
      }
    }
  }
  if (actions & ACT_RELOAD) combat.reload();
  if (actions & ACT_MAP) {
    if (S.screen === 'map') screens.hideAll();
    else if (S.screen === 'game') screens.openMap({ x: playerObj.p.x, z: playerObj.p.z });
  }
  if (actions & ACT_PAUSE) {
    if (S.screen === 'game') screens.show('pause-screen');
    else if (S.screen === 'pause') screens.hideAll();
    else if (S.screen === 'map') screens.hideAll();
    else if (S.screen === 'controls' || S.screen === 'settings' || S.screen === 'stats') screens.show('title-screen');
  }
  if (actions & ACT_INTERACT) {
    const pos = { x: playerObj.p.x, z: playerObj.p.z };
    const shop = activities.nearestShop(pos);
    if (shop) activities.useShop(shop);
    else {
      const near = missions.nearestAvailableJob(pos);
      if (near && near.dist < 15) missions.startJob(near.job.id);
    }
  }
  if (actions & ACT_RADIO_PREV) {
    S.radioIndex = (S.radioIndex + 1) % 3;
    S.radioTrack = 0;
    audio.radioSwitch();
  }
  if (actions & ACT_CAMERA) S.cameraMode = (S.cameraMode + 1) % 2;
  if (actions & ACT_CREW_CYCLE) crew.cycleOrder();
  if (actions & ACT_CREW_ABILITY) crew.ability();
  if (actions & ACT_CREW_SELECT) S.crewSelected = (S.crewSelected + 1) % 3;
}

function frame() {
  requestAnimationFrame(frame);
  window.__frames = (window.__frames || 0) + 1;
  const now = performance.now() / 1000;
  const dt = Math.min(0.05, Math.max(0.001, now - lastTime));
  lastTime = now;

  const inGame = S.screen === 'game';
  const frozen = !inGame && S.screen !== 'title';

  // The title stage light is on only for the staged title shot — never
  // in normal play (orbit title) or in game.
  titleLight.visible = S.screen === 'title' && shotName === 'title';

  // Timed UI expiry runs everywhere.
  expireTimedUI(now);

  // Shot readiness: after enough FRAMES (not wall time — headless runs slow),
  // flag the capture script so the camera has settled and the chase has formed.
  // This runs before the title early-return: the title shot needs it too.
  if (shotName && !window.__shotReady) {
    shotFrames++;
    if (shotName === 'combat' && shotFrames % 4 === 0) {
      // Keep the firefight live while staging.
      const pp = playerObj.p;
      const dir = combat.aimDirection(pp.camYaw);
      combat.fire({ x: pp.x + dir.x * 1.2, y: 1.5, z: pp.z + dir.z * 1.2 }, dir, false);
    }
    const needFrames = (shotName === 'title' || shotName === 'map') ? 4 : 16;
    if (shotFrames >= needFrames) {
      if (shotName === 'combat') {
        // Fire, then hold the muzzle flash lit so it is in the captured frame.
        // Offset to the shooter's right-hand side: a flash dead ahead sits
        // behind the player's head from the chase camera (probe: it projected
        // to screen (640,306), inside the head silhouette). 1.0 m to the
        // right puts the flash clear of the body at shoulder height.
        const pp = playerObj.p;
        const dir = combat.aimDirection(pp.camYaw);
        const rx = -dir.z, rz = dir.x; // right-hand side of the aim
        combat.fire({ x: pp.x + dir.x * 1.2, y: 1.5, z: pp.z + dir.z * 1.2 }, dir, false);
        combat.forceMuzzle({ x: pp.x + dir.x * 1.6 + rx * 1.0, y: 1.55, z: pp.z + dir.z * 1.6 + rz * 1.0 });
      }
      if (shotName === 'cover') input.hold('KeyW', false);
      window.__shotReady = true;
      window.__shotName = shotName;
    }
  }
  // After the combat shot is flagged, keep the muzzle lit on every frame:
  // at ~1 fps the capture may land on a later frame than the flag frame.
  if (shotName === 'combat' && window.__shotReady) {
    const pp = playerObj.p;
    const dir = combat.aimDirection(pp.camYaw);
    const rx = -dir.z, rz = dir.x;
    combat.forceMuzzle({ x: pp.x + dir.x * 1.6 + rx * 1.0, y: 1.55, z: pp.z + dir.z * 1.6 + rz * 1.0 });
  }

  if (S.screen === 'title') {
    if (shotName === 'title') {
      // Staged title: street level on the marina road, Rook + his
      // Peregrine in the foreground, the ferris wheel looming behind
      // them against the sunset sky. (v3 was a 70 m aerial of the whole
      // city — no character, no car, no wheel.) Low camera (y 2.5) on
      // the x=228 road at (228,2.5,280): Rook 7 m out reads ~180 px
      // tall with his feet still in frame (a higher camera cut them
      // off at this distance), the wheel 51 m out, near face-on (its
      // disc faces ±z). The sun disc itself is behind the camera (WSW)
      // — the sunset reads through the orange sky gradient and the warm
      // light, as in R3's title. The DOM leaves the centre of the frame
      // clear for this stage (see style.css).
      camera.position.set(228, 2.5, 280);
      camera.lookAt(238, 9, 335);
    } else {
      // Slow orbit over the city behind the title screen.
      titleOrbit += dt * 0.03;
      camera.position.set(Math.cos(titleOrbit) * 170, 55, Math.sin(titleOrbit) * 170);
      camera.lookAt(0, 0, 0);
    }
    traffic.update(dt, { x: 0, z: 0 }, null);
    peds.update(dt, null, { x: 0, z: 0 });
    render.applyTimeOfDay(activities.sunPosition(), activities.isNight(), activities.isSunset());
    render.render();
    return;
  }

  if (!frozen) {
    const actions = input.takeActions();
    if (inGame) handleActions(actions);

    const pp = playerObj.p;
    // Movement: on foot or driving.
    if (S.inCar) {
      driving.update(dt, input, city.colliders, false);
      const car = driving.getCar();
      if (car) { pp.x = car.x; pp.z = car.z; }
    } else {
      playerObj.update(dt, input, city.colliders, false);
    }
    S.playerX = pp.x; S.playerZ = pp.z;
    const playerPos = { x: pp.x, z: pp.z };

    // Firing (mouse held): on foot, or drive-by from the car.
    if (inGame && input.firing) {
      const dir = combat.aimDirection(pp.camYaw);
      const origin = S.inCar
        ? { x: pp.x + dir.x * 2, y: 1.4, z: pp.z + dir.z * 2 }
        : { x: pp.x + dir.x * 1.2, y: 1.5, z: pp.z + dir.z * 1.2 };
      combat.fire(origin, dir, S.inCar);
    }

    // World systems.
    const gunfire = combat.gunfireAt;
    traffic.update(dt, playerPos, gunfire);
    peds.update(dt, gunfire, playerPos);
    police.update(dt, playerPos, S.speedKmh);
    combat.update(dt, playerPos);
    crew.update(dt, playerPos, S.inCar, combat.enemies);
    missions.update(dt, playerPos);
    activities.updateClock(dt);
    activities.updateRace(dt, playerPos);
    activities.updateTaxi(dt, playerPos);
    activities.checkCaches(playerPos);
    audio.update(dt, S.speedKmh, S.wanted);

    // Camera + sky.
    const car = driving.getCar();
    playerObj.updateCamera(dt, camera, car ? { x: car.x, z: car.z } : null, car ? car.heading : undefined);
    render.applyTimeOfDay(activities.sunPosition(), activities.isNight(), activities.isSunset());

    // Death + respawn.
    if (S.health <= 0) {
      deathTimer += dt;
      if (deathTimer > 1.5) {
        deathTimer = 0;
        S.stats.deaths += 1;
        const lost = Math.floor(S.cash * 0.1);
        S.cash -= lost;
        S.health = 100; S.armour = 0;
        police.clearAll();
        combat.clearEnemies();
        driving.destroyCar();
        playerObj.teleport(-210, 150, 0);
        crew.teleportBeside(-210, 150);
        S.banner = { text: 'WASTED', sub: `The lagoon keeps $${lost.toLocaleString()} of your cash.`, until: now + 3 };
      }
    }

    // HUD.
    if (inGame) hud.update(playerPos, S.inCar && car ? car.heading : pp.camYaw);
    // Ferris wheel + water drift.
    if (city.dynamic.wheel) city.dynamic.wheel.rotation.z += dt * 0.12;
    if (city.dynamic.water) { city.dynamic.water.position.x = Math.sin(now * 0.05) * 2; }
    if (city.dynamic.beaconRing) city.dynamic.beaconRing.rotation.z += dt;
  }

  render.render();

  if (selftest) stepSelftest(now);
  if (!window.__gameReady) window.__gameReady = true;
}

// --- Self-test: scripted checks, results on window.__selftest ------------------
function startSelftest() {
  const pp = playerObj.p;
  // Waits are in FRAMES: headless SwiftShader runs ~1 fps, so wall-clock waits
  // would check before the world had moved (dt is clamped to 0.05 s/frame).
  const step = (name, setup, check, waitFrames = 3) => stSteps.push({ name, setup, check, waitFrames });
  step('boot', () => {}, () => city.colliders.length > 50 && traffic.cars.length > 20 && peds.peds.length > 20, 2);
  step('walk', () => { input.hold('KeyW', true); }, () => {
    input.hold('KeyW', false);
    return Math.hypot(pp.x - (-200), pp.z - 140) > 2;
  }, 12);
  step('enter-car', () => {
    const car = traffic.cars.find((c) => c.parked) || traffic.cars[0];
    playerObj.teleport(car.x + 3, car.z, 0);
    input.inject('KeyF');
  }, () => S.inCar, 4);
  step('drive', () => { input.hold('KeyW', true); }, () => {
    input.hold('KeyW', false);
    return S.speedKmh > 15;
  }, 20);
  step('exit-car', () => { input.inject('KeyF'); }, () => !S.inCar, 4);
  step('shoot', () => {
    combat.switchWeapon(1);
    const dir = combat.aimDirection(pp.camYaw);
    combat.fire({ x: pp.x, y: 1.5, z: pp.z }, dir, false);
  }, () => S.stats.shotsFired >= 1 && S.wanted >= 1, 2);
  step('wanted-clear', () => { police.clearAll(); }, () => S.wanted === 0, 2);
  step('mission-advance', () => {
    missions.startJob('j1');
    playerObj.teleport(-210, 150, 0);
  }, () => S.stageIndex >= 1, 4);
  step('save-load', () => {
    stSavedCash = S.cash;
    saveToSlot(1);
    S.cash = 999999;
    loadFromSlot(1);
    screens.hideAll(); // load resets S.screen to 'title'; come back to the game
  }, () => S.cash === stSavedCash, 2);
  step('map', () => { screens.openMap({ x: pp.x, z: pp.z }); }, () => S.screen === 'map', 2);
  step('map-close', () => { screens.hideAll(); }, () => S.screen === 'game', 2);
  step('pause', () => { screens.show('pause-screen'); }, () => S.screen === 'pause', 2);
  step('pause-close', () => { screens.hideAll(); }, () => S.screen === 'game', 2);
  step('crew-recruit', () => { crew.recruit('mara'); }, () => S.crew[0].recruited === true, 2);
  step('crew-ability', () => {
    S.crewSelected = 0;
    crew.ability();
  }, () => S.inCar && driving.getCar() !== null, 3);
  step('cache', () => {
    driving.destroyCar();
    playerObj.teleport(-210, 150, 0);
  }, () => S.cachesFound.includes('cache-01'), 4);
  step('no-errors', () => {}, () => window.__errors.length === 0, 1);
  stWaitFrames = 2;
  window.__selftest = { done: false, passed: 0, failed: 0, checks: [] };
}

function stepSelftest(now) {
  void now;
  if (stIndex >= stSteps.length) {
    if (!window.__selftest.done) {
      window.__selftest.done = true;
      window.__selftest.passed = stResults.filter((r) => r.pass).length;
      window.__selftest.failed = stResults.filter((r) => !r.pass).length;
      window.__selftest.checks = stResults;
      window.__selftest.errors = window.__errors.slice();
    }
    return;
  }
  const step = stSteps[stIndex];
  if (!step.started) {
    if (stWaitFrames > 0) { stWaitFrames--; return; }
    step.started = true;
    try { step.setup(); } catch (e) { stResults.push({ name: step.name, pass: false, error: String(e) }); stIndex++; stWaitFrames = 1; return; }
    stWaitFrames = step.waitFrames;
    return;
  }
  if (stWaitFrames > 0) { stWaitFrames--; return; }
  let pass = false;
  try { pass = !!step.check(); } catch (e) { pass = false; }
  stResults.push({ name: step.name, pass });
  window.__selftest.checks = stResults.slice();
  window.__selftest.step = stIndex + 1;
  window.__selftest.total = stSteps.length;
  stIndex++;
  stWaitFrames = 1;
}

requestAnimationFrame(frame);
