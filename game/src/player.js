// KESTREL LAGOON — Rook on foot: third-person movement with a sprint,
// a smooth chase camera that orbits with the mouse, and the aim pose.
// The camera rig is shared with driving: one camera, two follow modes.
import * as THREE from 'three';
import { S } from './state.js';
import { buildPersonMesh } from './pedestrians.js';
import { resolveCircle, clampToWorld } from './city.js';

export function createPlayer(scene) {
  const mesh = buildPersonMesh(0xff8a3c, 0xe8b98d, 1.05,
    { hair: 0x2b2018, hairStyle: 'short', accessory: 'cap', accessoryColor: 0x1c2a4a });
  scene.add(mesh);
  const p = {
    mesh, x: -200, z: 140, heading: Math.PI * 0.25, walkPhase: 0,
    camYaw: Math.PI * 0.25, camPitch: 0.32, camDist: 9,
    aiming: false, speed: 0,
    y: 0, vy: 0, // v8d P1 #17: jump height + vertical velocity (ground = 0)
    fov: 62, // v8c #21: damped field of view (62 normal, 50 aiming, up to 78 at speed)
    idleT: 0, // v8c #21: seconds since the last mouse move (drives the gentle recentre)
    mouseActive: false, // v8c #21: this frame's mouse delta exceeded the lock-on threshold
  };

  function update(dt, input, colliders, frozen) {
    const { f, s } = input.axis();
    const mouse = input.takeMouse();
    // v8c #21 (fable camera.js pattern): the mouse-idle clock drives the
    // gentle recentre below, and mouseActive tells the lock-on steering
    // to yield to the player (fable's |dx|+|dy| > 2 threshold).
    p.mouseActive = Math.abs(mouse.dx) + Math.abs(mouse.dy) > 2;
    if (p.mouseActive) p.idleT = 0;
    else p.idleT += dt;
    p.camYaw -= mouse.dx * 0.0028 * S.sensitivity;
    p.camPitch = Math.max(0.08, Math.min(1.1, p.camPitch + mouse.dy * 0.0022 * S.sensitivity));
    p.aiming = input.firing && !S.inCar;

    if (!frozen) {
      const sprint = input.sprint ? 1.7 : 1;
      const maxSpeed = 6.2 * sprint;
      // Movement is relative to the camera yaw.
      const sin = Math.sin(p.camYaw), cos = Math.cos(p.camYaw);
      let mx = (f * sin + s * cos) * maxSpeed;
      let mz = (f * cos - s * sin) * maxSpeed;
      const len = Math.hypot(mx, mz);
      if (len > maxSpeed) { mx = mx / len * maxSpeed; mz = mz / len * maxSpeed; }
      p.speed = len;
      p.x += mx * dt; p.z += mz * dt;
      const fixed = resolveCircle(colliders, p.x, p.z, 0.9);
      p.x = fixed.x; p.z = fixed.z;
      // v8c #14: no world clamp inside a shop interior — the room lives
      // at x = 3000, far outside the world bounds, and its own walls
      // (passed in as colliders) keep the player in.
      if (!S.interior) {
        const clamped = clampToWorld(p.x, p.z, 12);
        p.x = clamped.x; p.z = clamped.z;
      }
      if (len > 0.5) {
        p.heading = Math.atan2(mx, mz);
        p.walkPhase += dt * (sprint > 1 ? 11 : 7);
      }
      S.stats.distanceWalked += len * dt;
      // v8d P1 #17: jump (gta-clone vy 7.5, js/main.js:1011-1037) —
      // Space on foot (the same key is the handbrake in a car, and
      // this update never runs while driving, so there is no
      // conflict). Gravity 22: apex ~1.3 m, airtime ~0.7 s. Holding
      // Space jumps again on landing. No fall damage: the world is
      // flat and the jump is 1.3 m.
      if (input.handbrake && p.y === 0) p.vy = 7.5;
      if (p.y > 0 || p.vy > 0) {
        p.vy -= 22 * dt;
        p.y += p.vy * dt;
        if (p.y <= 0) { p.y = 0; p.vy = 0; }
      }
      // v8c #21 (fable): gentle recentre behind the player — only while
      // moving and only after 1.6 s of mouse idle, so it never fights
      // the player. Never while aiming: the aim holds the camera.
      if (!p.aiming && p.speed > 1 && p.idleT > 1.6) {
        let diff = p.heading - p.camYaw;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        p.camYaw += diff * (1 - Math.exp(-0.8 * dt));
      }
    }
    const u = mesh.userData;
    const swing = p.speed > 0.5 ? Math.sin(p.walkPhase) * 0.6 : 0;
    // v8d P1 #17: tucked legs while airborne, walk swing on the ground.
    if (p.y > 0) { u.legL.rotation.x = 0.7; u.legR.rotation.x = -0.4; }
    else { u.legL.rotation.x = swing; u.legR.rotation.x = -swing; }
    u.armL.rotation.x = p.aiming ? -1.2 : -swing;
    u.armR.rotation.x = p.aiming ? -1.2 : swing;
    mesh.position.set(p.x, p.y, p.z);
    mesh.rotation.y = p.aiming ? p.camYaw : p.heading;
    mesh.visible = !S.inCar;
    return p;
  }

  // v8c #21: steer the aim toward the lock-on target (fable aimAssist
  // pattern — snap fast at λ 40, track gently at λ 6, yield to the
  // mouse at λ 1.5). Yaw only: Kestrel's camera lookAts the player, so
  // the pitch sets the camera height, not the aim — only the yaw moves
  // the crosshair. The angle wrap takes the short way around the circle.
  function steerToTarget(dt, target, mouseActive) {
    const wantYaw = Math.atan2(target.x - p.x, target.z - p.z);
    const lam = target.snapped ? 40 : mouseActive ? 1.5 : 6;
    let diff = wantYaw - p.camYaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    p.camYaw += diff * (1 - Math.exp(-lam * dt));
  }

  // 2D segment-vs-AABB test for the camera pull-in: returns the smallest
  // fraction t in [0, 1] where the segment from (x0, z0) to (x1, z1)
  // enters a collider, or Infinity when the path is clear.
  function segmentHit(x0, z0, x1, z1, colliders) {
    const dx = x1 - x0, dz = z1 - z0;
    let best = Infinity;
    for (const c of colliders) {
      let t0 = 0, t1 = 1;
      if (Math.abs(dx) < 1e-9) {
        if (x0 < c.x0 || x0 > c.x1) continue;
      } else {
        const a = (c.x0 - x0) / dx, b = (c.x1 - x0) / dx;
        t0 = Math.max(t0, Math.min(a, b));
        t1 = Math.min(t1, Math.max(a, b));
        if (t0 > t1) continue;
      }
      if (Math.abs(dz) < 1e-9) {
        if (z0 < c.z0 || z0 > c.z1) continue;
      } else {
        const a = (c.z0 - z0) / dz, b = (c.z1 - z0) / dz;
        t0 = Math.max(t0, Math.min(a, b));
        t1 = Math.min(t1, Math.max(a, b));
        if (t0 > t1) continue;
      }
      if (t0 < best) best = t0;
    }
    return best;
  }

  // Place the camera behind the player (or behind the car when driving).
  // opts: { staging, speedKmh, colliders } — during staging the camera
  // is exactly the pre-v8c one (no FOV shift, no shoulder, no pull-in),
  // so the four final shots cannot change.
  // v8c #21 camera numbers (fable camera.js pattern, adapted to the
  // Kestrel scale): aim is over the right shoulder (1.05 m side offset,
  // FOV 50); the car FOV widens 62→78° with speed; the camera pulls in
  // when a building blocks the line. The on-foot 9 m follow distance
  // and the 10.5/13 m car booms are Kestrel's own scale, kept.
  function updateCamera(dt, camera, carPos, carHeading, opts = {}) {
    const staging = !!opts.staging;
    const target = new THREE.Vector3();
    let yaw = p.camYaw, dist = p.camDist, height = 3.4;
    if (S.inCar && carPos) {
      yaw = carHeading !== undefined ? carHeading : p.camYaw;
      // Blend the chase yaw toward the car's heading so the camera settles behind it.
      let diff = yaw - p.camYaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      p.camYaw += diff * Math.min(1, dt * 1.6);
      yaw = p.camYaw;
      dist = S.cameraMode === 1 ? 13 : 10.5;
      height = 4.2;
      target.set(carPos.x, 1.5, carPos.z);
    } else {
      // v8d P1 #17: the look target rises half the jump height so the
      // camera follows a jump instead of framing empty ground.
      target.set(p.x, 1.6 + p.y * 0.5, p.z);
      // On foot the follow distance is p.camDist (default 9): staged
      // shots override it (the combat shot pulls in to 6 m so Rook
      // reads ~200 px, R1/R3-sized, instead of ~120 px). Aiming keeps
      // its own tighter 6.5 m. Normal play never touches camDist, so
      // gameplay is unchanged. Inside a shop the room is 16x12 m, so
      // the camera pulls in to 4 m (the wall pull-in below does the
      // rest).
      dist = S.interior ? 4 : p.aiming ? 6.5 : p.camDist;
      height = 2.6 + p.camPitch * 3;
    }
    // Over-shoulder aim: shift the look target (and with it the camera)
    // 1.05 m to the shooter's right, so Rook sits left of frame and the
    // crosshair clears his head. Live play only — staging never aims
    // (input.firing is false there), and the staging gate is belt and
    // braces on top.
    if (p.aiming && !staging) {
      const rx = -Math.cos(yaw), rz = Math.sin(yaw); // right of the aim
      target.x += rx * 1.05;
      target.z += rz * 1.05;
    }
    // Field of view: 50 while aiming, 62→78° with speed in the car
    // (fable's numbers; speed is km/h, 30 m/s = 108 km/h is full
    // widening), 62 otherwise. Damped (λ 4); applied only when it
    // moved, so updateProjectionMatrix is not called every frame.
    let fovT = 62;
    if (!staging) {
      if (p.aiming) fovT = 50;
      else if (S.inCar) fovT = 62 + Math.min(1, (opts.speedKmh || 0) / 108) * 16;
    }
    p.fov += (fovT - p.fov) * (1 - Math.exp(-4 * dt));
    if (Math.abs(camera.fov - p.fov) > 0.05) {
      camera.fov = p.fov;
      camera.updateProjectionMatrix();
    }
    let cx = target.x - Math.sin(yaw) * Math.cos(p.camPitch) * dist;
    let cz = target.z - Math.cos(yaw) * Math.cos(p.camPitch) * dist;
    let cy = target.y + Math.sin(p.camPitch) * dist + (S.inCar ? 1.2 : 0.4);
    // Camera collision: pull in when a building blocks the line from
    // the target to the camera (fable's raycastBoxes pull-in, as a 2D
    // segment test against the city colliders). Never closer than 12%
    // of the boom, and never during staging.
    if (!staging && opts.colliders) {
      const hit = segmentHit(target.x, target.z, cx, cz, opts.colliders);
      if (hit < Infinity) {
        const L = Math.hypot(cx - target.x, cz - target.z);
        if (L > 0.01) {
          const f = Math.max(0.12, (hit * L - 0.4) / L);
          cx = target.x + (cx - target.x) * f;
          cz = target.z + (cz - target.z) * f;
          cy = target.y + (cy - target.y) * f;
        }
      }
    }
    camera.position.lerp(new THREE.Vector3(cx, cy, cz), Math.min(1, dt * 7));
    camera.lookAt(target.x, target.y + (S.inCar ? 0.4 : 0.2), target.z);
    void height;
  }

  function teleport(x, z, heading) {
    p.x = x; p.z = z;
    p.y = 0; p.vy = 0; // v8d P1 #17: never teleport mid-air
    if (heading !== undefined) {
      p.heading = heading; p.camYaw = heading;
      // Orient the mesh too: on the title screen update() never runs,
      // so a teleported Rook kept his spawn rotation (back to camera).
      // In normal play update() overwrites this every frame, so no
      // gameplay change.
      mesh.rotation.y = heading;
    }
    mesh.position.set(x, 0, z);
  }

  return { p, update, updateCamera, teleport, steerToTarget };
}
