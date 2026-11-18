// KESTREL LAGOON — Rook on foot: third-person movement with a sprint,
// a smooth chase camera that orbits with the mouse, and the aim pose.
// The camera rig is shared with driving: one camera, two follow modes.
import * as THREE from 'three';
import { S } from './state.js';
import { buildPersonMesh } from './pedestrians.js';
import { resolveCircle, clampToWorld } from './city.js';

export function createPlayer(scene) {
  const mesh = buildPersonMesh(0xff8a3c, 0xe8b98d, 1.05);
  scene.add(mesh);
  const p = {
    mesh, x: -200, z: 140, heading: Math.PI * 0.25, walkPhase: 0,
    camYaw: Math.PI * 0.25, camPitch: 0.32, camDist: 9,
    aiming: false, speed: 0,
  };

  function update(dt, input, colliders, frozen) {
    const { f, s } = input.axis();
    const mouse = input.takeMouse();
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
      const clamped = clampToWorld(p.x, p.z, 12);
      p.x = clamped.x; p.z = clamped.z;
      if (len > 0.5) {
        p.heading = Math.atan2(mx, mz);
        p.walkPhase += dt * (sprint > 1 ? 11 : 7);
      }
      S.stats.distanceWalked += len * dt;
    }
    const u = mesh.userData;
    const swing = p.speed > 0.5 ? Math.sin(p.walkPhase) * 0.6 : 0;
    u.legL.rotation.x = swing; u.legR.rotation.x = -swing;
    u.armL.rotation.x = p.aiming ? -1.2 : -swing;
    u.armR.rotation.x = p.aiming ? -1.2 : swing;
    mesh.position.set(p.x, 0, p.z);
    mesh.rotation.y = p.aiming ? p.camYaw : p.heading;
    mesh.visible = !S.inCar;
    return p;
  }

  // Place the camera behind the player (or behind the car when driving).
  function updateCamera(dt, camera, carPos, carHeading) {
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
      target.set(p.x, 1.6, p.z);
      // On foot the follow distance is p.camDist (default 9): staged
      // shots override it (the combat shot pulls in to 6 m so Rook
      // reads ~200 px, R1/R3-sized, instead of ~120 px). Aiming keeps
      // its own tighter 6.5 m. Normal play never touches camDist, so
      // gameplay is unchanged.
      dist = p.aiming ? 6.5 : p.camDist;
      height = 2.6 + p.camPitch * 3;
    }
    const cx = target.x - Math.sin(yaw) * Math.cos(p.camPitch) * dist;
    const cz = target.z - Math.cos(yaw) * Math.cos(p.camPitch) * dist;
    const cy = target.y + Math.sin(p.camPitch) * dist + (S.inCar ? 1.2 : 0.4);
    camera.position.lerp(new THREE.Vector3(cx, cy, cz), Math.min(1, dt * 7));
    camera.lookAt(target.x, target.y + (S.inCar ? 0.4 : 0.2), target.z);
    void height;
  }

  function teleport(x, z, heading) {
    p.x = x; p.z = z;
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

  return { p, update, updateCamera, teleport };
}
