// KESTREL LAGOON — the wanted system: 1–5 stars, named KLPD units that
// pursue, ram and roadblock, a helicopter with a spotlight from 3 stars,
// line-of-sight search, and the ways to cool down (break sight, respray,
// the hacker's blackout). The HUD's police response list reads from here.
import * as THREE from 'three';
import { S, addRep, showToast, showBanner } from './state.js';
import { POLICE_UNITS } from './config.js';
import { buildCarMesh, modelById } from './vehicles.js';
import { resolveCircle, nearestRoadPoint } from './city.js';

const UNIT_STATES = ['PURSUIT', 'RAMMING', 'ROADBLOCK', 'SEARCHING'];

export function createPolice(scene, colliders, audio) {
  const units = []; // {mesh, callsign, x, z, heading, speed, state, mode}
  let heli = null; // {group, angle, spotlight}
  let spawnTimer = 0;
  let unitCounter = 0;

  function wantedTarget() {
    return Math.min(2 + S.wanted, 7); // units on the street per star
  }

  function addWanted(n, why) {
    const before = S.wanted;
    S.wanted = Math.max(0, Math.min(5, S.wanted + n));
    if (S.wanted > before) {
      S.wantedTimer = 0;
      if (why) showToast(`${why} — wanted ${S.wanted}★`);
      if (S.wanted >= 3 && before < 3) showBanner('AIR SUPPORT INBOUND', 'KLPD Air-1 is overhead — break line of sight');
      if (S.wanted === 5 && before < 5) showBanner('MAXIMUM HEAT', 'Every unit in the lagoon is coming for you');
      addRep(2);
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
    const unit = { mesh, callsign, x, z, heading: Math.atan2(near.x - x, near.z - z), speed: 0, state: 'PURSUIT', mode: 'chase', blockTimer: 0 };
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
    const cone = new THREE.Mesh(new THREE.ConeGeometry(7, 42, 14, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xfff2b0, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
    cone.position.y = -21;
    cone.rotation.x = Math.PI;
    g.add(body, cabin, rotor, tail, stripe, cone);
    g.userData = { rotor, cone };
    scene.add(g);
    heli = { group: g, angle: Math.random() * Math.PI * 2, spotlightOn: true };
    return heli;
  }

  // Staging: place a unit exactly on the nearest road to (x, z) — no random
  // offset, so a staged shot frames identically every run. Pre-placing the
  // full wanted target also stops the update loop spawning random units.
  function placeUnitAt(x, z, px, pz) {
    const callsign = POLICE_UNITS[unitCounter % POLICE_UNITS.length];
    unitCounter++;
    const model = modelById('interceptor');
    const mesh = buildCarMesh(model);
    const rp = nearestRoadPoint(x, z);
    mesh.position.set(rp.x, 0, rp.z);
    mesh.rotation.y = Math.atan2(px - rp.x, pz - rp.z);
    scene.add(mesh);
    const unit = { mesh, callsign, x: rp.x, z: rp.z, heading: Math.atan2(px - rp.x, pz - rp.z), speed: 0, state: 'PURSUIT', mode: 'chase', blockTimer: 0 };
    units.push(unit);
    return unit;
  }

  function removeHeli() {
    if (heli) { scene.remove(heli.group); heli = null; }
  }

  function update(dt, playerPos, playerSpeed) {
    // Wanted decay: hidden long enough and the heat cools off.
    if (S.wanted > 0) {
      const seen = S.inSight;
      if (!seen) {
        S.wantedTimer += dt;
        S.searchZone = Math.max(0, S.searchZone - dt * 2);
        if (S.wantedTimer > 14 + S.wanted * 4) {
          S.wanted -= 1;
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

    for (const u of units) {
      const dx = playerPos.x - u.x, dz = playerPos.z - u.z;
      const dist = Math.hypot(dx, dz);
      const wantAngle = Math.atan2(dx, dz);
      let diff = wantAngle - u.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
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
      } else {
        const top = u.mode === 'ram' ? 52 : 46;
        u.heading += Math.max(-2.2 * dt, Math.min(2.2 * dt, diff));
        u.speed += ((dist > 8 ? top : 26) - u.speed) * Math.min(1, dt * 1.4);
        u.x += Math.sin(u.heading) * u.speed * dt;
        u.z += Math.cos(u.heading) * u.speed * dt;
      }
      const fixed = resolveCircle(colliders, u.x, u.z, 2.1);
      u.x = fixed.x; u.z = fixed.z;
      u.mesh.position.set(u.x, 0, u.z);
      u.mesh.rotation.y = u.heading;
      // Flashing light bar.
      const bar = u.mesh.userData.lightBar;
      if (bar) bar.rotation.y = Math.floor(performance.now() / 120) % 2 === 0 ? 0 : Math.PI;
      u.dist = dist;
    }

    // Helicopter: orbit the player, spotlight tracking.
    if (heli) {
      heli.angle += dt * 0.35;
      const hx = playerPos.x + Math.cos(heli.angle) * 26;
      const hz = playerPos.z + Math.sin(heli.angle) * 26;
      heli.group.position.set(hx, 42, hz);
      heli.group.lookAt(playerPos.x, 0, playerPos.z);
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
  }

  function responseList(playerPos) {
    return units.slice(0, 5).map((u) => ({
      callsign: u.callsign,
      dist: Math.round(Math.hypot(u.x - playerPos.x, u.z - playerPos.z)),
      state: u.state,
    }));
  }

  return { units, addWanted, update, clearAll, blackout, responseList, get heli() { return heli; },
    // Staging helpers: place a unit / the heli exactly where a shot needs them.
    spawnUnitForShot(pos) { return spawnUnit(pos); },
    placeUnitAt,
    spawnHeliForShot() { if (!heli) spawnHeli(); } };
}
