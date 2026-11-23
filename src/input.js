// KESTREL LAGOON — keyboard + mouse. Held keys steer and drive; one-shot
// presses (enter car, reload, map, pause, crew orders) queue as bit flags
// taken once per frame, so a press between frames is never lost or doubled.
export const ACT_ENTER = 1 << 0;
export const ACT_RELOAD = 1 << 1;
export const ACT_MAP = 1 << 2;
export const ACT_PAUSE = 1 << 3;
export const ACT_INTERACT = 1 << 4;
export const ACT_RADIO_PREV = 1 << 5;
export const ACT_RADIO_NEXT = 1 << 6;
export const ACT_CAMERA = 1 << 7;
export const ACT_CREW_CYCLE = 1 << 8;
export const ACT_CREW_ABILITY = 1 << 9;
export const ACT_SPRINT = 1 << 10;
export const ACT_CREW_SELECT = 1 << 11;
export const ACT_GRAPHICS = 1 << 12; // v8c #20: cycle the graphics preset (G)
export const ACT_HORN = 1 << 13; // v8d #12: car horn (H)

const HELD = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'ShiftLeft', 'ShiftRight', 'Space', 'Tab', // v8d P1 #20: Tab held = weapon wheel open
]);

export function createInput(canvas) {
  const keys = new Set();
  let actions = 0;
  let mouseDX = 0, mouseDY = 0;
  let mouseDown = false, mouseClicked = false;
  let locked = false;

  function press(code) {
    switch (code) {
      case 'KeyF': actions |= ACT_ENTER; break;
      case 'KeyR': actions |= ACT_RELOAD; break;
      case 'KeyM': actions |= ACT_MAP; break;
      case 'Escape': actions |= ACT_PAUSE; break;
      case 'KeyE': actions |= ACT_INTERACT; break;
      case 'KeyQ': actions |= ACT_RADIO_PREV; break;
      case 'KeyV': actions |= ACT_CAMERA; break;
      case 'KeyC': actions |= ACT_CREW_CYCLE; break;
      case 'KeyX': actions |= ACT_CREW_ABILITY; break;
      case 'KeyT': actions |= ACT_CREW_SELECT; break;
      case 'KeyG': actions |= ACT_GRAPHICS; break;
      case 'KeyH': actions |= ACT_HORN; break;
      case 'Digit0': case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': case 'Digit5':
        actions |= (1 << (16 + Number(code.slice(5)))); break; // weapon slots 0..5
      default: break;
    }
  }

  window.addEventListener('keydown', (e) => {
    if (HELD.has(e.code)) { keys.add(e.code); e.preventDefault(); }
    if (!e.repeat) press(e.code);
    if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => { keys.clear(); mouseDown = false; });
  document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === canvas; });
  canvas.addEventListener('mousemove', (e) => {
    if (locked) { mouseDX += e.movementX; mouseDY += e.movementY; }
  });
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) { mouseDown = true; mouseClicked = true; }
    if (!locked && document.pointerLockElement !== canvas) {
      try { canvas.requestPointerLock(); } catch { /* headless or denied: mouse aim still works via drag */ }
    }
  });
  window.addEventListener('mouseup', (e) => { if (e.button === 0) mouseDown = false; });

  return {
    axis() {
      const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
      const s = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
      return { f, s };
    },
    get sprint() { return keys.has('ShiftLeft') || keys.has('ShiftRight'); },
    get handbrake() { return keys.has('Space'); },
    // v8d P1 #20: Tab held (keyboard, or the WHEEL touch button which
    // holds 'Tab' the same way BRAKE holds Space).
    get wheelHeld() { return keys.has('Tab'); },
    get firing() { return mouseDown; },
    get clicked() { mouseClicked = false; return mouseClicked; },
    get clickQueued() { return mouseClicked; },
    consumeClick() { mouseClicked = false; },
    takeMouse() { const d = { dx: mouseDX, dy: mouseDY }; mouseDX = 0; mouseDY = 0; return d; },
    // Touch controls (touch.js) write into the SAME state: the look-drag
    // adds mouse deltas, the FIRE button holds the trigger.
    addLook(dx, dy) { mouseDX += dx; mouseDY += dy; },
    setFiring(on) { mouseDown = !!on; },
    takeActions() { const a = actions; actions = 0; return a; },
    get locked() { return locked; },
    // Scripted input for the self-test and the staged screenshots.
    inject(code) { press(code); },
    hold(code, on) { if (on) keys.add(code); else keys.delete(code); },
  };
}

export function weaponSlotOf(actions) {
  for (let i = 0; i <= 5; i++) if (actions & (1 << (16 + i))) return i;
  return -1;
}
