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
const HEAT_MAX = 500;
const bandMin = (stars) => (stars <= 0 ? 0 : 34 + (stars - 1) * 100);
const starsFromHeat = (h) => (h < 34 ? 0 : Math.min(5, 1 + Math.floor((h - 34) / 100)));

export function createPolice(scene, colliders, audio) {
  const units = []; // {mesh, callsign, x, z, heading, speed, state, mode}
  let heli = null; // {group, angle, spotlight}
  let spawnTimer = 0;
  let unitCounter = 0;

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
  function commitCrime(type, why, pos = null) {
    S.heat = Math.min(HEAT_MAX, S.heat + (HEAT[type] || 0));
    setStars(starsFromHeat(S.heat), why);
    if (pos) addHotScene(pos.x, pos.z);
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
      path: null, replan: 0, stuckT: 0, reverseT: 0, farStuckT: 0, px: x, pz: z };
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
    heli = { group: g, angle: Math.random() * Math.PI * 2, spotlightOn: true };
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
      path: null, replan: 0, stuckT: 0, reverseT: 0, farStuckT: 0, px: rp.x, pz: rp.z };
    units.push(unit);
    return unit;
  }

  function removeHeli() {
    if (heli) { scene.remove(heli.group); heli = null; }
  }

  function update(dt, playerPos, playerSpeed, playerVel = { x: 0, z: 0 }) {
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
        if (S.wantedTimer > 14 + S.wanted * 4) {
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
      removeHeli();
      return;
    }

    // Helicopter from 3 stars.
    if (S.wanted >= 3 && !heli) spawnHeli();
    if (S.wanted < 3 && heli) removeHeli();

    // Line of sight: any unit within 55 and roughly facing the player sees them.
    let seen = false;
    for (const u of units) {
      const d = Math.hypot(u.x - playerPos.x, u.z - playerPos.z);
      if (d < 55) { seen = true; break; }
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
      // One unit in three sets a roadblock ahead of a fast player.
      if (S.wanted >= 2 && playerSpeed > 30 && (units.indexOf(u) % 3 === 2) && dist < 70 && dist > 25) {
        u.mode = 'block';
        u.state = 'ROADBLOCK';
      } else if (dist < 12) {
        u.mode = 'ram'; u.state = 'RAMMING';
      } else {
        u.mode = 'chase'; u.state = dist < 40 ? 'PURSUIT' : 'SEARCHING';
      }
      if (u.mode === 'block') {
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
        const los = dist < 75 && lineOfSight(colliders, u.x, u.z, playerPos.x, playerPos.z);
        if (los) {
          tx = playerPos.x + playerVel.x * 0.5;
          tz = playerPos.z + playerVel.z * 0.5;
          u.path = null;
        } else {
          u.replan -= dt;
          if (!u.path || u.path.length === 0 || u.replan <= 0) {
            u.path = astar(nearestNode(u.x, u.z), nearestNode(playerPos.x, playerPos.z)).map(nodePos);
            u.replan = 3;
          }
          while (u.path.length > 0 && Math.hypot(u.path[0].x - u.x, u.path[0].z - u.z) < 13) u.path.shift();
          const wp = u.path[0];
          if (wp) { tx = wp.x; tz = wp.z; }
          else { tx = playerPos.x; tz = playerPos.z; }
        }
        let tDiff = Math.atan2(tx - u.x, tz - u.z) - u.heading;
        while (tDiff > Math.PI) tDiff -= Math.PI * 2;
        while (tDiff < -Math.PI) tDiff += Math.PI * 2;
        const top = u.mode === 'ram' ? 52 : 46;
        const vT = Math.max(10, Math.min(top, top - Math.abs(tDiff) * 30));
        u.heading += Math.max(-2.2 * dt, Math.min(2.2 * dt, tDiff));
        u.speed += ((dist > 8 ? vT : 26) - u.speed) * Math.min(1, dt * 1.4);
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
    }

    // Far-stuck sweep (see above): remove stranded units after the loop
    // so the iteration above never splices under itself.
    for (let i = units.length - 1; i >= 0; i--) {
      if (units[i].farStuckT > 4) {
        scene.remove(units[i].mesh);
        units.splice(i, 1);
      }
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
