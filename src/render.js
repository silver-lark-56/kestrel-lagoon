// KESTREL LAGOON — the renderer: WebGL setup, sky + fog + sun driven by
// the in-game clock (day, golden sunset, night with lamps), and the frame
// loop plumbing. No shadows — the headless capture stays fast and stable.
import * as THREE from 'three';

const SKY_DAY = new THREE.Color(0x7ec8e3);
const SKY_SUNSET = new THREE.Color(0xff8a5c);
const SKY_NIGHT = new THREE.Color(0x0a1026);
const SKY_DUSK = new THREE.Color(0x3a2a5a);

export function createRender(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x7ec8e3);
  scene.fog = new THREE.Fog(0x7ec8e3, 120, 900);

  // Gradient sky dome: a flat sky color reads cheap next to a sunset
  // gradient, so the dome carries a vertical gradient per time of day.
  function skyTexture(top, horizon) {
    const c = document.createElement('canvas'); c.width = 4; c.height = 256;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 256, 0, 0);
    grad.addColorStop(0, horizon); grad.addColorStop(0.55, horizon); grad.addColorStop(1, top);
    g.fillStyle = grad; g.fillRect(0, 0, 4, 256);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  const SKIES = {
    day: skyTexture('#3f7fc4', '#a8d8f0'),
    sunset: skyTexture('#4a2a6e', '#ff9a4d'),
    night: skyTexture('#04060f', '#0d1526'),
  };
  const skyDome = new THREE.Mesh(new THREE.SphereGeometry(1500, 24, 12),
    new THREE.MeshBasicMaterial({ fog: false, side: THREE.BackSide, map: SKIES.day }));
  scene.add(skyDome);

  // Sun disc + halo: a bright sun in the sky, so sunset shots (title,
  // combat) show the sun itself, not just a gradient. Built as billboarded
  // circle MESHES, not Sprites: Sprite objects never drew in this
  // headless SwiftShader build (two probe runs: visible, in-frame, zero
  // bright pixels), while the muzzle flash's mesh spheres render fine.
  function glowTexture(stops) {
    const c = document.createElement('canvas'); c.width = 128; c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 2, 64, 64, 64);
    for (const [o, col] of stops) grad.addColorStop(o, col);
    g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  // Solid bright core (no texture): the radial-gradient texture rendered
  // dim through the title veil, while a flat near-white disc reads as a
  // sun at a glance. The halo keeps its soft gradient.
  const sunCore = new THREE.Mesh(new THREE.CircleGeometry(55, 24),
    new THREE.MeshBasicMaterial({ color: 0xfff8d0, fog: false }));
  const sunHalo = new THREE.Mesh(new THREE.CircleGeometry(175, 24),
    new THREE.MeshBasicMaterial({
      map: glowTexture([[0, 'rgba(255,180,90,0.55)'], [0.5, 'rgba(255,140,70,0.28)'], [1, 'rgba(255,120,60,0)']]),
      transparent: true, fog: false, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8,
    }));
  scene.add(sunCore, sunHalo);
  const sunDir = new THREE.Vector3();

  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 2000);
  camera.position.set(-200, 8, 160);

  const hemi = new THREE.HemisphereLight(0xbfe3ff, 0x3f5a3a, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2cc, 1.6);
  sun.position.set(100, 140, 60);
  scene.add(sun);
  const nightAmbient = new THREE.AmbientLight(0x334466, 0);
  scene.add(nightAmbient);

  // Combat-shot light lift (v7): the combat frame is the darkest of
  // the four and R3's combat shot is brighter/cleaner (K3). Only with
  // ?shot=combat — never in real play, the selftest, or any other
  // shot. Neon signs and lamps are emissive, so they keep their
  // punch; only the lit surfaces (street, buildings, characters)
  // lift. Computed once: applyTimeOfDay runs every frame.
  const combatBoost = new URLSearchParams(window.location.search).get('shot') === 'combat';

  let lampMat = null;
  function bindLamps(mat) { lampMat = mat; }
  let facadeMats = [];
  function bindFacades(mats) { facadeMats = mats; }

  // Blend the sky, fog and light for a time of day. t is hours 0..24.
  function applyTimeOfDay(sunPos, isNight, isSunset) {
    const sky = new THREE.Color();
    if (isNight) {
      sky.copy(SKY_NIGHT);
      hemi.intensity = combatBoost ? 0.7 : 0.55;
      sun.intensity = 0.4;
      sun.color.set(0x8fa8ff);
      nightAmbient.intensity = combatBoost ? 0.9 : 0.65;
      if (lampMat) lampMat.color.set(0xffe9a8);
    } else if (isSunset) {
      sky.copy(SKY_SUNSET).lerp(SKY_DUSK, 0.35);
      hemi.intensity = 0.7;
      sun.intensity = 1.5;
      sun.color.set(0xff9a4d);
      nightAmbient.intensity = 0.15;
      if (lampMat) lampMat.color.set(0xffe9a8);
    } else {
      sky.copy(SKY_DAY);
      hemi.intensity = 0.95;
      sun.intensity = 1.7;
      sun.color.set(0xfff2cc);
      nightAmbient.intensity = 0;
      if (lampMat) lampMat.color.set(0xcfd8dc);
    }
    scene.background.copy(sky);
    scene.fog.color.copy(sky);
    const dome = isNight ? SKIES.night : isSunset ? SKIES.sunset : SKIES.day;
    if (skyDome.material.map !== dome) { skyDome.material.map = dome; skyDome.material.needsUpdate = true; }
    scene.fog.near = isNight ? 60 : 140;
    scene.fog.far = isNight ? 500 : 950;
    // Facade glow: windows + shopfronts light up after dark (full at
    // night, a warm hint at sunset, off by day).
    const glow = isNight ? 1 : isSunset ? 0.35 : 0;
    for (const m of facadeMats) m.emissiveIntensity = glow;
    sun.position.set(sunPos.x, Math.max(12, sunPos.y), sunPos.z);
    // Sun disc follows the sun; hidden at night. Placed at 600, not at the
    // dome (1500): SwiftShader never drew the sprites at 1250 despite the
    // projection landing in-frame (probe: visible, screen (486,309)) — the
    // muzzle glow sprite at 11 m renders fine, so the distance is the
    // suspect. Scales keep the apparent size (~9 deg core, ~32 deg halo).
    sunDir.set(sunPos.x, sunPos.y, sunPos.z).normalize();
    sunCore.position.copy(sunDir).multiplyScalar(600);
    sunHalo.position.copy(sunCore.position);
    sunCore.visible = !isNight;
    sunHalo.visible = !isNight;
  }

  function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }

  function render() {
    // Billboard the sun meshes at the final camera before drawing.
    sunCore.lookAt(camera.position);
    sunHalo.lookAt(camera.position);
    renderer.render(scene, camera);
  }

  return { renderer, scene, camera, applyTimeOfDay, resize, render, bindLamps, bindFacades, sun, hemi };
}
