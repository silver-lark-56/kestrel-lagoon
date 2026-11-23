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

  // Muzzle flash: a bright core + halo + an additive star-sprite at the
  // barrel, so the gunshot reads at a glance. The glow is a 4-point star
  // (long cardinal spikes, short diagonal spikes) over a hot core — it
  // reads as a gunshot, not a flat disc. Kept modest so it never
  // swallows the frame.
  {
    const g = new THREE.Group();
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.5, 6, 5),
      new THREE.MeshBasicMaterial({ color: 0xfff6c0 }));
    const halo = new THREE.Mesh(new THREE.SphereGeometry(0.8, 6, 5),
      // depthWrite off: the halo must not occlude the star sprite that
      // sits at its centre, or the star vanishes and only a flat disc
      // shows (v3 first try: the 1.0 m halo hid the 2.2 m star).
      new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0.4, depthWrite: false }));
    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = 128; glowCanvas.height = 128;
    const gg = glowCanvas.getContext('2d');
    gg.translate(64, 64);
    // Hot core.
    const grad = gg.createRadialGradient(0, 0, 2, 0, 0, 26);
    grad.addColorStop(0, 'rgba(255,255,240,1)');
    grad.addColorStop(0.5, 'rgba(255,220,120,0.9)');
    grad.addColorStop(1, 'rgba(255,150,50,0)');
    gg.fillStyle = grad;
    gg.beginPath(); gg.arc(0, 0, 26, 0, Math.PI * 2); gg.fill();
    // Spikes: a triangle from the centre to a sharp tip, rotated.
    function spike(angle, len, wdt, color) {
      gg.save();
      gg.rotate(angle);
      gg.fillStyle = color;
      gg.beginPath();
      gg.moveTo(0, -wdt);
      gg.lineTo(len, 0);
      gg.lineTo(0, wdt);
      gg.closePath();
      gg.fill();
      gg.restore();
    }
    for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) spike(a, 62, 5, 'rgba(255,200,90,0.95)');
    for (const a of [Math.PI / 4, 3 * Math.PI / 4, -Math.PI / 4, -3 * Math.PI / 4]) spike(a, 34, 4, 'rgba(255,160,60,0.85)');
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(glowCanvas), transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    glow.scale.set(2.6, 2.6, 1);
    g.add(core, halo, glow);
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
      const mesh = buildPersonMesh(0xb03a30, rng.pick([0xc98d5f, 0xe8b98d, 0x8a5a3b]), 1.02,
        { hair: 0x1c1c22, hairStyle: 'short', accessory: 'bandana' });
      mesh.position.set(ex, 0, ez);
      // Red marker above every live enemy: at night a dark-red shirt on
      // a dark street is nearly invisible, so the firefight reads as
      // "Rook shooting at nothing" (v3 combat shot). The marker is a
      // plain gameplay aid (GTA-style threat diamond), not staging.
      const marker = new THREE.Group();
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.8, 4),
        new THREE.MeshBasicMaterial({ color: 0xff2a2a }));
      spike.rotation.x = Math.PI; // point down at the enemy
      marker.add(spike);
      marker.position.set(0, 2.7, 0);
      mesh.add(marker);
      scene.add(mesh);
      enemies.push({
        mesh, x: ex, z: ez, hp: 60, heading: 0, shootTimer: rng.range(0.5, 2),
        walkPhase: rng.range(0, 6), dead: false, speed: rng.range(2.4, 3.4),
        marker,
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
    if (S.wanted === 0) police.commitCrime('gunfire', 'Shots fired', { x: origin.x, z: origin.z });
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
        if (e.marker) e.marker.visible = false; // dead enemies lose their marker
        S.stats.kills += 1;
        S.stageKills += 1;
        addRep(10);
        showToast('Dredger down');
      }
    } else if (hit.kind === 'ped') {
      peds.killPed(hit.ref);
      police.commitCrime('killPed', 'Civilian down', { x: hit.ref.x, z: hit.ref.z });
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
      // Marker spins and bobs so it catches the eye even at range.
      if (e.marker) {
        e.marker.rotation.y += dt * 2;
        e.marker.position.y = 2.7 + Math.sin(now * 2.5 + e.walkPhase) * 0.12;
      }
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
