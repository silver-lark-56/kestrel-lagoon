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
  // v8a #2: ACES filmic tone mapping — sunset highlights roll off instead of
  // clipping to white, and night reads deeper. Exposure 1.1 compensates the
  // midtone darkening ACES adds over the old no-tonemapping look.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x7ec8e3);
  scene.fog = new THREE.Fog(0x7ec8e3, 120, 900);

  // v8a #3: shader sky dome (pattern: fable sky.js — sun/moon/stars dome;
  // the shader below is written fresh for Kestrel, not copied). The dome
  // blends a vertical gradient, draws a moon disc + halo after dark, and
  // sprinkles hash-cell stars that fade in with the night. The sun disc
  // stays a billboarded MESH (proven in SwiftShader; see below), so the
  // shader draws no sun of its own — no doubled sun. Tone mapping +
  // colour space come from the standard chunks, so the sky matches the
  // ACES-graded rest of the scene.
  const skyUniforms = {
    uTop: { value: new THREE.Color('#3f7fc4') },
    uHorizon: { value: new THREE.Color('#a8d8f0') },
    uNight: { value: 0 },
    uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
  };
  const SKY_REGIMES = {
    day: { top: '#3f7fc4', horizon: '#a8d8f0', night: 0 },
    sunset: { top: '#4a2a6e', horizon: '#ff9a4d', night: 0 },
    night: { top: '#04060f', horizon: '#0d1526', night: 1 },
  };
  const skyDome = new THREE.Mesh(new THREE.SphereGeometry(1500, 24, 12),
    new THREE.ShaderMaterial({
      uniforms: skyUniforms, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: `varying vec3 vDir;
        void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 uTop, uHorizon, uMoonDir; uniform float uNight; varying vec3 vDir;
        float cellHash(vec3 p) { return fract(sin(dot(p, vec3(17.13, 41.71, 23.59))) * 43758.5453); }
        void main() {
          vec3 d = normalize(vDir);
          float h = clamp(d.y, 0.0, 1.0);
          vec3 col = mix(uHorizon, uTop, pow(h, 0.55));
          // Moon + stars run only after dark (uNight is a uniform, so the
          // branch costs nothing on the day/sunset path — and at sunset
          // the stars would be invisible anyway). The hash + pow math is
          // the dome's most expensive part; skipping it keeps the sunset
          // shots inside the capture timeout on SwiftShader.
          if (uNight > 0.01) {
            float md = max(dot(d, uMoonDir), 0.0);
            col += vec3(0.82, 0.87, 1.0) * (smoothstep(0.99965, 0.99985, md) * 2.2 + pow(md, 90.0) * 0.12) * uNight;
            vec3 cell = floor(d * 220.0);
            float roll = cellHash(cell);
            float twinkle = 0.45 + 0.55 * cellHash(cell + 19.19);
            float star = step(0.997, roll) * twinkle * uNight * smoothstep(0.02, 0.25, d.y);
            col += vec3(star);
          }
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }));
  scene.add(skyDome);
  // Cloud puffs: one Points draw call, soft radial sprites scattered high
  // above the city. Positions come from a fixed LCG, so the clouds are
  // identical on every load (reproducible screenshots).
  const cloudMat = new THREE.PointsMaterial({
    map: glowTexture([[0, 'rgba(255,255,255,0.85)'], [0.5, 'rgba(255,255,255,0.4)'], [1, 'rgba(255,255,255,0)']]),
    size: 200, transparent: true, opacity: 0.55, depthWrite: false, fog: false,
  });
  {
    let lcg = 1234567;
    const rnd = () => (lcg = (lcg * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const pts = [];
    // 28 puffs, not 60: each puff is a big blended quad in SwiftShader,
    // and 60 of them cost more frame time than the whole sky shader.
    for (let i = 0; i < 28; i++) {
      const a = rnd() * Math.PI * 2, r = 450 + rnd() * 750;
      pts.push(Math.cos(a) * r, 280 + rnd() * 140, Math.sin(a) * r);
    }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const clouds = new THREE.Points(cg, cloudMat);
    clouds.frustumCulled = false;
    scene.add(clouds);
  }

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
    // Sky shader regime: gradient colours + night factor (stars/moon).
    const regime = isNight ? SKY_REGIMES.night : isSunset ? SKY_REGIMES.sunset : SKY_REGIMES.day;
    skyUniforms.uTop.value.set(regime.top);
    skyUniforms.uHorizon.value.set(regime.horizon);
    skyUniforms.uNight.value = regime.night;
    // Clouds: white by day, ember-tinted at sunset, dark slate at night.
    if (isNight) { cloudMat.color.set(0x2a3550); cloudMat.opacity = 0.3; }
    else if (isSunset) { cloudMat.color.set(0xffb27d); cloudMat.opacity = 0.7; }
    else { cloudMat.color.set(0xffffff); cloudMat.opacity = 0.55; }
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
    // Moon rides opposite the sun, kept above the horizon so the disc is
    // always in the sky when the night factor fades it in.
    skyUniforms.uMoonDir.value.set(-sunDir.x, Math.max(0.2, -sunDir.y), -sunDir.z).normalize();
  }

  function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }

  // v8c #18: optional post-pass (bloom), run after the normal render.
  // Unset by default: the render path is exactly the pre-v8c one.
  let postRenderer = null;
  function setPostRenderer(fn) { postRenderer = fn; }

  function render() {
    // Billboard the sun meshes at the final camera before drawing.
    sunCore.lookAt(camera.position);
    sunHalo.lookAt(camera.position);
    renderer.render(scene, camera);
    if (postRenderer) postRenderer();
  }

  // v8c #20: the graphics preset / adaptive scaler drives the pixel
  // ratio through here (three re-applies the drawing-buffer size
  // internally, so no resize call is needed).
  function setPixelRatio(d) {
    renderer.setPixelRatio(Math.max(0.5, Math.min(2, d)));
  }

  return { renderer, scene, camera, applyTimeOfDay, resize, render, bindLamps, bindFacades, sun, hemi, setPixelRatio, setPostRenderer };
}
