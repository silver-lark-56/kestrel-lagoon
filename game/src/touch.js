// KESTREL LAGOON — touch controls: a floating virtual joystick on the
// left half of the screen, a look-drag on the right half, and thumb-sized
// action buttons (FIRE, ENTER, HANDBRAKE, CAMERA, INTERACT, MAP, PAUSE).
// The touch layer writes into the SAME input state the keyboard uses
// (input.hold / inject / addLook / setFiring), so on-foot movement,
// driving, aiming and every action behave identically on touch and on
// keys — the game never knows which device is driving it.
//
// Patterns: gta7 TouchControls (MIT — pointer events with per-pointer
// tracking, move/up on the window, safe-area-aware layout) and the
// gta-clone touch layer (unlicensed — pattern only: joystick axis
// thresholds, rim = sprint, look-drag scale). The joystick here is
// floating (it spawns where the thumb lands) instead of fixed, so it
// never covers the minimap; the buttons are Kestrel's own layout.
//
// The layer exists ONLY on touch-primary devices (pointer: coarse, or
// touch capability with no fine pointer) — a touchscreen laptop keeps
// its mouse, and desktop/headless captures never see the UI. `?touch=1`
// forces it on for testing.
import { S } from './state.js';

const STICK_RADIUS = 48; // px of knob travel
const STICK_DEAD = 0.18; // below this, no keys held
const AXIS_ON = 0.35; // axis threshold for a held key (gta-clone: 0.38)
const SPRINT_RIM = 0.92; // stick pushed to the rim = sprint
const LOOK_SCALE = 2.0; // touch drags are shorter than mouse sweeps

export function isTouchDevice() {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('touch') === '1') return true;
  } catch { /* no URLSearchParams in some harnesses */ }
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const fine = window.matchMedia && window.matchMedia('(pointer: fine)').matches;
  if (coarse) return true;
  if ('ontouchstart' in window && !fine) return true;
  return false;
}

function el(tag, id, cls, text) {
  const d = document.createElement(tag);
  if (id) d.id = id;
  if (cls) d.className = cls;
  if (text !== undefined) d.textContent = text;
  return d;
}

export function createTouchControls(input) {
  if (!isTouchDevice()) return null;

  const layer = el('div', 'touch-layer');
  const stickZone = el('div', 'touch-stick-zone');
  const lookZone = el('div', 'touch-look-zone');
  const stickBase = el('div', 'touch-stick-base');
  const stickKnob = el('div', 'touch-stick-knob');
  stickBase.appendChild(stickKnob);
  layer.appendChild(stickZone);
  layer.appendChild(lookZone);
  layer.appendChild(stickBase);

  // Action buttons (right side). One-shot buttons inject their key once
  // per tap; held buttons hold the key while the thumb is down.
  const buttons = [];
  function addButton(id, label, cls, down, up) {
    const b = el('div', id, `touch-btn ${cls || ''}`, label);
    b.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      e.preventDefault();
      e.stopPropagation();
      try { b.setPointerCapture(e.pointerId); } catch { /* already released */ }
      b.classList.add('active');
      down();
    });
    const release = (e) => {
      if (e.pointerType === 'mouse') return;
      b.classList.remove('active');
      if (up) up();
    };
    b.addEventListener('pointerup', release);
    b.addEventListener('pointercancel', release);
    b.addEventListener('lostpointercapture', () => { b.classList.remove('active'); if (up) up(); });
    layer.appendChild(b);
    buttons.push(b);
    return b;
  }
  addButton('touch-fire', 'FIRE', 'big', () => input.setFiring(true), () => input.setFiring(false));
  addButton('touch-enter', 'F', 'mid', () => input.inject('KeyF'));
  // v8d P1 #17: the BRAKE button holds Space, which is JUMP on foot —
  // the label follows S.inCar (relabeled in update() below).
  const brakeBtn = addButton('touch-brake', 'BRAKE', 'mid', () => input.hold('Space', true), () => input.hold('Space', false));
  addButton('touch-cam', 'CAM', 'small', () => input.inject('KeyV'));
  addButton('touch-interact', 'E', 'small', () => input.inject('KeyE'));
  addButton('touch-horn', 'HORN', 'small', () => input.inject('KeyH')); // v8d #12
  // v8d P1 #20: hold WHEEL to open the weapon wheel (same held-key
  // pattern as BRAKE); tap a segment chip to equip it.
  addButton('touch-wheel', 'WHEEL', 'small', () => input.hold('Tab', true), () => input.hold('Tab', false));
  addButton('touch-map', 'MAP', 'small', () => input.inject('KeyM'));
  addButton('touch-pause', 'II', 'small', () => input.inject('Escape'));

  // Long-press must not open the context menu over the game.
  layer.addEventListener('contextmenu', (e) => e.preventDefault());
  layer.style.display = 'none'; // start hidden; update() reveals it in-game
  document.body.appendChild(layer);

  // --- Floating joystick -------------------------------------------------
  let stickId = null;
  let baseX = 0, baseY = 0;
  let stickX = 0, stickY = 0; // normalised -1..1, for the probe hook
  const heldStickKeys = new Set();
  const STICK_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft'];

  function setStickKeys(nx, ny) {
    const mag = Math.hypot(nx, ny);
    const want = new Set();
    if (mag > STICK_DEAD) {
      if (-ny > AXIS_ON) want.add('KeyW');
      if (-ny < -AXIS_ON) want.add('KeyS');
      if (nx > AXIS_ON) want.add('KeyD');
      if (nx < -AXIS_ON) want.add('KeyA');
      if (mag > SPRINT_RIM) want.add('ShiftLeft');
    }
    for (const k of STICK_KEYS) {
      if (want.has(k) && !heldStickKeys.has(k)) { input.hold(k, true); heldStickKeys.add(k); }
      else if (!want.has(k) && heldStickKeys.has(k)) { input.hold(k, false); heldStickKeys.delete(k); }
    }
  }

  function releaseStick() {
    for (const k of heldStickKeys) input.hold(k, false);
    heldStickKeys.clear();
    stickId = null;
    stickX = 0; stickY = 0;
    stickBase.style.display = 'none';
  }

  stickZone.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || stickId !== null) return;
    e.preventDefault();
    stickId = e.pointerId;
    try { stickZone.setPointerCapture(e.pointerId); } catch { /* already released */ }
    // Spawn the stick where the thumb lands, clamped so the 120 px base
    // stays fully on screen.
    baseX = Math.max(70, Math.min(window.innerWidth - 70, e.clientX));
    baseY = Math.max(70, Math.min(window.innerHeight - 70, e.clientY));
    stickBase.style.display = 'block';
    stickBase.style.left = `${baseX - 60}px`;
    stickBase.style.top = `${baseY - 60}px`;
    stickKnob.style.transform = 'translate(0px, 0px)';
    setStickKeys(0, 0);
  });
  stickZone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== stickId) return;
    e.preventDefault();
    let dx = e.clientX - baseX;
    let dy = e.clientY - baseY;
    const len = Math.hypot(dx, dy);
    if (len > STICK_RADIUS) { dx = dx / len * STICK_RADIUS; dy = dy / len * STICK_RADIUS; }
    stickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
    stickX = dx / STICK_RADIUS;
    stickY = dy / STICK_RADIUS;
    setStickKeys(stickX, stickY);
  });
  const stickEnd = (e) => { if (e.pointerId === stickId) releaseStick(); };
  stickZone.addEventListener('pointerup', stickEnd);
  stickZone.addEventListener('pointercancel', stickEnd);
  stickZone.addEventListener('lostpointercapture', () => { if (stickId !== null) releaseStick(); });

  // --- Look-drag -----------------------------------------------------------
  let lookId = null;
  let lookX = 0, lookY = 0;
  lookZone.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || lookId !== null) return;
    e.preventDefault();
    lookId = e.pointerId;
    lookX = e.clientX; lookY = e.clientY;
    try { lookZone.setPointerCapture(e.pointerId); } catch { /* already released */ }
  });
  lookZone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== lookId) return;
    e.preventDefault();
    input.addLook((e.clientX - lookX) * LOOK_SCALE, (e.clientY - lookY) * LOOK_SCALE);
    lookX = e.clientX; lookY = e.clientY;
  });
  const lookEnd = (e) => { if (e.pointerId === lookId) lookId = null; };
  lookZone.addEventListener('pointerup', lookEnd);
  lookZone.addEventListener('pointercancel', lookEnd);
  lookZone.addEventListener('lostpointercapture', () => { lookId = null; });

  // If the game loses focus mid-touch, release everything (mirrors the
  // keyboard blur handler in input.js).
  window.addEventListener('blur', () => {
    if (stickId !== null) releaseStick();
    lookId = null;
    input.setFiring(false);
    input.hold('Space', false);
  });

  // Start as null so the first update() always applies the display —
  // starting at false would skip it (want === visible) and leave the
  // layer visible on the title screen.
  let visible = null;
  let brakeLabel = null; // v8d P1 #17: BRAKE in a car, JUMP on foot
  function update() {
    // The touch layer mirrors the HUD: visible only while playing. Menus
    // (title / pause / map / stats) are tapped directly.
    const want = S.screen === 'game';
    if (want !== visible) {
      visible = want;
      layer.style.display = want ? '' : 'none';
      if (!want) {
        if (stickId !== null) releaseStick();
        lookId = null;
        input.setFiring(false);
        input.hold('Space', false);
      }
    }
    // v8d P1 #17: Space is jump on foot, handbrake in a car.
    const label = S.inCar ? 'BRAKE' : 'JUMP';
    if (label !== brakeLabel) { brakeLabel = label; brakeBtn.textContent = label; }
  }
  update();

  return {
    update,
    get visible() { return visible; },
    // Read-only probe hook: the CDP touch probe reads this to confirm
    // the joystick state reached the game.
    state() {
      return { visible, stickX, stickY, firing: input.firing, stickActive: stickId !== null };
    },
  };
}
