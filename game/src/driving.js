// KESTREL LAGOON — arcade driving: acceleration, braking, handbrake drift,
// building and traffic collisions with damage, and carjacking (F pulls the
// driver out — the driver runs, the wanted level notices).
//
// The car carries a velocity VECTOR (vx, vz); the step itself lives in
// vehicle-model.js (gta7 pattern: forward/lateral decomposition + grip
// bleed + handbrake drift). `car.speed` stays a plain-looking property
// for the staging code (shots.js sets getCar().speed = 41): it reads the
// forward speed and writes the velocity along the current heading.
import * as THREE from 'three';
import { S, addRep, showToast } from './state.js';
import { buildCarMesh, modelById } from './vehicles.js';
import { resolveCircle, clampToWorld } from './city.js';
import { stepVehicle, configFor, forwardSpeed, lateralSpeed, speedOf } from './vehicle-model.js';

export function createDriving(scene, traffic, peds, audio, police) {
  let car = null; // {mesh, model, x, z, heading, vx, vz, health, isPlayer, skid, cfg}
  let staging = false;
  // v8d #10: damage-stage FX — a pooled sprite emitter (smoke, fire,
  // the explosion flash). One shared radial-gradient texture, tinted
  // per sprite (the city.js glow pattern); the pool is scene-level so
  // smoke lingers after the car is gone. Flames are two flickering
  // cones on the hood (the burning-club pattern in city.js).
  let puffTex = null;
  const puffs = []; // { sprite, life, maxLife, vy, grow, fade }
  let flames = null;
  let emitT = 0;
  let explodedCount = 0;

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

  function updateFx(dt) {
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
    if (flames) {
      const f = 0.85 + Math.random() * 0.3;
      flames.outer.scale.set(f, 0.8 + Math.random() * 0.4, f);
      flames.inner.scale.set(f, 0.8 + Math.random() * 0.4, f);
    }
  }

  function attachFlames() {
    if (flames || !car) return;
    const outer = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.4, 6),
      new THREE.MeshBasicMaterial({ color: 0xff7a1a }));
    const inner = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.9, 6),
      new THREE.MeshBasicMaterial({ color: 0xffd166 }));
    outer.position.set(0, 1.2, 1.6);
    inner.position.set(0, 1.0, 1.6);
    car.mesh.add(outer, inner);
    flames = { outer, inner };
  }

  // v8d #10: the explosion — flash + smoke burst + sound, the car is
  // gone, and anyone inside is caught in the blast (the death flow in
  // main.js takes it from here: WASTED + MISSION FAILED if a job was
  // running). Fired by the 3.5 s fuse below, or at once when a single
  // hit takes the car from healthy to 0.
  function explode() {
    if (!car) return;
    const ex = car.x, ez = car.z;
    spawnPuff(ex, 1.5, ez, { color: 0xffa030, opacity: 1, size: 3, life: 0.6, vy: 1, grow: 14, additive: true });
    for (let i = 0; i < 6; i++) {
      spawnPuff(ex + (Math.random() - 0.5) * 3, 1 + Math.random(), ez + (Math.random() - 0.5) * 3,
        { color: 0x333333, opacity: 0.7, size: 1.5, life: 2, vy: 2.5, grow: 3 });
    }
    if (audio && audio.explosion) audio.explosion();
    explodedCount++;
    flames = null; // children of the mesh: removed with it
    scene.remove(car.mesh);
    car = null;
    S.inCar = false;
    S.speedKmh = 0;
    S.vehicleHealth = 0;
    showToast('Your ride blew up!');
    if (S.health > 0) S.health = 0;
  }

  function setStaging(v) { staging = v; }

  function spawnPlayerCar(modelId, x, z, heading) {
    const model = modelById(modelId);
    const mesh = buildCarMesh(model);
    mesh.position.set(x, 0, z);
    mesh.rotation.y = heading;
    scene.add(mesh);
    car = { mesh, model, x, z, heading, vx: 0, vz: 0, health: 100, isPlayer: true, skid: 0, cfg: configFor(model), burnT: 0 };
    Object.defineProperty(car, 'speed', {
      get() { return forwardSpeed(car); },
      set(v) { car.vx = Math.sin(car.heading) * v; car.vz = Math.cos(car.heading) * v; },
      enumerable: true, configurable: true,
    });
    S.inCar = true;
    S.vehicleName = model.name;
    S.vehicleHealth = 100;
    return car;
  }

  function enterCar(nearCar) {
    if (!nearCar) return false;
    // The driver bails and runs.
    if (nearCar.driver) {
      const d = nearCar.driver;
      d.fleeing = 6;
      nearCar.driver = null;
    }
    traffic.removeCar(nearCar);
    spawnPlayerCar(nearCar.model.id, nearCar.x, nearCar.z, nearCar.heading);
    S.stats.carsStolen += 1;
    addRep(5);
    police.commitCrime('carjack', 'Vehicle stolen', { x: nearCar.x, z: nearCar.z });
    showToast(`Vehicle stolen: ${nearCar.model.name}`);
    return true;
  }

  function exitCar() {
    if (!car) return null;
    const spot = { x: car.x - Math.sin(car.heading + Math.PI / 2) * 2.5, z: car.z - Math.cos(car.heading + Math.PI / 2) * 2.5 };
    // Leave the car parked where it stands, as traffic.
    const parked = traffic.spawnCar(car.x, car.z, car.heading, car.model);
    parked.parked = true; parked.speed = 0; parked.targetSpeed = 0;
    flames = null; // children of the mesh: removed with it
    scene.remove(car.mesh);
    car = null;
    S.inCar = false;
    S.speedKmh = 0;
    return spot;
  }

  function damage(amount, why) {
    if (!car) return;
    car.health = Math.max(0, car.health - amount);
    S.vehicleHealth = car.health;
    if (car.health <= 0) {
      if (staging) {
        // Staged captures keep the pre-v8d wreck (no explosion).
        showToast('Your ride is wrecked!');
        audio.crash();
        exitCar();
      } else {
        explode();
      }
      void why;
    }
  }

  function update(dt, input, colliders, frozen) {
    // FX runs even with no car: smoke from a wreck lingers ~2 s.
    updateFx(dt);
    if (!car || frozen) return car;
    const { f, s } = input.axis();
    // The pure step moves the car and rotates the velocity with it.
    stepVehicle(car, { throttle: f, steer: s, handbrake: input.handbrake }, car.cfg, dt);
    // Collisions: buildings stop the car hard; traffic bumps it.
    const intended = { x: car.x, z: car.z };
    const fixed = resolveCircle(colliders, car.x, car.z, 2.1);
    const pushX = fixed.x - intended.x, pushZ = fixed.z - intended.z;
    const hitWall = Math.hypot(pushX, pushZ) > 0.01;
    car.x = fixed.x; car.z = fixed.z;
    const clamped = clampToWorld(car.x, car.z, 14);
    if (clamped.x !== car.x) { car.x = clamped.x; car.vx = 0; }
    if (clamped.z !== car.z) { car.z = clamped.z; car.vz = 0; }
    const v = speedOf(car);
    if (hitWall && v > 8) {
      damage(v * 0.35, 'crash');
      audio.crash();
      // Bounce off the wall: reflect the velocity component along the
      // push-out normal with 0.25 restitution, keep the tangential slide.
      const n = Math.hypot(pushX, pushZ) || 1;
      const nx = pushX / n, nz = pushZ / n;
      const vn = car.vx * nx + car.vz * nz;
      if (vn < 0) {
        car.vx -= 1.25 * vn * nx;
        car.vz -= 1.25 * vn * nz;
      }
    }
    const other = traffic.nearestCar(car.x, car.z, 4.5, null);
    if (other && v > 6) {
      damage(4, 'traffic');
      audio.crash();
      car.vx *= 0.55; car.vz *= 0.55;
      other.speed = Math.max(0, other.speed - 6);
    }
    // Skid: handbrake at speed, or a big sideways slide from the drift.
    const vLat = Math.abs(lateralSpeed(car));
    const sliding = (input.handbrake && Math.abs(forwardSpeed(car)) > 12) || vLat > 8;
    car.skid = sliding ? Math.min(1, car.skid + dt * 3) : Math.max(0, car.skid - dt * 4);
    car.mesh.position.set(car.x, 0, car.z);
    car.mesh.rotation.y = car.heading;
    car.mesh.rotation.z = car.skid * 0.06 * (s !== 0 ? s : 1);
    // v8d #10: damage stages (fable) — smoke under 55 HP, fire under
    // 25, and a burning car explodes 3.5 s later unless you bail.
    // Live play only: a staged car keeps its clean look.
    if (!staging) {
      const stage = car.health >= 55 ? 'ok' : car.health >= 25 ? 'smoke' : 'fire';
      if (stage !== 'ok') {
        emitT -= dt;
        const rate = stage === 'fire' ? 0.08 : 0.16;
        if (emitT <= 0) {
          emitT = rate;
          const hx = car.x + Math.sin(car.heading) * 1.6;
          const hz = car.z + Math.cos(car.heading) * 1.6;
          spawnPuff(hx, 1.1, hz, { color: 0x555555, opacity: 0.55, size: 1.2, life: 1.4, vy: 1.6, grow: 2.2 });
          if (stage === 'fire') {
            spawnPuff(hx, 1.2, hz, { color: 0xff8c1a, opacity: 0.8, size: 1.0, life: 0.35, vy: 2.2, grow: 1.5, additive: true });
            attachFlames();
          }
        }
      }
      if (stage === 'fire') {
        car.burnT += dt;
        if (car.burnT > 3.5) { explode(); return car; }
      }
    }
    S.speedKmh = speedOf(car) * 3.6;
    S.gear = forwardSpeed(car) < 1 ? 1 : Math.min(6, 1 + Math.floor(Math.abs(forwardSpeed(car)) / 10));
    S.stats.distanceDriven += speedOf(car) * dt;
    return car;
  }

  function getCar() { return car; }
  function destroyCar() { flames = null; if (car) { scene.remove(car.mesh); car = null; S.inCar = false; } }

  function probeState() {
    return {
      health: car ? Math.round(car.health) : null,
      stage: !car ? 'none' : car.health >= 55 ? 'ok' : car.health >= 25 ? 'smoke' : 'fire',
      burnT: car ? Math.round(car.burnT * 10) / 10 : 0,
      exploded: explodedCount,
      puffs: puffs.length,
    };
  }

  // v8d #1: a shove from an outside force (a police ram) — an impulse
  // on the velocity vector plus a yaw kick, so an off-centre hit spins
  // the car. The skid flash sells the impact for a frame or two.
  function shove(ix, iz, yawKick) {
    if (!car) return;
    car.vx += ix; car.vz += iz;
    car.heading += yawKick || 0;
    car.skid = Math.min(1, car.skid + 0.6);
  }

  return { spawnPlayerCar, enterCar, exitCar, damage, update, getCar, destroyCar, shove, setStaging, probeState };
}
