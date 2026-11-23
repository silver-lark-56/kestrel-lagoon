// KESTREL LAGOON — rain + lightning: a camera-following rain volume
// (1,500 instanced streaks), a clear/rain state machine, occasional
// lightning with delayed thunder, and rain that pulls the fog in.
// Gameplay system — OFF during ?shot= staging and the self-test (main.js
// gates the update), so the four final shots never change. `?rain=1`
// starts in rain for testing.
//
// Pattern: gta-clone weather.js (UNLICENSED — pattern only, Kestrel's own
// code): LineSegments streaks in a volume that follows the camera,
// recycled below y=0; clear/rain timers; flash + delayed thunder.
import * as THREE from 'three';

const DROPS = 1500;
const BOX_XZ = 55; // rain volume, metres around the camera
const BOX_Y = 50;
const STREAK = 1.1; // streak length, metres
const SLANT = 0.12; // wind slant on the streak

export function createWeather(scene, audio) {
  // Rain streaks: one LineSegments draw call, 2 vertices per drop.
  const positions = new Float32Array(DROPS * 2 * 3);
  const xs = new Float32Array(DROPS);
  const ys = new Float32Array(DROPS);
  const zs = new Float32Array(DROPS);
  const speeds = new Float32Array(DROPS);
  for (let i = 0; i < DROPS; i++) {
    xs[i] = (Math.random() - 0.5) * BOX_XZ;
    ys[i] = Math.random() * BOX_Y;
    zs[i] = (Math.random() - 0.5) * BOX_XZ;
    speeds[i] = 34 + Math.random() * 16;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({ color: 0x9fb8cc, transparent: true, opacity: 0 });
  const rain = new THREE.LineSegments(geo, mat);
  rain.frustumCulled = false; // positions move every frame; no stale bounds
  rain.visible = false;
  scene.add(rain);

  // Lightning: a dedicated ambient light, so the flash never fights the
  // time-of-day lighting (applyTimeOfDay owns the sun/hemi intensities).
  const flashLight = new THREE.AmbientLight(0xcfe4ff, 0);
  scene.add(flashLight);

  const forceRain = (() => {
    try { return new URLSearchParams(window.location.search).get('rain') === '1'; } catch { return false; }
  })();
  let state = forceRain ? 'rain' : 'clear';
  let intensity = forceRain ? 1 : 0;
  let timer = forceRain ? 60 : 25; // first rain arrives ~25 s in
  let flash = 0;
  let nextFlash = 7 + Math.random() * 15;

  function update(dt, camera) {
    // State machine: clear 40-90 s, rain 50-100 s, intensity fades in/out.
    timer -= dt;
    if (timer <= 0) {
      if (state === 'clear') {
        state = 'rain';
        timer = 50 + Math.random() * 50;
        nextFlash = 4 + Math.random() * 8;
      } else {
        state = 'clear';
        timer = 40 + Math.random() * 50;
      }
    }
    const target = state === 'rain' ? 1 : 0;
    intensity += Math.max(-0.3 * dt, Math.min(0.3 * dt, target - intensity));

    if (intensity > 0.01) {
      rain.visible = true;
      mat.opacity = 0.38 * intensity;
      // The volume follows the camera; drops fall and recycle at the floor.
      const cy = Math.max(0, camera.position.y - 12);
      rain.position.set(camera.position.x, cy, camera.position.z);
      for (let i = 0; i < DROPS; i++) {
        ys[i] -= speeds[i] * dt;
        if (ys[i] < 0) {
          ys[i] += BOX_Y;
          xs[i] = (Math.random() - 0.5) * BOX_XZ;
          zs[i] = (Math.random() - 0.5) * BOX_XZ;
        }
        const o = i * 6;
        positions[o] = xs[i]; positions[o + 1] = ys[i]; positions[o + 2] = zs[i];
        positions[o + 3] = xs[i] - SLANT; positions[o + 4] = ys[i] + STREAK; positions[o + 5] = zs[i];
      }
      geo.attributes.position.needsUpdate = true;
      // Rain pulls the fog in (runs after applyTimeOfDay, which resets
      // the fog every frame — the lerp is stable, never accumulates).
      const f = scene.fog;
      if (f) {
        const k = intensity * 0.7;
        f.near += (50 - f.near) * k;
        f.far += (420 - f.far) * k;
      }
    } else {
      rain.visible = false;
    }

    // Lightning: a strike every 7-22 s while raining, flash decays fast,
    // thunder rolls in 0.5-2.5 s later (distance by delay).
    if (state === 'rain' && intensity > 0.5) {
      nextFlash -= dt;
      if (nextFlash <= 0) {
        nextFlash = 7 + Math.random() * 15;
        flash = 1;
        const delay = 500 + Math.random() * 2000;
        setTimeout(() => { if (audio && audio.thunder) audio.thunder(); }, delay);
      }
    }
    flash = Math.max(0, flash - 3 * dt);
    flashLight.intensity = flash * 2.5;

    if (audio && audio.setRain) audio.setRain(intensity);
  }

  return {
    update,
    state() { return { raining: state === 'rain', intensity, flash }; },
  };
}
