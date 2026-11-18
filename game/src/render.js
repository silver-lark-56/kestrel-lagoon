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

  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 2000);
  camera.position.set(-200, 8, 160);

  const hemi = new THREE.HemisphereLight(0xbfe3ff, 0x3f5a3a, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2cc, 1.6);
  sun.position.set(100, 140, 60);
  scene.add(sun);
  const nightAmbient = new THREE.AmbientLight(0x334466, 0);
  scene.add(nightAmbient);

  let lampMat = null;
  function bindLamps(mat) { lampMat = mat; }

  // Blend the sky, fog and light for a time of day. t is hours 0..24.
  function applyTimeOfDay(sunPos, isNight, isSunset) {
    const sky = new THREE.Color();
    if (isNight) {
      sky.copy(SKY_NIGHT);
      hemi.intensity = 0.35;
      sun.intensity = 0.25;
      sun.color.set(0x8fa8ff);
      nightAmbient.intensity = 0.5;
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
    sun.position.set(sunPos.x, Math.max(12, sunPos.y), sunPos.z);
  }

  function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }

  function render() { renderer.render(scene, camera); }

  return { renderer, scene, camera, applyTimeOfDay, resize, render, bindLamps, sun, hemi };
}
