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
  let lastHeadshotToast = 0; // v8d #11: throttle the HEADSHOT toast

  // v8d P1 #19 — GRENADES: thrown projectiles with a fuse + blast.
  // A thrown grenade arcs (gravity 22, the same as the jump) and
  // detonates after GRENADE_FUSE seconds: blast radius 9 m (leonida's
  // heli-crash blast), damage 120 at the centre falling to 0 at the
  // edge, flash + smoke + the explosion sound, and one 'explosion'
  // crime (heat 100, witness-gated like any minor crime). The blast
  // hurts enemies, peds, foot cops and the player themself — GTA
  // grenades do not discriminate. Ped deaths from a blast are part
  // of the explosion crime, not separate killPed crimes.
  const GRENADE_FUSE = 1.8;
  const GRENADE_RADIUS = 9;
  const GRENADE_DAMAGE = 120; // centre damage (config WEAPONS grenade.damage)
  const GRENADE_THROW_SPEED = 16;
  const GRENADE_UP = 7;
  const GRENADE_GRAVITY = 22;
  const grenades = []; // { mesh, x, y, z, vx, vy, vz, fuse }
  let explosionCount = 0;
  let lastBlast = null; // { x, z, kills, hitPlayer } — probe-visible.
  // Blast FX: a pooled sprite emitter (flash + smoke), following the
  // driving.js car-explosion pattern — one shared radial-gradient
  // texture, tinted per sprite.
  let puffTex = null;
  const puffs = []; // { sprite, life, maxLife, vy, grow, fade }
  function getPuffTex() {
    if (puffTex) return puffTex;
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.4)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    puffTex = new THREE.CanvasTexture(c);
    return puffTex;
  }
  function spawnPuff(x, y, z, opts) {
    if (puffs.length >= 24) return;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getPuffTex(), transparent: true, depthWrite: false,
      color: opts.color, opacity: opts.opacity,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    }));
    sprite.position.set(x, y, z);
    sprite.scale.set(opts.size, opts.size, 1);
    scene.add(sprite);
    puffs.push({ sprite, life: 0, maxLife: opts.life, vy: opts.vy, grow: opts.grow, fade: opts.opacity });
  }
  function updatePuffs(dt) {
    for (let i = puffs.length - 1; i >= 0; i--) {
      const p = puffs[i];
      p.life += dt;
      if (p.life >= p.maxLife) {
        scene.remove(p.sprite);
        p.sprite.material.dispose();
        puffs.splice(i, 1);
        continue;
      }
      const k = p.life / p.maxLife;
      p.sprite.position.y += p.vy * dt;
      const s = p.sprite.scale.x + p.grow * dt;
      p.sprite.scale.set(s, s, 1);
      p.sprite.material.opacity = p.fade * (1 - k);
    }
  }

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
    // v8d P1 #19: a death/bust clears live grenades too — a blast
    // after the respawn would punish the wrong Rook.
    for (const g of grenades) scene.remove(g.mesh);
    grenades.length = 0;
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
      if (perp < 1.6 && along < bestD) { bestD = along; best = { kind: 'enemy', ref: e, dist: along, perp }; }
    }
    for (const p of peds.peds) {
      if (p.dead) continue;
      const t = { x: p.x - origin.x, z: p.z - origin.z };
      const along = t.x * dir.x + t.z * dir.z;
      if (along < 0 || along > w.range) continue;
      const perp = Math.abs(t.x * dir.z - t.z * dir.x);
      if (perp < 1.4 && along < bestD) { bestD = along; best = { kind: 'ped', ref: p, dist: along, perp }; }
    }
    // v8d #4: foot cops are hittable too (attackCop / killCop).
    for (const c of police.footCops || []) {
      if (c.dead) continue;
      const t = { x: c.x - origin.x, z: c.z - origin.z };
      const along = t.x * dir.x + t.z * dir.z;
      if (along < 0 || along > w.range) continue;
      const perp = Math.abs(t.x * dir.z - t.z * dir.x);
      if (perp < 1.4 && along < bestD) { bestD = along; best = { kind: 'cop', ref: c, dist: along, perp }; }
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
    // v8d P1 #19: a grenade is thrown, not fired — no hitscan, no
    // tracer, no gunfire report (the blast reports itself on
    // detonation). The throw takes 0.8 s to recover from.
    if (w.id === 'grenade') {
      fireCooldown = 0.8;
      throwGrenade(origin, dir);
      return true;
    }
    fireCooldown = w.auto ? 0.09 : 0.28;
    // Spread + tracer.
    const spread = (Math.random() - 0.5) * (w.id === 'shotgun' ? 0.14 : 0.03);
    const d = { x: dir.x + Math.cos(Math.atan2(dir.z, dir.x)) * spread, z: dir.z };
    const hit = raycastTargets(origin, d);
    const endDist = hit ? hit.dist : w.range;
    if (hit) {
      S.stats.shotsHit += 1;
      // v8d #11: headshot (fable 2.5×). Kestrel aims in 2D — yaw
      // only, no pitch — so the head is the dead-centre hit: the ray
      // passes within 0.35 m of the target's centreline, where the
      // head sits. A wider hit strikes the body. (A full pitch-aim
      // system would be needed for a geometric head sphere; that is
      // out of scope for this submit.) Melee never headshots.
      const headshot = hit.perp < 0.35;
      if (headshot) {
        S.stats.headshots += 1;
        if (now - lastHeadshotToast > 1.5) {
          lastHeadshotToast = now;
          showToast('HEADSHOT — 2.5× damage');
        }
      }
      applyHit(hit, w.damage * (headshot ? 2.5 : 1));
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
    // v8d #4: every shot counts toward the heat (the old wanted===0
    // gate meant sustained shooting never raised a star). Staging is
    // exempt inside reportGunfire.
    police.reportGunfire({ x: origin.x, z: origin.z });
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
    } else if (hit.kind === 'cop') {
      // v8d #4: the heat (attackCop / killCop) lives in police.
      if (police.damageFootCop(hit.ref, damage) === 'killed') {
        S.stats.kills += 1;
        showToast('Officer down');
      }
    }
  }

  // v8d P1 #19: throw a grenade — a small dark sphere arcing away
  // from the player, fused 1.8 s. Throw range at full arc is ~25 m,
  // well outside the 9 m blast, so a careful throw never hurts Rook.
  function throwGrenade(origin, dir) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 8, 6),
      new THREE.MeshLambertMaterial({ color: 0x2a3325 }));
    const sx = origin.x + dir.x * 1.0, sz = origin.z + dir.z * 1.0;
    mesh.position.set(sx, origin.y, sz);
    scene.add(mesh);
    grenades.push({
      mesh, x: sx, y: origin.y, z: sz,
      vx: dir.x * GRENADE_THROW_SPEED, vy: GRENADE_UP, vz: dir.z * GRENADE_THROW_SPEED,
      fuse: GRENADE_FUSE,
    });
  }

  // v8d P1 #19: the blast — flash + smoke + sound, area damage with
  // linear falloff, one 'explosion' crime (witness-gated), and peds
  // fleeing the blast like gunfire. Kills are counted for the probe.
  function detonate(g, playerPos) {
    scene.remove(g.mesh);
    g.mesh.geometry.dispose();
    g.mesh.material.dispose();
    spawnPuff(g.x, 1.5, g.z, { color: 0xffa030, opacity: 1, size: 3, life: 0.6, vy: 1, grow: 14, additive: true });
    for (let i = 0; i < 6; i++) {
      spawnPuff(g.x + (Math.random() - 0.5) * 3, 1 + Math.random(), g.z + (Math.random() - 0.5) * 3,
        { color: 0x333333, opacity: 0.7, size: 1.5, life: 2, vy: 2.5, grow: 3 });
    }
    audio.explosion();
    explosionCount++;
    let kills = 0;
    let hitPlayer = false;
    const blastDmg = (d) => GRENADE_DAMAGE * (1 - d / GRENADE_RADIUS);
    for (const e of enemies) {
      if (e.dead) continue;
      const d = Math.hypot(e.x - g.x, e.z - g.z);
      if (d < GRENADE_RADIUS) {
        const before = e.hp;
        applyHit({ kind: 'enemy', ref: e }, blastDmg(d));
        if (before > 0 && e.hp <= 0) kills++;
      }
    }
    for (const p of peds.peds) {
      if (p.dead) continue;
      const d = Math.hypot(p.x - g.x, p.z - g.z);
      // A blast kills outright inside 6 m, wounds beyond that (peds
      // have no HP model — inside the kill radius they fall).
      if (d < 6) { peds.killPed(p); kills++; }
    }
    for (const c of police.footCops || []) {
      if (c.dead) continue;
      const d = Math.hypot(c.x - g.x, c.z - g.z);
      if (d < GRENADE_RADIUS && police.damageFootCop(c, blastDmg(d)) === 'killed') kills++;
    }
    if (playerPos) {
      const d = Math.hypot(playerPos.x - g.x, playerPos.z - g.z);
      if (d < GRENADE_RADIUS) {
        hitPlayer = true;
        const dmg = Math.round(blastDmg(d));
        if (S.armour > 0) {
          const absorbed = Math.min(S.armour, dmg);
          S.armour -= absorbed;
          S.health -= (dmg - absorbed);
        } else S.health -= dmg;
      }
    }
    // One explosion crime for the whole blast (heat 100, witness-gated
    // — an unseen blast in the middle of nowhere may go unreported).
    police.commitCrime('explosion', 'Explosion', { x: g.x, z: g.z });
    // Peds + traffic flee a blast like gunfire.
    gunfireAt = { x: g.x, z: g.z };
    gunfireTimer = 1.2;
    lastBlast = { x: Math.round(g.x), z: Math.round(g.z), kills, hitPlayer };
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

    // v8d P1 #19: grenade ballistics — gravity arc, a damped bounce
    // off the ground, detonation when the fuse runs out.
    updatePuffs(dt);
    for (let i = grenades.length - 1; i >= 0; i--) {
      const g = grenades[i];
      g.fuse -= dt;
      g.vy -= GRENADE_GRAVITY * dt;
      g.x += g.vx * dt;
      g.y += g.vy * dt;
      g.z += g.vz * dt;
      if (g.y < 0.14) {
        g.y = 0.14;
        g.vy = -g.vy * 0.35;
        g.vx *= 0.7;
        g.vz *= 0.7;
      }
      g.mesh.position.set(g.x, g.y, g.z);
      if (g.fuse <= 0) {
        grenades.splice(i, 1);
        detonate(g, playerPos);
      }
    }

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

  // v8d #3: an NPC shot at the player (foot cops from 2 stars, the
  // Air-1 gunner from 3) — the same tracer + hit roll + armour-first
  // damage as a Dredger shot, from an arbitrary origin.
  function npcShot(from, target, hitChance = 0.3) {
    const now = performance.now() / 1000;
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(from.x, from.y, from.z),
      new THREE.Vector3(target.x, 1.2, target.z),
    ]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xff6b4a, transparent: true, opacity: 0.8 }));
    scene.add(line);
    tracers.push({ line, until: now + 0.09 });
    audio.gunshot();
    if (Math.random() < hitChance) {
      const dmg = 8 + Math.floor(Math.random() * 8);
      if (S.armour > 0) {
        const absorbed = Math.min(S.armour, dmg);
        S.armour -= absorbed;
        S.health -= (dmg - absorbed);
      } else S.health -= dmg;
    }
  }

  // v8c #21: GTA-style soft lock-on (fable player.js aimAssist pattern —
  // NO LICENSE, pattern only, Kestrel's own code). While aiming on foot,
  // the aim snaps to the closest target inside a 20° cone (cos 0.94)
  // and tracks it gently while it stays inside a 10° cone (cos 0.985).
  // Enemies score a small bonus over bystanders so the crosshair picks
  // the threat first. The camera steering itself lives in player.js
  // (steerToTarget); this module only picks and holds the target.
  let locked = null; // { kind: 'enemy'|'ped', ref }
  function lockPos(entry) {
    if (!entry) return null;
    const r = entry.ref;
    return { x: r.x, z: r.z, dead: !!r.dead };
  }
  function updateLockOn(origin, camYaw, aiming) {
    if (!aiming) { locked = null; return null; }
    const fwd = { x: Math.sin(camYaw), z: Math.cos(camYaw) };
    // Hold the current lock while the target is alive, in range and
    // inside the tighter tracking cone.
    if (locked) {
      const t = lockPos(locked);
      const dx = t.x - origin.x, dz = t.z - origin.z;
      const d = Math.hypot(dx, dz);
      const cos = d > 0.01 ? (dx * fwd.x + dz * fwd.z) / d : 0;
      if (t.dead || d < 1.5 || d > 45 || cos < 0.985) locked = null;
    }
    if (!locked) {
      // Snap: the best-scoring target inside the 20° acceptance cone.
      // Score prefers centred targets, then near ones (fable's formula).
      let best = null, bestScore = 0.94;
      const consider = (kind, ref, bonus) => {
        const dx = ref.x - origin.x, dz = ref.z - origin.z;
        const d = Math.hypot(dx, dz);
        if (d < 1.5 || d > 45) return;
        const cos = (dx * fwd.x + dz * fwd.z) / d;
        const score = cos - d * 0.0008 + bonus;
        if (score > bestScore) { bestScore = score; best = { kind, ref }; }
      };
      for (const e of enemies) if (!e.dead) consider('enemy', e, 0.02);
      for (const pd of peds.peds) if (!pd.dead) consider('ped', pd, 0);
      if (best) {
        locked = best;
        const t = lockPos(best);
        return { x: t.x, z: t.z, snapped: true };
      }
      return null;
    }
    const t = lockPos(locked);
    return { x: t.x, z: t.z, snapped: false };
  }

  return {
    enemies, fire, reload, switchWeapon, spawnEnemies, clearEnemies, update,
    currentWeapon, aimDirection, updateLockOn, npcShot,
    // v8d #11: enemy HP + headshot count for the probe.
    // v8d #15: enemy positions too, so the soft-lock probe can walk
    // to the nearest live enemy and prove the kill stage completable.
    probeState() {
      return {
        enemies: enemies.map((e) => ({ x: Math.round(e.x), z: Math.round(e.z), hp: Math.round(e.hp), dead: e.dead })),
        headshots: S.stats.headshots,
        shotsHit: S.stats.shotsHit,
        shotsFired: S.stats.shotsFired,
        // v8d P1 #19: live grenades + blast history for the grenade probe.
        grenadesLive: grenades.length,
        explosions: explosionCount,
        lastBlast,
      };
    },
    get gunfireAt() { return gunfireAt; },
    get reloading() { return performance.now() / 1000 < reloadUntil; },
    // The live lock target for the HUD crosshair (null when not locked).
    get lockTarget() {
      if (!locked) return null;
      const t = lockPos(locked);
      return t.dead ? null : { x: t.x, z: t.z, kind: locked.kind };
    },
    forceMuzzle(origin) {
      muzzle.position.set(origin.x, origin.y + 0.45, origin.z);
      muzzle.visible = true;
      muzzleUntil = performance.now() / 1000 + 3; // long enough to survive capture latency
    },
  };
}
