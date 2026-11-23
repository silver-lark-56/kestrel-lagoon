// KESTREL LAGOON — the wanted system: 1–5 stars, named KLPD units that
// pursue, ram and roadblock, a helicopter with a spotlight from 3 stars,
// line-of-sight search, and the ways to cool down (break sight, respray,
// the hacker's blackout). The HUD's police response list reads from here.
import * as THREE from 'three';
import { S, addRep, showToast, showBanner } from './state.js';
import { POLICE_UNITS } from './config.js';
import { buildCarMesh, modelById } from './vehicles.js';
import { resolveCircle, nearestRoadPoint } from './city.js';
import { nearestNode, astar, nodePos, lineOfSight } from './road-graph.js';
import { createFootCop, removeFootCop, updateFootCop, createArrest } from './police-ai.js';

const UNIT_STATES = ['PURSUIT', 'RAMMING', 'ROADBLOCK', 'SEARCHING'];

// v8a #6: search-circle + hot-scene tuning (pattern: leonida
// WantedMachine, MIT — leonida/src/systems/wanted/{machine,config}.ts).
// The circle starts where the player was last seen and widens as the
// cops sweep; hiding inside it cools the heat 1.5x slower. A crime
// leaves a hot scene for 2 minutes; walking back through it while clean
// puts 1 star back on.
const SEARCH = { initialRadius: 40, growthPerSecond: 8, maxRadiusBase: 220, maxRadiusPerLevel: 30 };
const HOT_SCENE = { radius: 60, expirySeconds: 120, mergeRadius: 30, max: 4, reraiseLevel: 1 };
const HIDDEN_INSIDE_MULTIPLIER = 1.5;

// v8a #4: heat table (numbers: fable DESIGN.md — fable's 0.34/0.8/0.5
// star-fractions as points, 100 per star band, first star at 34).
// Stars are DERIVED from heat, so a small crime at high heat can push
// you over the line and a big crime can jump two stars at once.
const HEAT = { gunfire: 34, hitPed: 34, killPed: 80, carjack: 50, attackCop: 100, killCop: 150, explosion: 100 };
const COPS_PER_STAR = [0, 1, 2, 4, 6, 8]; // fable dispatch table
// v8d #5: stars drop after this many seconds unseen per star (fable's
// 25/40/60/90/120 — the old 14+4/star cooled far too fast).
const DECAY_SECONDS = [0, 25, 40, 60, 90, 120];
const HEAT_MAX = 500;
const bandMin = (stars) => (stars <= 0 ? 0 : 34 + (stars - 1) * 100);
const starsFromHeat = (h) => (h < 34 ? 0 : Math.min(5, 1 + Math.floor((h - 34) / 100)));

export function createPolice(scene, colliders, audio) {
  const units = []; // {mesh, callsign, x, z, heading, speed, state, mode}
  let heli = null; // {group, angle, spotlight}
  let spawnTimer = 0;
  let unitCounter = 0;
  // v8d: staging (?shot=) runs the exact pre-v8d police behaviour, so
  // the four final shots cannot change — every v8d behaviour below is
  // gated on !staging. main.js sets this at boot.
  let staging = false;
  // v8d #1: counted ram contacts (unit -> player car), with the last
  // few in ramLog for the probe + the dossier-visible HUD. A contact
  // counts once per 0.8 s per unit (u.ramCooldown), not once per frame.
  let ramCount = 0;
  const ramLog = [];
  // v8d #2: foot cops (bailed officers) + the arrest timer.
  const footCops = [];
  const arrest = createArrest();
  let bustedFlag = false;
  let arrestPrompted = false;
  // v8d #3: combat is created after police in main.js, so it arrives
  // via setCombat (same one-time wiring pattern as setStaging).
  let combatRef = null;
  // v8d P1 #18R: pedestrians arrive the same way (main.js wires them at
  // boot) — the witness check needs the live civilian list.
  let peds = null;

  // v8d P1 #18R — WITNESS SYSTEM (re-implemented in this recorded
  // session; the first #18 commit could not be sealed after the VM
  // restart killed its recording). gta-clone pattern: a crime with no
  // witness has a 50% chance of going unreported. Leonida pattern: a
  // cop within 40 m sees it directly, a civilian within 25 m phones
  // it in. Minor crimes only — attacking or killing a cop is always
  // reported. The gate runs only while the player is NOT already
  // wanted: once the heat is on, every crime counts (the police
  // already know where to look). Staging is exempt (pre-v8d behaviour).
  const WITNESS_GATED = { gunfire: true, hitPed: true, killPed: true, carjack: true, explosion: true };
  const COP_WITNESS_RANGE = 40;
  const PED_WITNESS_RANGE = 25;
  let lastCrime = null; // { type, witness, reported } — probe-visible.

  function witnessAt(x, z) {
    // A cop unit or a live foot cop within 40 m with a clear line of sight.
    for (const u of units) {
      const d = Math.hypot(u.x - x, u.z - z);
      if (d <= COP_WITNESS_RANGE && lineOfSight(colliders, u.x, u.z, x, z)) return 'cop';
    }
    for (const c of footCops) {
      if (c.dead) continue;
      const d = Math.hypot(c.x - x, c.z - z);
      if (d <= COP_WITNESS_RANGE && lineOfSight(colliders, c.x, c.z, x, z)) return 'cop';
    }
    // A living civilian within 25 m with a clear line of sight phones it in.
    if (peds) {
      for (const p of peds.peds) {
        if (p.dead) continue;
        const d = Math.hypot(p.x - x, p.z - z);
        if (d <= PED_WITNESS_RANGE && lineOfSight(colliders, p.x, p.z, x, z)) return 'civilian';
      }
    }
    return null;
  }

  function wantedTarget() {
    return COPS_PER_STAR[S.wanted] || 0; // units on the street per star
  }

  // Shared star-setter: toasts, banners and rep fire only on an increase.
  function setStars(stars, why) {
    const before = S.wanted;
    S.wanted = Math.max(0, Math.min(5, stars));
    if (S.wanted > before) {
      S.wantedTimer = 0;
      if (why) showToast(`${why} — wanted ${S.wanted}★`);
      if (S.wanted >= 3 && before < 3) showBanner('AIR SUPPORT INBOUND', 'KLPD Air-1 is overhead — break line of sight');
      if (S.wanted === 5 && before < 5) showBanner('MAXIMUM HEAT', 'Every unit in the lagoon is coming for you');
      addRep(2);
      return true;
    }
    return false;
  }

  function addWanted(n, why) {
    // Direct star set (staging + legacy callers): heat sits at the
    // floor of the new band so the next crime behaves predictably.
    if (setStars(S.wanted + n, why)) S.heat = bandMin(S.wanted);
  }

  // The crime path: add heat, derive stars, leave a hot scene.
  // v8d #4: per-crime cooldowns (leonida pattern) — a held trigger
  // counts as repeated gunfire, but not once per bullet; spraying a
  // cop raises the heat once per 2 s, not once per hit.
  const CRIME_COOLDOWN = { gunfire: 0.5, attackCop: 2 };
  const crimeCooldownUntil = {};
  function commitCrime(type, why, pos = null) {
    const cd = CRIME_COOLDOWN[type] || 0;
    if (cd > 0) {
      const now = performance.now() / 1000;
      if (crimeCooldownUntil[type] !== undefined && now < crimeCooldownUntil[type]) return;
      crimeCooldownUntil[type] = now + cd;
    }
    // v8d P1 #18R: a minor crime committed while clean is only reported
    // when someone sees it. With no witness, a coin flip decides
    // whether it goes unreported — an unreported crime adds no heat
    // and leaves no hot scene. The toast names the surprising outcome
    // so the player learns the rule instead of reading it as a bug.
    if (!staging && S.wanted === 0 && WITNESS_GATED[type]) {
      const cx = pos ? pos.x : S.playerX;
      const cz = pos ? pos.z : S.playerZ;
      const witness = witnessAt(cx, cz);
      if (!witness && Math.random() < 0.5) {
        lastCrime = { type, witness: null, reported: false };
        showToast('No one saw that');
        return;
      }
      lastCrime = { type, witness: witness || 'none', reported: true };
    } else {
      lastCrime = { type, witness: 'always', reported: true };
    }
    S.heat = Math.min(HEAT_MAX, S.heat + (HEAT[type] || 0));
    setStars(starsFromHeat(S.heat), why);
    if (pos) addHotScene(pos.x, pos.z);
  }

  // v8d #4: every shot counts (the old fire() only reported gunfire
  // while clean, so sustained shooting never raised the heat). The
  // 0.5 s cooldown in commitCrime keeps a held trigger from adding a
  // star per bullet. Staging never reports: the combat shot fires
  // repeatedly and its 1 star is staged, not earned.
  function reportGunfire(pos) {
    if (staging) return;
    commitCrime('gunfire', 'Shots fired', pos);
  }

  // v8d #4: shooting a foot cop — a hit is attackCop, a kill is
  // killCop (fable's 1.0 / 1.5). The dead cop falls like a dead enemy
  // and stops chasing, shooting and arresting.
  function damageFootCop(cop, damage) {
    if (cop.dead) return 'dead';
    // v8d #7: any damage provokes this cop permanently (leonida
    // CopBrain) — from now on he shoots on sight, even at 1 star.
    cop.provoked = true;
    cop.hp -= damage;
    if (cop.hp <= 0) {
      cop.dead = true;
      cop.mesh.rotation.x = -Math.PI / 2;
      cop.mesh.position.y = 0.4;
      commitCrime('killCop', 'Officer down', { x: cop.x, z: cop.z });
      addRep(-15);
      return 'killed';
    }
    commitCrime('attackCop', 'Officer hit', { x: cop.x, z: cop.z });
    return 'hit';
  }

  // Ivo's blackout: one star off, heat cooled by one band.
  function dropStar() {
    if (S.wanted <= 0) return;
    S.wanted -= 1;
    S.heat = S.wanted === 0 ? 0 : Math.max(bandMin(S.wanted), S.heat - 100);
    S.wantedTimer = 0;
  }

  // Hot crime scenes (leonida pattern): a new crime near an existing
  // scene refreshes it instead of adding one; the player is standing in
  // the scene when it is created, so re-raising needs an
  // outside→inside transition, not mere presence.
  function addHotScene(x, z) {
    const now = performance.now() / 1000;
    for (const s of S.hotScenes) {
      if (Math.hypot(x - s.x, z - s.z) < HOT_SCENE.mergeRadius) {
        s.until = now + HOT_SCENE.expirySeconds;
        return;
      }
    }
    if (S.hotScenes.length >= HOT_SCENE.max) S.hotScenes.shift();
    S.hotScenes.push({ x, z, radius: HOT_SCENE.radius, until: now + HOT_SCENE.expirySeconds, playerInside: true });
  }

  function updateHotScenes(playerPos) {
    const now = performance.now() / 1000;
    for (let i = S.hotScenes.length - 1; i >= 0; i--) {
      const s = S.hotScenes[i];
      if (now >= s.until) {
        S.hotScenes.splice(i, 1);
        continue;
      }
      const inside = Math.hypot(playerPos.x - s.x, playerPos.z - s.z) < s.radius;
      if (inside && !s.playerInside && S.wanted === 0) {
        // Walked back through a live crime scene while clean: the
        // cops put the pieces together and the heat is back on.
        s.playerInside = true;
        S.wanted = HOT_SCENE.reraiseLevel;
        S.wantedTimer = 0;
        S.lastSeen = { x: s.x, z: s.z };
        S.searchCenter = { x: s.x, z: s.z };
        S.searchRadius = SEARCH.initialRadius;
        showToast('Back at the scene — the heat is on');
        continue;
      }
      s.playerInside = inside;
    }
  }

  function spawnUnit(near) {
    const callsign = POLICE_UNITS[unitCounter % POLICE_UNITS.length];
    unitCounter++;
    const model = modelById('interceptor');
    const mesh = buildCarMesh(model);
    // Spawn on a road ahead of the player, or at the world edge.
    const rp = nearestRoadPoint(near.x + (Math.random() - 0.5) * 90, near.z + (Math.random() - 0.5) * 90);
    const x = rp.x, z = rp.z;
    mesh.position.set(x, 0, z);
    scene.add(mesh);
    const unit = { mesh, callsign, x, z, heading: Math.atan2(near.x - x, near.z - z), speed: 0, state: 'PURSUIT', mode: 'chase', blockTimer: 0,
      // A* routing + unstick state (v8b #13, neonbay pattern).
      path: null, replan: 0, stuckT: 0, reverseT: 0, farStuckT: 0, px: x, pz: z, ramCooldown: 0, bailed: false, lungeT: 0, lungeCd: 2 };
    units.push(unit);
    return unit;
  }

  function spawnHeli() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 6),
      new THREE.MeshLambertMaterial({ color: 0x14181f }));
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.0, 2.4),
      new THREE.MeshLambertMaterial({ color: 0x9fd8e8 }));
    cabin.position.set(0, 0.4, 1.4);
    const rotor = new THREE.Mesh(new THREE.BoxGeometry(13, 0.12, 0.5),
      new THREE.MeshLambertMaterial({ color: 0x2b2f3a }));
    rotor.position.y = 1.1;
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 5),
      new THREE.MeshLambertMaterial({ color: 0x14181f }));
    tail.position.set(0, 0.3, -5);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.24, 0.4, 6),
      new THREE.MeshLambertMaterial({ color: 0xf2f2f2 }));
    stripe.position.y = 0.1;
    // Rotor disc: a translucent blur disc so the spinning rotor reads at a
    // distance, plus a tail rotor — the two shapes that say "helicopter".
    const disc = new THREE.Mesh(new THREE.CircleGeometry(6.5, 24),
      new THREE.MeshBasicMaterial({ color: 0xd8dee8, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 1.15;
    const tailRotor = new THREE.Mesh(new THREE.CircleGeometry(0.9, 12),
      new THREE.MeshBasicMaterial({ color: 0xd8dee8, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }));
    tailRotor.rotation.y = Math.PI / 2;
    tailRotor.position.set(0.35, 0.6, -7.3);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(7, 42, 14, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }));
    cone.position.y = -21;
    cone.rotation.x = Math.PI;
    g.add(body, cabin, rotor, tail, stripe, cone, disc, tailRotor);
    g.userData = { rotor, cone };
    scene.add(g);
    heli = { group: g, angle: Math.random() * Math.PI * 2, spotlightOn: true, fireTimer: 1.5 };
    return heli;
  }

  // Staging: place a unit exactly on the nearest road to (x, z) — no random
  // offset, so a staged shot frames identically every run. Pre-placing the
  // full wanted target also stops the update loop spawning random units.
  // opts.exact skips the road snap (for lane-exact roadblocks);
  // opts.hold parks the unit as a roadblock that never moves;
  // opts.angle rotates its heading off head-on;
  // opts.state overrides the held unit's displayed state (a held RAMMING
  // unit keeps its pose AND its label — a live ramming unit would drive
  // into the player car before the capture frame).
  function placeUnitAt(x, z, px, pz, opts = {}) {
    const callsign = POLICE_UNITS[unitCounter % POLICE_UNITS.length];
    unitCounter++;
    const model = modelById('interceptor');
    const mesh = buildCarMesh(model);
    const rp = opts.exact ? { x, z } : nearestRoadPoint(x, z);
    const heading = Math.atan2(px - rp.x, pz - rp.z) + (opts.angle || 0);
    mesh.position.set(rp.x, 0, rp.z);
    mesh.rotation.y = heading;
    scene.add(mesh);
    const unit = { mesh, callsign, x: rp.x, z: rp.z, heading, speed: 0, state: opts.state || (opts.hold ? 'ROADBLOCK' : 'PURSUIT'), mode: 'chase', blockTimer: 0, hold: !!opts.hold, holdState: opts.state || null,
      path: null, replan: 0, stuckT: 0, reverseT: 0, farStuckT: 0, px: rp.x, pz: rp.z, ramCooldown: 0, bailed: false, lungeT: 0, lungeCd: 2 };
    units.push(unit);
    return unit;
  }

  function removeHeli() {
    if (heli) { scene.remove(heli.group); heli = null; }
  }

  function update(dt, playerPos, playerSpeed, playerVel = { x: 0, z: 0 }, env = {}) {
    // env (v8d, from main.js): { inCar, heading, car, damageCar, shoveCar }.
    // Hot scenes tick even while clean (a re-raise can come from them).
    updateHotScenes(playerPos);
    // Wanted decay: hidden long enough and the heat cools off.
    if (S.wanted > 0) {
      const seen = S.inSight;
      if (!seen) {
        // Hiding INSIDE the search circle cools slower (leonida's
        // hidden-inside multiplier): the cops are sweeping right
        // where you are. Outside the circle, the timer runs full rate.
        const inside = S.searchCenter && Math.hypot(playerPos.x - S.searchCenter.x, playerPos.z - S.searchCenter.z) < S.searchRadius;
        S.wantedTimer += inside ? dt / HIDDEN_INSIDE_MULTIPLIER : dt;
        S.searchZone = Math.max(0, S.searchZone - dt * 2);
        if (S.wantedTimer > DECAY_SECONDS[S.wanted]) {
          S.wanted -= 1;
          // Cooling drops the heat by one band (to zero when clean).
          S.heat = S.wanted === 0 ? 0 : Math.max(bandMin(S.wanted), S.heat - 100);
          S.wantedTimer = 0;
          showToast(`Heat cooling — wanted ${S.wanted}★`);
          if (S.wanted === 0) { showBanner('YOU LOST THEM', 'The lagoon forgets. For now.'); addRep(25); }
        }
      } else {
        S.wantedTimer = 0;
        S.searchZone = Math.min(100, S.searchZone + dt * 8);
      }
    }

    // Keep the street force at strength.
    const target = S.wanted > 0 ? wantedTarget() : 0;
    spawnTimer -= dt;
    if (units.length < target && spawnTimer <= 0) {
      spawnUnit(playerPos);
      spawnTimer = 1.2;
    }
    if (S.wanted === 0) {
      // Stand down: units drive off and despawn.
      for (let i = units.length - 1; i >= 0; i--) {
        const u = units[i];
        u.speed = Math.min(u.speed + 10 * dt, 20);
        u.x += Math.sin(u.heading) * u.speed * dt;
        u.z += Math.cos(u.heading) * u.speed * dt;
        if (Math.hypot(u.x - playerPos.x, u.z - playerPos.z) > 130) {
          scene.remove(u.mesh);
          units.splice(i, 1);
        } else {
          u.mesh.position.set(u.x, 0, u.z);
          u.mesh.rotation.y = u.heading;
        }
      }
      // v8d #2: foot cops stand down too (their units are leaving).
      for (const cop of footCops) removeFootCop(scene, cop);
      footCops.length = 0;
      arrest.reset();
      bustedFlag = false;
      arrestPrompted = false;
      removeHeli();
      return;
    }

    // Helicopter from 3 stars.
    if (S.wanted >= 3 && !heli) spawnHeli();
    if (S.wanted < 3 && heli) removeHeli();

    // Line of sight (v8d #5): a unit sees the player only with a clear
    // line of sight inside 55 m — the old distance-only check saw
    // through buildings, so hiding never broke the chase. Under 6 m a
    // unit counts as seeing the player without a ray (leonida's
    // nearAutoSee); the heli spotlight still sees everything. hasLos
    // is last frame's (the unit loop below refreshes it), so the first
    // frame after a spawn reads unseen — harmless.
    let seen = false;
    for (const u of units) {
      const d = Math.hypot(u.x - playerPos.x, u.z - playerPos.z);
      if (d < 6 || (d < 55 && u.hasLos)) { seen = true; break; }
    }
    if (heli && heli.spotlightOn) seen = true;
    S.inSight = seen;

    // Search circle (leonida pattern): while a cop has eyes on the
    // player, the last-seen position tracks them and there is no
    // circle (active pursuit). The moment sight breaks, the circle
    // anchors where the player was LAST SEEN and grows as the search
    // widens — it never follows the player.
    if (S.wanted > 0) {
      if (seen) {
        S.lastSeen = { x: playerPos.x, z: playerPos.z };
        S.searchCenter = null;
        S.searchRadius = 0;
      } else if (S.lastSeen) {
        if (!S.searchCenter) {
          S.searchCenter = { x: S.lastSeen.x, z: S.lastSeen.z };
          S.searchRadius = SEARCH.initialRadius;
        }
        S.searchRadius = Math.min(S.searchRadius + SEARCH.growthPerSecond * dt,
          SEARCH.maxRadiusBase + SEARCH.maxRadiusPerLevel * S.wanted);
      }
    } else {
      S.searchCenter = null;
      S.searchRadius = 0;
    }

    for (const u of units) {
      const dx = playerPos.x - u.x, dz = playerPos.z - u.z;
      const dist = Math.hypot(dx, dz);
      const wantAngle = Math.atan2(dx, dz);
      let diff = wantAngle - u.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      // v8d #2/#5: line of sight to the player, computed once per unit
      // per frame — before the hold check, so staged units count
      // toward `seen` too; the bail check and the chase branch share it.
      const los = dist < 75 && lineOfSight(colliders, u.x, u.z, playerPos.x, playerPos.z);
      u.hasLos = los;
      if (u.hold) {
        // Staged roadblock: holds its placed pose; still counts as seeing
        // the player, and its light bar still flashes. A held unit with
        // a staged state (RAMMING) keeps that label.
        u.state = u.holdState || 'ROADBLOCK';
        u.dist = dist;
        const bar = u.mesh.userData.lightBar;
        if (bar) bar.rotation.y = Math.floor(performance.now() / 120) % 2 === 0 ? 0 : Math.PI;
        continue;
      }
      // v8d #2/#7: bail takes precedence over the ram when the player
      // is on foot and close — a cruiser cannot arrest anyone. Bail
      // range is 25 m (leonida); the unit brakes hard (45 m/s²) so it
      // stops near the player instead of overshooting past him. A unit
      // whose officer is out stays parked until the cop comes back.
      if (u.bailed) {
        u.mode = 'bail'; u.state = 'ON FOOT';
      } else if (!staging && !env.inCar && dist < 25 && los) {
        u.mode = 'bail'; u.state = 'ON FOOT';
      } else if (S.wanted >= 2 && playerSpeed > 30 && (units.indexOf(u) % 3 === 2) && dist < 70 && dist > 25) {
        u.mode = 'block';
        u.state = 'ROADBLOCK';
      } else if (dist < 18) {
        // v8d #6: the ram zone is 18 m (neonbay) — inside it the unit
        // speed-matches the player and sticks ~7 m behind; the lunge
        // below makes the contact deliberate. (Staging: the cover
        // shot's live units are 40 m+ out, so no staged label changes.)
        u.mode = 'ram'; u.state = 'RAMMING';
      } else {
        // v8d #5: PURSUIT only while the player is actually seen;
        // otherwise the unit is searching (it routes to last-seen).
        u.mode = 'chase'; u.state = (seen && dist < 40) ? 'PURSUIT' : 'SEARCHING';
      }
      if (u.mode === 'bail') {
        // Parked: brake to a stop, then the officer gets out (once).
        u.speed = Math.max(0, u.speed - 45 * dt);
        u.x += Math.sin(u.heading) * u.speed * dt;
        u.z += Math.cos(u.heading) * u.speed * dt;
        if (u.speed < 3 && !u.bailed) {
          u.bailed = true;
          const cop = createFootCop(scene, u.x + 2, u.z, u.heading);
          cop.unit = u;
          footCops.push(cop);
        }
      } else if (u.mode === 'block') {
        // Park across the road ahead of the player and wait.
        const ahead = { x: playerPos.x + Math.sin(Math.atan2(dx, dz)) * 0, z: playerPos.z };
        void ahead;
        const tx = playerPos.x + dx / (dist || 1) * 18;
        const tz = playerPos.z + dz / (dist || 1) * 18;
        const bd = Math.hypot(tx - u.x, tz - u.z);
        if (bd > 3) {
          u.heading += Math.max(-2.4 * dt, Math.min(2.4 * dt, Math.atan2(tx - u.x, tz - u.z) - u.heading));
          u.speed = Math.min(u.speed + 20 * dt, 34);
          u.x += Math.sin(u.heading) * u.speed * dt;
          u.z += Math.cos(u.heading) * u.speed * dt;
        } else {
          u.speed = 0;
          u.heading += Math.PI / 2 * dt * 0; // hold position, angled across the road
        }
      } else if (u.reverseT > 0) {
        // Unstick (neonbay pattern): back out with inverted steering for
        // 1.6 s, then the chase resumes with a fresh route.
        u.reverseT -= dt;
        if (u.reverseT <= 0) u.replan = 0;
        u.heading += Math.max(-2.2 * dt, Math.min(2.2 * dt, -diff));
        u.speed = 12;
        u.x -= Math.sin(u.heading) * u.speed * dt;
        u.z -= Math.cos(u.heading) * u.speed * dt;
      } else {
        // A* road-graph routing (neonbay pattern): with line of sight
        // the unit drives straight at the player, leading them by 0.5 s
        // of travel; without it, it follows an A* path over the
        // intersection graph, replanned every 3 s. Waypoints advance
        // within 13 m. Steering is Reynolds seek with a turn-slowdown:
        // the unit brakes into hard corners instead of overshooting.
        let tx, tz;
        if (los) {
          tx = playerPos.x + playerVel.x * 0.5;
          tz = playerPos.z + playerVel.z * 0.5;
          u.path = null;
        } else {
          u.replan -= dt;
          if (!u.path || u.path.length === 0 || u.replan <= 0) {
            // v8d #5: RESPONDING routes to the last-seen position, not
            // the player's live position — unseen cops sweep where you
            // WERE, they do not home in on you.
            const goal = seen ? playerPos : (S.lastSeen || playerPos);
            u.path = astar(nearestNode(u.x, u.z), nearestNode(goal.x, goal.z)).map(nodePos);
            u.replan = 3;
          }
          while (u.path.length > 0 && Math.hypot(u.path[0].x - u.x, u.path[0].z - u.z) < 13) u.path.shift();
          const wp = u.path[0];
          if (wp) { tx = wp.x; tz = wp.z; }
          else if (!seen && S.searchCenter) {
            // At the last-seen point with nothing found: sweep the
            // search circle, each unit taking a different quadrant.
            const qi = units.indexOf(u) % 4;
            const qa = qi * Math.PI / 2 + 0.4;
            tx = S.searchCenter.x + Math.sin(qa) * S.searchRadius * 0.5;
            tz = S.searchCenter.z + Math.cos(qa) * S.searchRadius * 0.5;
          }
          else { tx = playerPos.x; tz = playerPos.z; }
        }
        let tDiff = Math.atan2(tx - u.x, tz - u.z) - u.heading;
        while (tDiff > Math.PI) tDiff -= Math.PI * 2;
        while (tDiff < -Math.PI) tDiff += Math.PI * 2;
        const top = u.mode === 'ram' ? 52 : 46;
        const vT = Math.max(10, Math.min(top, top - Math.abs(tDiff) * 30));
        u.heading += Math.max(-2.2 * dt, Math.min(2.2 * dt, tDiff));
        // v8d #6 (master study §8.2): the old full-speed ram charged
        // past the player and looped around forever — it felt like a
        // drive-by, not a capture. Neonbay's speed-matching instead:
        // inside 18 m the unit matches the player's speed ×0.95 and
        // sticks ~7 m behind (the (dist−7)×1.4 term pulls it in from
        // the edge of the zone and lets it fall back inside 7 m).
        // At 2★+ (leonida: ramming starts at 2★) the unit surges
        // every ~4 s — a deliberate 1.2 s lunge at full speed aimed
        // at the 0.5 s lead point, so the physical ram (below) is a
        // chosen hit, not an accident. Staging keeps the old numbers.
        let approach;
        if (!staging && u.mode === 'ram') {
          const pSpeed = Math.hypot(playerVel.x, playerVel.z);
          approach = Math.max(9, Math.min(52, pSpeed * 0.95 + (dist - 7) * 1.4));
          if (u.lungeT > 0) { u.lungeT -= dt; approach = vT; }
          else {
            u.lungeCd -= dt;
            if (S.wanted >= 2 && env.inCar && dist < 10 && u.lungeCd <= 0) {
              u.lungeT = 1.2; u.lungeCd = 4;
              approach = vT;
            }
          }
        } else if (!staging && !env.inCar && dist < 7) {
          // gta-clone slow-to-catch: a unit closing on a player on
          // foot crawls (throttle ~0.35) instead of running them
          // over — the bail turns the crawl into an arrest. (In ram
          // mode the formula above already slows to the player's
          // on-foot speed; this caps the chase branch too, e.g. when
          // LOS is broken and the unit is A* routing.)
          approach = Math.min(vT, 3.5);
        } else {
          approach = dist > 8 ? vT : 26;
        }
        u.speed += (approach - u.speed) * Math.min(1, dt * 1.4);
        u.x += Math.sin(u.heading) * u.speed * dt;
        u.z += Math.cos(u.heading) * u.speed * dt;
      }
      const fixed = resolveCircle(colliders, u.x, u.z, 2.1);
      u.x = fixed.x; u.z = fixed.z;
      // Stuck tracking: commanded speed but no ground covered. 1.4 s of
      // it triggers the reverse above; a unit 170 m+ out that has not
      // moved for 4 s is despawned below (the spawn loop replaces it
      // near the player — neonbay's farStuck rule).
      const moved = Math.hypot(u.x - u.px, u.z - u.pz) / Math.max(dt, 1e-3);
      u.px = u.x; u.pz = u.z;
      if (u.speed > 10 && moved < 1 && u.reverseT <= 0) {
        u.stuckT += dt;
        if (u.stuckT > 1.4) { u.reverseT = 1.6; u.stuckT = 0; }
      } else u.stuckT = 0;
      if (dist > 170 && moved < 1) u.farStuckT += dt;
      else u.farStuckT = 0;
      u.mesh.position.set(u.x, 0, u.z);
      u.mesh.rotation.y = u.heading;
      // Flashing light bar.
      const bar = u.mesh.userData.lightBar;
      if (bar) bar.rotation.y = Math.floor(performance.now() / 120) % 2 === 0 ? 0 : Math.PI;
      u.dist = dist;
      // v8d #1: physical ram — a police unit is not traffic, so the
      // driving.js traffic bump never saw it, and the unit sailed
      // through the player's car forever (the "cuman keliling doang"
      // complaint). Live play only: staged units are held, and the
      // cover shot's live units never reach the car — the gate is belt
      // and braces on top of that. One counted ram per 0.8 s per unit.
      if (u.ramCooldown > 0) u.ramCooldown -= dt;
      if (!staging && !u.hold && env.inCar && env.car && u.ramCooldown <= 0) {
        const cx = env.car.x - u.x, cz = env.car.z - u.z;
        const cd = Math.hypot(cx, cz);
        if (cd < 4.2 && cd > 0.01) {
          const nx = cx / cd, nz = cz / cd;
          // Closing speed along the contact normal: the unit must be
          // moving INTO the car, not scraping past it.
          const closing = Math.sin(u.heading) * nx + Math.cos(u.heading) * nz;
          if (closing > 0.2 && u.speed > 6) {
            const hitSpeed = u.speed;
            const before = Math.hypot(env.car.vx, env.car.vz);
            // Separate the cars so the unit does not sit inside the
            // player car and re-trigger every frame.
            env.car.x += nx * (4.2 - cd);
            env.car.z += nz * (4.2 - cd);
            u.x -= nx * 1.0; u.z -= nz * 1.0;
            // Shove along the normal + a yaw kick from the off-centre
            // hit (the lateral offset of the car from the unit's axis).
            const perp = cx * Math.cos(u.heading) - cz * Math.sin(u.heading);
            const kick = Math.max(-0.25, Math.min(0.25, perp * 0.06));
            const push = hitSpeed * 0.55 + 4;
            if (env.shoveCar) env.shoveCar(nx * push, nz * push, kick);
            else { env.car.vx += nx * push; env.car.vz += nz * push; env.car.heading += kick; }
            if (env.damageCar) env.damageCar(6 + hitSpeed * 0.15);
            if (audio && audio.crash) audio.crash();
            u.speed *= 0.7;
            u.ramCooldown = 0.8;
            ramCount++;
            const after = Math.hypot(env.car.vx, env.car.vz);
            ramLog.push({ t: Math.round(performance.now() / 1000), unit: u.callsign,
              unitSpeed: Math.round(hitSpeed), carBefore: Math.round(before * 3.6),
              carAfter: Math.round(after * 3.6), kick: Math.round(kick * 100) / 100 });
            if (ramLog.length > 8) ramLog.shift();
          }
        }
      }
    }

    // Far-stuck sweep (see above): remove stranded units after the loop
    // so the iteration above never splices under itself.
    for (let i = units.length - 1; i >= 0; i--) {
      if (units[i].farStuckT > 4) {
        scene.remove(units[i].mesh);
        units.splice(i, 1);
      }
    }

    // v8d #2/#7: foot cops — leonida CopBrain: catch vs shoot. Lethal
    // only when the tier allows (3★+), the cop was ever damaged
    // (provoked, permanent), or the player is armed (holding a gun,
    // not fists). A non-lethal cop approaches a still player to
    // arrest and chases a fleeing one (>2.5 m/s or in a vehicle)
    // without firing; a lethal cop shoots. So a 1–2★ cop facing an
    // unarmed player who stands still walks up and cuffs him — he
    // does not open fire.
    const playerArmed = S.weaponIndex > 0;
    let arrestContact = false;
    for (let i = footCops.length - 1; i >= 0; i--) {
      const cop = footCops[i];
      const cdx = playerPos.x - cop.x, cdz = playerPos.z - cop.z;
      const cdist = Math.hypot(cdx, cdz);
      cop.dist = cdist;
      // The player drove off: the officer returns to the cruiser
      // (despawn; the unit resumes the chase).
      if (env.inCar && cdist > 40) {
        if (cop.unit) cop.unit.bailed = false;
        removeFootCop(scene, cop);
        footCops.splice(i, 1);
        continue;
      }
      const lethal = S.wanted >= 3 || cop.provoked || playerArmed;
      // A lethal cop holds a 12–20 m standoff (leonida CopBrain)
      // instead of running into melee range: back off inside 12 m.
      let target = playerPos;
      if (lethal && cdist < 12) {
        const bx = cop.x - playerPos.x, bz = cop.z - playerPos.z;
        const bl = Math.hypot(bx, bz) || 1;
        target = { x: playerPos.x + bx / bl * 14, z: playerPos.z + bz / bl * 14 };
      }
      updateFootCop(cop, dt, target, colliders);
      // A lethal cop fires (the same tracer + hit roll as a Dredger
      // shot, via combat); a non-lethal cop never shoots.
      if (lethal && combatRef && !cop.dead && cdist < 55) {
        cop.shootTimer -= dt;
        if (cop.shootTimer <= 0 && lineOfSight(colliders, cop.x, cop.z, playerPos.x, playerPos.z)) {
          cop.shootTimer = 1.1 + Math.random() * 1.2;
          combatRef.npcShot({ x: cop.x, y: 1.4, z: cop.z }, playerPos);
        }
      }
      // Only a non-lethal cop in contact counts toward the arrest.
      if (!cop.dead && !lethal && cdist < 2.5 && lineOfSight(colliders, cop.x, cop.z, playerPos.x, playerPos.z)) arrestContact = true;
    }
    // leonida still: under 1.5 m/s on foot, under 1 m/s in a car — a
    // stopped car does not protect you, the cop pulls you out.
    const pSpeed = Math.hypot(playerVel.x, playerVel.z);
    const playerStill = env.inCar ? pSpeed < 1.0 : pSpeed < 1.5;
    const arrestable = S.wanted >= 1 && S.wanted <= 2;
    if (arrest.update(dt, { arrestable, contact: arrestContact, still: playerStill })) {
      bustedFlag = true;
    }
    // "Freeze!" — the one warning before the cuffs (leonida's prompt).
    if (arrest.timer > 0 && !arrestPrompted) {
      arrestPrompted = true;
      showToast('Freeze! Hands where I can see them');
    } else if (arrest.timer === 0) {
      arrestPrompted = false;
    }

    // Helicopter: orbit the player, spotlight tracking — unless pinned
    // for a staged shot, in which case it holds its placed pose.
    if (heli) {
      heli.angle += dt * 0.35;
      if (!heli.pinned) {
        const hx = playerPos.x + Math.cos(heli.angle) * 26;
        const hz = playerPos.z + Math.sin(heli.angle) * 26;
        heli.group.position.set(hx, 42, hz);
        heli.group.lookAt(playerPos.x, 0, playerPos.z);
      }
      heli.group.userData.rotor.rotation.y += dt * 22;
      heli.group.userData.cone.visible = heli.spotlightOn;
      // v8d #3: the Air-1 gunner opens fire from 3 stars (GTA V's
      // helicopter sniper) — live play only, never a staged shot.
      if (!staging && !heli.pinned && combatRef && S.wanted >= 3) {
        heli.fireTimer -= dt;
        if (heli.fireTimer <= 0) {
          heli.fireTimer = 1.6;
          const hp = heli.group.position;
          combatRef.npcShot({ x: hp.x, y: hp.y - 1, z: hp.z }, playerPos, 0.25);
        }
      }
    }
  }

  function blackout() {
    if (heli) heli.spotlightOn = false;
    S.inSight = false;
    setTimeout(() => { if (heli) heli.spotlightOn = true; }, 12000);
  }

  function clearAll() {
    for (const u of units) scene.remove(u.mesh);
    units.length = 0;
    removeHeli();
    // v8d #2: a full clean takes the foot cops and the arrest state too.
    for (const cop of footCops) removeFootCop(scene, cop);
    footCops.length = 0;
    arrest.reset();
    bustedFlag = false;
    arrestPrompted = false;
    S.wanted = 0;
    S.inSight = false;
    S.heat = 0;
    // A respray is a full clean: new plates, new colour — the search
    // state and the hot scenes go with it. (A natural evasion-decay
    // keeps the hot scenes: the scene stays under investigation.)
    S.searchCenter = null;
    S.searchRadius = 0;
    S.lastSeen = null;
    S.hotScenes = [];
  }

  function responseList(playerPos) {
    return units.slice(0, 5).map((u) => ({
      callsign: u.callsign,
      dist: Math.round(Math.hypot(u.x - playerPos.x, u.z - playerPos.z)),
      state: u.state,
    }));
  }

  return { units, addWanted, commitCrime, dropStar, update, clearAll, blackout, responseList,
    // v8d #2: the live foot cops (combat's raycast reads this) + the
    // one-shot bust flag main.js turns into the BUSTED respawn.
    footCops, reportGunfire, damageFootCop,
    takeBusted() { const b = bustedFlag; bustedFlag = false; return b; },
    // v8d: staging (?shot=) runs the pre-v8d police behaviour; main.js
    // sets this once at boot.
    setStaging(v) { staging = !!v; },
    // v8d #3: combat arrives after police is built (see setCombat note).
    setCombat(c) { combatRef = c; },
    // v8d P1 #18R: pedestrians arrive the same way — the witness check
    // needs the live civilian list.
    setPeds(p) { peds = p; },
    // Read-only state for the CDP verification probe (same pattern as
    // window.__probe in main.js).
    probeState() {
      return {
        wanted: S.wanted, heat: S.heat, inSight: S.inSight, live: !staging,
        units: units.map((u) => ({ callsign: u.callsign, state: u.state, mode: u.mode,
          dist: Math.round(u.dist || 0), speed: Math.round(u.speed),
          x: Math.round(u.x), z: Math.round(u.z) })),
        ramCount, ramLog: ramLog.slice(),
        footCops: footCops.map((c) => ({ dist: Math.round(c.dist || 0), hp: c.hp, dead: c.dead })),
        busted: bustedFlag, arrestTimer: Math.round(arrest.timer * 100) / 100,
        lastCrime,
      };
    },
    // Heat progress within the current star band (0..1) for the HUD bar.
    heatProgress() {
      if (S.wanted >= 5) return 1;
      return Math.max(0, Math.min(1, (S.heat - bandMin(S.wanted)) / 100));
    },
    get heli() { return heli; },
    // Staging helpers: place a unit / the heli exactly where a shot needs them.
    spawnUnitForShot(pos) { return spawnUnit(pos); },
    placeUnitAt,
    spawnHeliForShot() { if (!heli) spawnHeli(); },
    // Pin the heli at an exact spot, broadside to the chase camera, so the
    // cover frame always shows it (yaw 0 = nose south, side to the camera).
    placeHeliForShot(x, y, z, yaw) {
      if (!heli) spawnHeli();
      heli.pinned = true;
      heli.group.position.set(x, y, z);
      heli.group.rotation.set(0, yaw, 0);
      return heli;
    } };
}
