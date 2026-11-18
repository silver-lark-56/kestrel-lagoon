// KESTREL LAGOON — combat: five weapons, hitscan shooting with spread and
// tracers, muzzle flash, reloads, drive-by fire from the car, and the
// Dredger enemies who shoot back during kill stages.
import * as THREE from 'three';
import { S, addRep, showToast } from './state.js';
import { WEAPONS } from './config.js';
import { buildPersonMesh } from './pedestrians.js';
import { makeRng } from './random.js';

export function createCombat(scene, camera, audio, police, peds) {
  const enemies = [];
  const tracers = [];
  let muzzle = null;
  let muzzleUntil = 0;
  let fireCooldown = 0;
  let reloadUntil = 0;
  let gunfireAt = null;
  let gunfireTimer = 0;

  // Muzzle flash: a small additive sprite at the barrel.
  {
    const g = new THREE.Group();
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.42, 6, 5),
      new THREE.MeshBasicMaterial({ color: 0xffe9a8 }));
    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.7, 6, 5),
      new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0.55 }));
    g.add(core, halo);
    g.visible = false;
    scene.add(g);
    muzzle = g;
  }

  function currentWeapon() { return WEAPONS[S.weaponIndex]; }

  function switchWeapon(i) {
    if (i < 0 || i >= WEAPONS.length) return;
    if (!S.ownedWeapons.includes(i)) {
      showToast(`${WEAPONS[i].name} — buy it at Harbor Arms`);
      audio.denied();
      return;
    }
    S.weaponIndex = i;
    audio.click();
  }

  function reload() {
    const w = currentWeapon();
    const a = S.ammo[S.weaponIndex];
    if (a.mag === Infinity || a.reserve <= 0 || a.mag >= w.ammo) return;
    reloadUntil = performance.now() / 1000 + 1.1;
    showToast(`Reloading ${w.name}…`);
  }

  function spawnEnemies(x, z, count, seed = 5) {
    const rng = makeRng(seed + count * 31);
    for (let i = 0; i < count; i++) {
      const ex = x + rng.range(-18, 18), ez = z + rng.range(-18, 18);
      const mesh = buildPersonMesh(0x8a2f2f, rng.pick([0xc98d5f, 0xe8b98d, 0x8a5a3b]), 1.02);
      mesh.position.set(ex, 0, ez);
      scene.add(mesh);
      enemies.push({
        mesh, x: ex, z: ez, hp: 60, heading: 0, shootTimer: rng.range(0.5, 2),
        walkPhase: rng.range(0, 6), dead: false, speed: rng.range(2.4, 3.4),
      });
    }
  }

  function clearEnemies() {
    for (const e of enemies) scene.remove(e.mesh);
    enemies.length = 0;
  }

  function raycastTargets(origin, dir) {
    // Cheap hitscan: nearest enemy or ped within a cone of the ray.
    let best = null, bestD = Infinity;
    const w = currentWeapon();
    for (const e of enemies) {
      if (e.dead) continue;
      const t = { x: e.x - origin.x, z: e.z - origin.z };
      const along = t.x * dir.x + t.z * dir.z;
      if (along < 0 || along > w.range) continue;
      const perp = Math.abs(t.x * dir.z - t.z * dir.x);
      if (perp < 1.6 && along < bestD) { bestD = along; best = { kind: 'enemy', ref: e, dist: along }; }
    }
    for (const p of peds.peds) {
      if (p.dead) continue;
      const t = { x: p.x - origin.x, z: p.z - origin.z };
      const along = t.x * dir.x + t.z * dir.z;
      if (along < 0 || along > w.range) continue;
      const perp = Math.abs(t.x * dir.z - t.z * dir.x);
      if (perp < 1.4 && along < bestD) { bestD = along; best = { kind: 'ped', ref: p, dist: along }; }
    }
    return best;
  }

  function fire(origin, dir, fromCar) {
    const now = performance.now() / 1000;
    if (now < reloadUntil) return false;
    if (fireCooldown > 0) return false;
    const w = currentWeapon();
    const a = S.ammo[S.weaponIndex];
    if (w.id === 'fists') {
      fireCooldown = 0.45;
      audio.punch();
      const hit = raycastTargets(origin, dir);
      if (hit && hit.dist < 3.5) applyHit(hit, w.damage);
      return true;
    }
    if (a.mag <= 0) {
      if (a.reserve > 0) reload();
      else { showToast('Out of ammo — visit Harbor Arms'); audio.denied(); }
      fireCooldown = 0.3;
      return false;
    }
    a.mag -= 1;
    S.stats.shotsFired += 1;
    fireCooldown = w.auto ? 0.09 : 0.28;
    // Spread + tracer.
    const spread = (Math.random() - 0.5) * (w.id === 'shotgun' ? 0.14 : 0.03);
    const d = { x: dir.x + Math.cos(Math.atan2(dir.z, dir.x)) * spread, z: dir.z };
    const hit = raycastTargets(origin, d);
    const endDist = hit ? hit.dist : w.range;
    if (hit) {
      S.stats.shotsHit += 1;
      applyHit(hit, w.damage);
    }
    // Tracer line.
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(origin.x, origin.y, origin.z),
      new THREE.Vector3(origin.x + d.x * endDist, origin.y, origin.z + d.z * endDist),
    ]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.9 }));
    scene.add(line);
    tracers.push({ line, until: now + 0.07 });
    // Muzzle flash at the barrel, lifted above the shooter's head so the
    // chase camera can see it (never shorten a longer staged flash).
    muzzle.position.set(origin.x + d.x * 1.2, origin.y + 0.45, origin.z + d.z * 1.2);
    muzzle.visible = true;
    muzzleUntil = Math.max(muzzleUntil, now + 0.06);
    audio.gunshot();
    gunfireAt = { x: origin.x, z: origin.z };
    gunfireTimer = 1.2;
    if (S.wanted === 0) police.addWanted(1, 'Shots fired');
    void fromCar;
    return true;
  }

  function applyHit(hit, damage) {
    if (hit.kind === 'enemy') {
      const e = hit.ref;
      e.hp -= damage;
      if (e.hp <= 0 && !e.dead) {
        e.dead = true;
        e.mesh.rotation.x = -Math.PI / 2;
        e.mesh.position.y = 0.4;
        S.stats.kills += 1;
        S.stageKills += 1;
        addRep(10);
        showToast('Dredger down');
      }
    } else if (hit.kind === 'ped') {
      peds.killPed(hit.ref);
      police.addWanted(1, 'Civilian down');
      addRep(-15);
    }
  }

  function update(dt, playerPos) {
    fireCooldown = Math.max(0, fireCooldown - dt);
    const now = performance.now() / 1000;
    if (now > muzzleUntil) muzzle.visible = false;
    if (now > reloadUntil && reloadUntil > 0) {
      // Finish the reload.
      const w = currentWeapon();
      const a = S.ammo[S.weaponIndex];
      const need = w.ammo - a.mag;
      const take = Math.min(need, a.reserve);
      a.mag += take; a.reserve -= take;
      reloadUntil = 0;
    }
    for (let i = tracers.length - 1; i >= 0; i--) {
      if (now > tracers[i].until) {
        scene.remove(tracers[i].line);
        tracers[i].line.geometry.dispose();
        tracers.splice(i, 1);
      }
    }
    if (gunfireTimer > 0) gunfireTimer -= dt;
    else gunfireAt = null;

    // Enemies advance and shoot back.
    for (const e of enemies) {
      if (e.dead) continue;
      const dx = playerPos.x - e.x, dz = playerPos.z - e.z;
      const dist = Math.hypot(dx, dz);
      e.heading = Math.atan2(dx, dz);
      if (dist > 14) {
        e.x += Math.sin(e.heading) * e.speed * dt;
        e.z += Math.cos(e.heading) * e.speed * dt;
        e.walkPhase += dt * 7;
      }
      e.shootTimer -= dt;
      if (e.shootTimer <= 0 && dist < 55) {
        e.shootTimer = 1.1 + Math.random() * 1.2;
        // Enemy shot: a tracer toward the player, hits sometimes.
        const geo = new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(e.x, 1.4, e.z),
          new THREE.Vector3(playerPos.x, 1.2, playerPos.z),
        ]);
        const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xff6b4a, transparent: true, opacity: 0.8 }));
        scene.add(line);
        tracers.push({ line, until: now + 0.09 });
        audio.gunshot();
        if (Math.random() < 0.3) {
          const dmg = 8 + Math.floor(Math.random() * 8);
          if (S.armour > 0) {
            const absorbed = Math.min(S.armour, dmg);
            S.armour -= absorbed;
            S.health -= (dmg - absorbed);
          } else S.health -= dmg;
        }
      }
      const u = e.mesh.userData;
      const swing = Math.sin(e.walkPhase) * 0.5;
      u.legL.rotation.x = swing; u.legR.rotation.x = -swing;
      e.mesh.position.set(e.x, 0, e.z);
      e.mesh.rotation.y = e.heading;
    }
  }

  function aimDirection(camYaw) {
    return { x: Math.sin(camYaw), z: Math.cos(camYaw) };
  }

  return {
    enemies, fire, reload, switchWeapon, spawnEnemies, clearEnemies, update,
    currentWeapon, aimDirection,
    get gunfireAt() { return gunfireAt; },
    get reloading() { return performance.now() / 1000 < reloadUntil; },
    forceMuzzle(origin) {
      muzzle.position.set(origin.x, origin.y + 0.45, origin.z);
      muzzle.visible = true;
      muzzleUntil = performance.now() / 1000 + 3; // long enough to survive capture latency
    },
  };
}
