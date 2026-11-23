// KESTREL LAGOON — main: boots every system in dependency order, runs the
// frame loop, routes input actions, expires timed UI, handles death and
// respawn, and drives the ?shot= staging and the ?selftest= scripted check.
import * as THREE from 'three';
import { S, freshState, resetState, loadFromSlot, saveToSlot, loadSettings, saveSettings, showToast } from './state.js';
import { createInput, weaponSlotOf, ACT_ENTER, ACT_RELOAD, ACT_MAP, ACT_PAUSE, ACT_INTERACT, ACT_RADIO_PREV, ACT_CAMERA, ACT_CREW_CYCLE, ACT_CREW_ABILITY, ACT_CREW_SELECT, ACT_GRAPHICS, ACT_HORN } from './input.js';
import { createAudio } from './audio.js';
import { createRender } from './render.js';
import { buildCity, nearestRoadPoint } from './city.js';
import { createTraffic } from './vehicles.js';
import { createPedestrians } from './pedestrians.js';
import { createPlayer } from './player.js';
import { createDriving } from './driving.js';
import { createPolice } from './police.js';
import { createCombat } from './combat.js';
import { createWheel } from './wheel.js'; // v8d P1 #20: radial weapon wheel
import { createCrew } from './crew.js';
import { createMissions } from './missions.js';
import { createActivities } from './activities.js';
import { createHud } from './hud.js';
import { createScreens } from './screens.js';
import { createTouchControls } from './touch.js';
import { createWeather } from './weather.js';
import { createGraphics, PRESETS } from './graphics.js';
import { createBloom } from './bloom.js';
import { createLights } from './lights.js';
import { createStores } from './stores.js';
import { stageShot, shotFromURL, selftestFromURL } from './shots.js';

window.__errors = [];
window.addEventListener('error', (e) => window.__errors.push(String(e.message || e.error)));
window.addEventListener('unhandledrejection', (e) => window.__errors.push('rejection: ' + String(e.reason)));

const canvas = document.getElementById('game-canvas');
const render = createRender(canvas);
const { scene, camera } = render;

// v8c #18: bloom, behind the graphics preset (Ultra only), DEFAULT OFF.
// The post hook is always set; with bloom disabled its render() is a
// no-op, so the staged captures run the exact pre-v8c render path.
const bloom = createBloom(render.renderer);
render.setPostRenderer(() => bloom.render());

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
const touch = createTouchControls(input); // null on non-touch devices
loadSettings();

const city = buildCity(scene, 1);
render.bindLamps(city.dynamic.bulbMat);
render.bindFacades(city.dynamic.facadeMats);
// v8c #19: the light budget — pooled streetlights, the actor lamp and
// the car headlights. All start at intensity 0; update() (gated to
// normal play, below) fades them in with the dark.
const lights = createLights(scene, city.lampSpots);
const traffic = createTraffic(scene, 1, city.colliders);
const peds = createPedestrians(scene, 1, city.colliders);
const playerObj = createPlayer(scene);
const police = createPolice(scene, city.colliders, audio);
const driving = createDriving(scene, traffic, peds, audio, police);
const combat = createCombat(scene, camera, audio, police, peds);
police.setCombat(combat); // v8d #3: foot cops + the heli gunner shoot via combat
police.setPeds(peds); // v8d P1 #18R: the witness check needs the live civilians
// v8d P1 #20: the weapon wheel — hold Tab to open, release to equip.
// switchWeapon owns the unowned-weapon refusal + the switch toast.
const wheel = createWheel({
  getState: () => ({ owned: S.ownedWeapons, index: S.weaponIndex, ammo: S.ammo }),
  onSelect: (slot) => combat.switchWeapon(slot),
});
const crew = createCrew(scene, city.colliders, driving, police);
const missions = createMissions({ city, driving, combat, police, crew, traffic, audio });
const activities = createActivities({ city, driving, police, audio });
const hud = createHud({ police, combat, crew });
const screens = createScreens({ missions, activities, audio });
const weather = createWeather(scene, audio);
// v8c #14: walk-in shops — roadside doors + furnished interiors.
const stores = createStores(scene, { player: playerObj, audio });

// v8c #20: graphics presets + adaptive resolution. The apply callback is
// the one place a preset touches the world: pixel ratio, bloom (#18),
// rain density and the streetlight pool size (#19). The default preset
// (High) reproduces the pre-v8c behaviour exactly — pixel ratio capped
// at 1.5, bloom off, full rain — so staging and the self-test are
// untouched by this module's existence.
const graphics = createGraphics((def, scale) => {
  render.setPixelRatio(scale);
  bloom.setEnabled(def.bloom);
  bloom.resize();
  weather.setDensity(def.rain);
  lights.setPoolSize(def.lights);
});
graphics.setPreset(S.graphics);
screens.setGraphics(graphics);

const ctx = { city, traffic, peds, player: playerObj, driving, police, combat, crew, missions, activities, hud, screens, audio, input, render };

// Read-only probe hook for the CDP verification scripts (same pattern as
// window.__selftest / __shotReady): lets a probe confirm the player moved,
// the touch layer is live, or the weather is raining, without reaching
// into module internals.
window.__probe = {
  player: () => ({ x: playerObj.p.x, z: playerObj.p.z, y: Math.round(playerObj.p.y * 100) / 100 }),
  camYaw: () => playerObj.p.camYaw,
  camera: () => ({ x: camera.position.x, y: camera.position.y, z: camera.position.z }),
  speedKmh: () => S.speedKmh,
  screen: () => S.screen,
  inCar: () => S.inCar,
  touch: () => (touch ? touch.state() : null),
  weather: () => weather.state(),
  graphics: () => graphics.state(),
  bloom: () => bloom.state(),
  lights: () => lights.state(),
  lock: () => combat.lockTarget,
  fov: () => playerObj.p.fov,
  stores: () => stores.state(),
  // v8d: wanted level, unit states, ram log, foot cops, bust state.
  police: () => police.probeState(),
  // v8d: health + the live banner (BUSTED / WASTED) for the probe.
  hp: () => S.health,
  banner: () => (S.banner ? S.banner.text : null),
  // v8d #8: mission state + the fail sequence for the soft-lock probe.
  mission: () => ({ active: S.jobActive, id: missions.currentJobId(),
    stage: S.stageIndex, kills: S.stageKills, fail: missions.failState(),
    enemies: combat.enemies.length }),
  // v8d #10: car damage stage for the damage probe.
  car: () => driving.probeState(),
  // v8d #11: enemy HP + headshot count for the headshot probe.
  combat: () => combat.probeState(),
  // v8d #12: fleeing peds for the horn probe.
  // v8d P1 #18R: live ped positions for the witness probe (finding an
  // empty spot, and a ped to stand next to).
  peds: () => ({ fleeing: peds.peds.filter((p) => p.fleeing > 0).length, total: peds.peds.length,
    live: peds.peds.filter((p) => !p.dead).map((p) => ({ x: Math.round(p.x), z: Math.round(p.z) })) }),
  // v8d #13: weapons + cash for the BUSTED probe (confiscation check).
  weapons: () => ({ owned: S.ownedWeapons.slice(), index: S.weaponIndex, cash: S.cash,
    ammo: S.ammo.map((a) => ({ mag: a.mag, reserve: a.reserve })) }), // v8d P1 #19: ammo for the grenade probe
  // v8d #14: nearest PARKED car for the ram probe (homing + carjack).
  // Parked only — a moving traffic car cannot be caught on foot.
  nearestCar: () => {
    let best = null, bd = 250;
    for (const c of traffic.cars) {
      if (!c.parked) continue;
      const d = Math.hypot(c.x - playerObj.p.x, c.z - playerObj.p.z);
      if (d < bd) { bd = d; best = c; }
    }
    return best ? { x: Math.round(best.x), z: Math.round(best.z), dist: Math.round(bd) } : null;
  },
  // v8d #14: CDP-verification hooks for the soft-lock probe — the same
  // powers the in-game self-test already uses internally (startJob +
  // teleport), exposed so an external probe can put the player in a
  // kill stage without playing two whole jobs first. Not reachable
  // from gameplay (CDP Runtime.evaluate only).
  startJob: (id) => { missions.startJob(id); return missions.currentJobId(); },
  teleport: (x, z) => { playerObj.teleport(x, z, 0); return { x: playerObj.p.x, z: playerObj.p.z }; },
  // v8d P1 #18R: CDP-verification hooks for the witness probe — clear
  // the wanted level (so a reported shot can be retried clean) and
  // place a cop unit on the nearest road (the only way to have a cop
  // present while clean: live units stand down and drive off at
  // 0 stars). Not reachable from gameplay (CDP Runtime.evaluate only).
  clearWanted: () => { police.clearAll(); return S.wanted; },
  spawnCop: (x, z) => { police.placeUnitAt(x, z, playerObj.p.x, playerObj.p.z, {}); return police.probeState().units.length; },
  // v8d P1 #20: weapon state + the wheel for the grenade/wheel probes.
  wheel: () => wheel.probeState(),
  // (buying through Harbor Arms needs cash the probe does not have).
  // Not reachable from gameplay (CDP Runtime.evaluate only).
  giveWeapon: (i) => {
    if (i < 0 || i >= 6) return null;
    if (!S.ownedWeapons.includes(i)) S.ownedWeapons.push(i);
    combat.switchWeapon(i);
    return { owned: S.ownedWeapons.slice(), index: S.weaponIndex };
  },
};

let lastTime = performance.now() / 1000;
let titleOrbit = 0;
let shotName = shotFromURL();
let selftest = selftestFromURL();
// Staging and the self-test always run the High preset: a deterministic
// capture must never depend on a saved Ultra setting (bloom on) from an
// earlier session. In-memory only — nothing here persists the override.
if (shotName || selftest) { S.graphics = 'high'; graphics.setPreset('high'); }
// v8d: staged captures run the pre-v8d police behaviour exactly, so the
// four final shots cannot change. The self-test runs live (its 'shoot'
// step needs real heat), so it is NOT staging.
police.setStaging(!!shotName);
driving.setStaging(!!shotName);
let shotFrames = 0;
let deathTimer = 0;
let lastHpSeen = 100; // v8d #9: tracks HP drops (any damage source)
let lastDamageAt = 0; // v8d #9: game seconds of the last HP drop
let lastHonkAt = 0; // v8d #12: horn cooldown (0.6 s)
let prevPlayerPos = null; // previous frame's player position, for the police pursuit lead

// Self-test state (declared up here: startSelftest runs during boot, below).
let stSteps = [];
let stIndex = 0;
let stWaitFrames = 0; // frames left before the current step is checked
let stResults = [];
let stSavedCash = 0;

screens.onStartGame = (fresh) => {
  // A new or continued game never starts inside a shop (v8c #14).
  if (S.interior) stores.exit();
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

window.addEventListener('resize', () => { render.resize(); bloom.resize(); });

function expireTimedUI(now) {
  if (S.dialogue && now > S.dialogue.until) S.dialogue = null;
  if (S.banner && now > S.banner.until) S.banner = null;
  if (S.areaBanner && now > S.areaBanner.until) S.areaBanner = null;
  if (S.toast && now > S.toast.until) S.toast = null;
}

function handleActions(actions) {
  const slot = weaponSlotOf(actions);
  // v8d P1 #20: a number key switches directly AND closes the wheel —
  // the keys stay the fast path even while the wheel is open.
  if (slot >= 0) { combat.switchWeapon(slot); wheel.close(); }
  // v8c #14: while the player is inside a shop, the world-facing
  // position is the shop door (map, jobs, outdoor shop trigger) — the
  // real position is the room at x = 3000.
  const worldPos = S.interior && stores.doorPos()
    ? stores.doorPos()
    : { x: playerObj.p.x, z: playerObj.p.z };
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
    else if (S.screen === 'game') screens.openMap(worldPos);
  }
  // v8d #8: while the retry prompt is up, E retries the failed job
  // and Esc quits it — the normal pause / interact handling below is
  // suppressed so one keypress cannot do two things.
  if (missions.isPrompting()) {
    if (actions & ACT_INTERACT) missions.retryFail();
    else if (actions & ACT_PAUSE) missions.quitFail();
  }
  if (actions & ACT_PAUSE && !missions.isPrompting()) {
    if (S.screen === 'game') screens.show('pause-screen');
    else if (S.screen === 'pause') screens.hideAll();
    else if (S.screen === 'map') screens.hideAll();
    else if (S.screen === 'controls' || S.screen === 'settings' || S.screen === 'stats' || S.screen === 'showroom') screens.show('title-screen');
  }
  if (actions & ACT_INTERACT && !missions.isPrompting()) {
    // v8c #14: at a shop counter inside, E shops there; otherwise the
    // outdoor proximity shop (or a nearby job marker) as before.
    const shop = stores.counterShop({ x: playerObj.p.x, z: playerObj.p.z })
      || activities.nearestShop(worldPos);
    if (shop) activities.useShop(shop);
    else {
      const near = missions.nearestAvailableJob(worldPos);
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
  if (actions & ACT_GRAPHICS) {
    const name = graphics.cyclePreset();
    S.graphics = name;
    saveSettings();
    showToast(`Graphics: ${PRESETS[name].label}`);
  }
  // v8d #12: horn (H / HORN button) — a dual-tone honk that scatters
  // nearby peds (neonbay: horn scares peds within 25 m). In-car only,
  // 0.6 s cooldown so it cannot be held into a drone.
  if (actions & ACT_HORN && S.inCar) {
    const t = performance.now() / 1000;
    if (t - lastHonkAt > 0.6) {
      lastHonkAt = t;
      audio.horn();
      peds.scare(worldPos.x, worldPos.z, 25, 2);
    }
  }
}

function frame() {
  requestAnimationFrame(frame);
  window.__frames = (window.__frames || 0) + 1;
  const now = performance.now() / 1000;
  // v8d P1 #20: time runs at 20% while the weapon wheel is open —
  // the world keeps moving, slowly, like GTA V's wheel slow-mo.
  const dt = Math.min(0.05, Math.max(0.001, now - lastTime)) * wheel.timeScale();
  lastTime = now;

  const inGame = S.screen === 'game';
  const frozen = !inGame && S.screen !== 'title';
  // v8d P1 #20: leaving the game screen (pause / map / death) closes
  // the wheel — it must never sit open behind a menu.
  if (!inGame && wheel.isOpen()) wheel.close();

  // The title stage light is on only for the staged title shot — never
  // in normal play (orbit title) or in game.
  titleLight.visible = S.screen === 'title' && shotName === 'title';

  // Timed UI expiry runs everywhere.
  expireTimedUI(now);

  // Touch layer visibility mirrors the HUD (in-game only).
  if (touch) touch.update();

  // Shot readiness: after enough FRAMES (not wall time — headless runs slow),
  // flag the capture script so the camera has settled and the chase has formed.
  // This runs before the title early-return: the title shot needs it too.
  if (shotName && !window.__shotReady) {
    shotFrames++;
    if (shotName === 'combat' && shotFrames % 4 === 0) {
      // Keep the firefight live while staging.
      const pp = playerObj.p;
      const dir = combat.aimDirection(pp.camYaw);
      // Muzzle/tracer heights track the staged mesh scale (v7: Rook is
      // 1.35x in the combat frame, so his shoulder is ~1.95 m, not
      // 1.5 m). Relative scale — 1.0 in normal play, so gameplay is
      // untouched; the raycast is 2D, so the raised origin cannot
      // change hits.
      const ms = pp.mesh.scale.x / 1.05;
      combat.fire({ x: pp.x + dir.x * 1.2, y: 1.5 * ms, z: pp.z + dir.z * 1.2 }, dir, false);
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
        const ms = pp.mesh.scale.x / 1.05; // staged mesh scale (v7 combat: 1.29x)
        combat.fire({ x: pp.x + dir.x * 1.2, y: 1.5 * ms, z: pp.z + dir.z * 1.2 }, dir, false);
        combat.forceMuzzle({ x: pp.x + dir.x * 1.6 + rx * 1.0, y: 1.55 * ms, z: pp.z + dir.z * 1.6 + rz * 1.0 });
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
    const ms = pp.mesh.scale.x / 1.05; // staged mesh scale (v7 combat: 1.29x)
    combat.forceMuzzle({ x: pp.x + dir.x * 1.6 + rx * 1.0, y: 1.55 * ms, z: pp.z + dir.z * 1.6 + rz * 1.0 });
  }

  if (S.screen === 'title') {
    // The aim/drive FOV (v8c #21) must not leak into the title orbit or
    // the staged title shot: both run at the base 62°.
    if (Math.abs(camera.fov - 62) > 0.01 || Math.abs(playerObj.p.fov - 62) > 0.01) {
      camera.fov = 62; playerObj.p.fov = 62; camera.updateProjectionMatrix();
    }
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
    traffic.update(dt, { x: 0, z: 0 }, null, S.clock * 20);
    peds.update(dt, null, { x: 0, z: 0 });
    render.applyTimeOfDay(activities.sunPosition(), activities.isNight(), activities.isSunset());
    city.dynamic.updateTrafficLights(S.clock * 20);
    // Rain over the title orbit in normal play; never in a staged shot.
    if (!shotName) weather.update(dt, camera);
    // Adaptive resolution runs over the title orbit too (same renderer);
    // never in a staged shot, where a moving pixel ratio would break
    // the deterministic capture.
    if (!shotName) graphics.update(dt);
    render.render();
    return;
  }

  if (!frozen) {
    const actions = input.takeActions();
    if (inGame) handleActions(actions);
    // v8d P1 #20: hold Tab (or the WHEEL touch button) to open the
    // wheel; release to equip the highlighted weapon. While it is
    // open the look deltas are discarded, freezing the camera the way
    // GTA V does — the mouse steers the wheel cursor, not the view.
    if (inGame) {
      if (input.wheelHeld && !wheel.isOpen()) wheel.open();
      else if (!input.wheelHeld && wheel.isOpen()) wheel.confirm();
      if (wheel.isOpen()) input.takeMouse();
    }

    const pp = playerObj.p;
    // Movement: on foot or driving.
    if (S.inCar) {
      driving.update(dt, input, city.colliders, false);
      const car = driving.getCar();
      if (car) { pp.x = car.x; pp.z = car.z; }
      // Mouse-look / touch look-drag while driving: player.update()
      // (the only takeMouse consumer) never runs in a car, so the look
      // deltas accumulated unspent and hit the camera on exit. Consume
      // them here with the same sensitivity; the chase camera's blend
      // toward the car heading re-centres the view afterwards.
      const mouse = input.takeMouse();
      pp.camYaw -= mouse.dx * 0.0028 * S.sensitivity;
      pp.camPitch = Math.max(0.08, Math.min(1.1, pp.camPitch + mouse.dy * 0.0022 * S.sensitivity));
    } else {
      // v8c #14: inside a shop the interior walls are the colliders.
      playerObj.update(dt, input, S.interior ? stores.colliders : city.colliders, false);
    }
    const playerPos = { x: pp.x, z: pp.z };
    // v8c #14: while the player is inside a shop, the world systems
    // (traffic, peds, police, crew, missions, HUD) see the shop door —
    // the cops gather outside, the crew waits there, the minimap stays
    // on the city — while the player themself is in the room at x=3000.
    const worldPos = S.interior && stores.doorPos() ? stores.doorPos() : playerPos;
    S.playerX = worldPos.x; S.playerZ = worldPos.z;

    // v8c #21: soft lock-on while aiming on foot — the aim snaps to the
    // closest target in a 20° cone and the camera steers onto it, so
    // the shot below goes where the crosshair sits. Never during
    // staging (p.aiming is false there: no mouse is held).
    if (inGame && !S.inCar && pp.aiming) {
      const lock = combat.updateLockOn(playerPos, pp.camYaw, true);
      if (lock) playerObj.steerToTarget(dt, lock, pp.mouseActive);
    } else {
      combat.updateLockOn(playerPos, pp.camYaw, false);
    }

    // Firing (mouse held): on foot, or drive-by from the car.
    // v8d P1 #20: never while the weapon wheel is open — a click
    // there is a segment tap, not a shot.
    if (inGame && input.firing && !wheel.isOpen()) {
      const dir = combat.aimDirection(pp.camYaw);
      const origin = S.inCar
        ? { x: pp.x + dir.x * 2, y: 1.4, z: pp.z + dir.z * 2 }
        : { x: pp.x + dir.x * 1.2, y: 1.5, z: pp.z + dir.z * 1.2 };
      combat.fire(origin, dir, S.inCar);
    }

    // World systems.
    const gunfire = combat.gunfireAt;
    traffic.update(dt, worldPos, gunfire, S.clock * 20);
    peds.update(dt, gunfire, worldPos);
    // Player velocity for the police pursuit lead (clamped: teleports
    // would otherwise spike it for a frame).
    let playerVel = { x: 0, z: 0 };
    if (prevPlayerPos) {
      playerVel = { x: (worldPos.x - prevPlayerPos.x) / Math.max(dt, 1e-3), z: (worldPos.z - prevPlayerPos.z) / Math.max(dt, 1e-3) };
      const vl = Math.hypot(playerVel.x, playerVel.z);
      if (vl > 70) { playerVel.x *= 70 / vl; playerVel.z *= 70 / vl; }
    }
    prevPlayerPos = { x: worldPos.x, z: worldPos.z };
    // v8d #1: the police need the live car (ram contact) + the damage /
    // shove callbacks; `car` is hoisted here so the camera / HUD / lights
    // below reuse the same handle.
    const car = driving.getCar();
    police.update(dt, worldPos, S.speedKmh, playerVel, {
      inCar: S.inCar, heading: car ? car.heading : pp.heading,
      car, damageCar: (n) => driving.damage(n), shoveCar: (ix, iz, kick) => driving.shove(ix, iz, kick),
    });
    combat.update(dt, worldPos);
    crew.update(dt, worldPos, S.inCar, combat.enemies);
    missions.update(dt, worldPos);
    // v8d #8: the MISSION FAILED card sequence (wait → card → prompt).
    missions.updateFail(now);
    activities.updateClock(dt);
    activities.updateRace(dt, worldPos);
    activities.updateTaxi(dt, worldPos);
    activities.checkCaches(worldPos);
    audio.update(dt, S.speedKmh, S.wanted);

    // v8c #14: shop doors + interiors — gameplay only, never in a
    // staged shot or the self-test.
    if (!shotName && !selftest) stores.update(dt, playerPos, S.inCar);

    // Camera + sky.
    playerObj.updateCamera(dt, camera, car ? { x: car.x, z: car.z } : null, car ? car.heading : undefined,
      { staging: !!shotName, speedKmh: S.speedKmh, colliders: S.interior ? stores.colliders : city.colliders });
    render.applyTimeOfDay(activities.sunPosition(), activities.isNight(), activities.isSunset());
    city.dynamic.updateTrafficLights(S.clock * 20);

    // v8d #9: health regen (GTA V) — after 5 s without damage, HP
    // recovers slowly (2/s) up to 50%. Full health still needs the
    // Boathouse or a respawn. Live play only: staged shots keep
    // their fixed HP. Any HP drop (enemy or police fire — the only
    // damage sources) restarts the 5 s clock.
    if (!shotName && S.health > 0) {
      if (S.health < lastHpSeen) lastDamageAt = now;
      lastHpSeen = S.health;
      if (S.health < 50 && now - lastDamageAt > 5) {
        S.health = Math.min(50, S.health + 2 * dt);
        lastHpSeen = S.health;
      }
    } else lastHpSeen = S.health;

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
        // v8d #8: dying mid-job fails the mission (MISSION FAILED +
        // retry) instead of soft-locking the stage.
        missions.failJob(now);
        driving.destroyCar();
        // Dying inside a shop (v8c #14) drops the player back outside
        // first, so the respawn never leaves a stale interior behind.
        if (S.interior) stores.exit();
        playerObj.teleport(-210, 150, 0);
        crew.teleportBeside(-210, 150);
        S.banner = { text: 'WASTED', sub: `The lagoon keeps $${lost.toLocaleString()} of your cash.`, until: now + 3 };
      }
    }

    // v8d #2/#13: BUSTED — arrested at 1–2 stars (see police.js).
    // GTA V rules: bail is 10% of cash, weapons + ammo + armour are
    // confiscated (rebuy at Harbor Arms), and Rook walks out of the
    // KLPD Harbor Watch precinct. WASTED only takes 10% of cash.
    if (police.takeBusted()) {
      const fine = Math.floor(S.cash * 0.1);
      S.cash -= fine;
      S.health = 100; S.armour = 0;
      for (const a of S.ammo) { if (a.mag !== Infinity) { a.mag = 0; a.reserve = 0; } }
      // v8d #13: the weapons themselves go too (fists only) — the
      // old handler zeroed the ammo but left the guns owned, so a
      // busted Rook kept his arsenal and only re-bought bullets.
      S.ownedWeapons = [0];
      S.weaponIndex = 0;
      police.clearAll();
      combat.clearEnemies();
      // v8d #8: busted mid-job fails the mission too (leonida: fail
      // global = wasted/busted).
      missions.failJob(now);
      driving.destroyCar();
      if (S.interior) stores.exit();
      playerObj.teleport(76, 0, 0);
      crew.teleportBeside(76, 0);
      S.banner = { text: 'BUSTED', sub: `KLPD Harbor Watch Precinct — bail $${fine.toLocaleString()}. Weapons + ammo + armour confiscated.`, until: now + 3 };
    }

    // HUD.
    if (inGame) hud.update(worldPos, S.inCar && car ? car.heading : pp.camYaw);
    // Ferris wheel + water drift.
    if (city.dynamic.wheel) city.dynamic.wheel.rotation.z += dt * 0.12;
    if (city.dynamic.water) { city.dynamic.water.position.x = Math.sin(now * 0.05) * 2; }
    if (city.dynamic.beaconRing) city.dynamic.beaconRing.rotation.z += dt;
    // Rain + lightning: gameplay only — never in a staged shot or the
    // self-test. Runs after applyTimeOfDay so the fog pull-in sticks.
    // Indoors (v8c #14) the rain stays outside: no volume, no fog
    // pull-in, no new lightning, no rain sound.
    if (!shotName && !selftest) weather.update(dt, camera, !!S.interior);
    // Light budget: same gate — the pooled lamps, actor lamp and
    // headlights must never touch a staged capture's lighting.
    if (!shotName && !selftest) {
      const nightK = activities.isNight() ? 1 : activities.isSunset() ? 0.6 : 0;
      lights.update(dt, playerPos, nightK, S.inCar && car ? { x: car.x, z: car.z, heading: car.heading } : null);
    }
    // Adaptive resolution: same gate as the rain — a moving pixel ratio
    // must never touch a staged capture or a scripted check.
    if (!shotName && !selftest) graphics.update(dt);
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
    // v8d P1 #18R: gunfire is witness-gated while clean, so fire from
    // the road beside a pedestrian — a civilian within 25 m reports
    // it. The road point is always clear of buildings (a sidewalk
    // teleport could land inside one and block the witness's view).
    // The shot aims away from the ped so it does not kill the witness.
    let dir = combat.aimDirection(pp.camYaw);
    const np = peds.nearestPed(pp.x, pp.z, 500);
    if (np) {
      const rp = nearestRoadPoint(np.x, np.z);
      playerObj.teleport(rp.x, rp.z, 0);
      const dx = rp.x - np.x, dz = rp.z - np.z;
      const dl = Math.hypot(dx, dz) || 1;
      dir = { x: dx / dl, z: dz / dl };
    }
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
