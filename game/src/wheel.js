// KESTREL LAGOON — GTA-style radial weapon wheel (v8d P1 #20).
// Hold Tab (or hold the WHEEL touch button) to open; steer the virtual
// cursor around the ring with the mouse (pointer-lock deltas, or the
// absolute cursor when unlocked); release Tab to equip the highlighted
// weapon, or tap a segment directly. Time runs at 20% while the wheel
// is open — the world keeps moving, slowly, the way GTA V slows time
// in the wheel. Number keys 1–6 still switch directly and close the
// wheel. Unowned weapons show dimmed; picking one refuses with the
// same Harbor Arms toast as the number keys (combat.switchWeapon).
//
// No reference repo had a weapon wheel (the deep-dive found only a
// radial deadzone in gta7 and an inventory list in fable), so the
// layout is Kestrel's own: 6 segments, one per weapon slot, slot 0 at
// the top, 60° apart.
import { WEAPONS } from './config.js';

const SLOWMO = 0.2; // game speed while the wheel is open
const DEADZONE = 34; // px from the centre before a segment highlights
const CURSOR_MAX = 140; // virtual cursor clamp (px from centre)
const CHIP_RADIUS = 115; // px from the centre to each segment chip
const SHORT = ['FISTS', 'P9', 'SMG', '12G', 'AR', 'FRAG'];

export function createWheel({ getState, onSelect }) {
  // getState: () => ({ owned: number[], index: number, ammo: [{mag, reserve}] })
  // onSelect: (slot) => void — combat.switchWeapon, which owns the
  // unowned-weapon refusal + the switch toast.
  let open = false;
  let highlighted = -1;
  const cursor = { x: 0, y: 0 }; // virtual cursor, px from the centre
  const el = document.getElementById('weapon-wheel');
  const ring = el.querySelector('.ww-ring');
  const nameEl = el.querySelector('#ww-name');
  const ammoEl = el.querySelector('#ww-ammo');
  const cursorEl = el.querySelector('#ww-cursor');
  const chips = [];

  function chipAngle(i) { return (i * 60 - 90) * Math.PI / 180; }
  function segmentAt(x, y) {
    const r = Math.hypot(x, y);
    if (r < DEADZONE) return -1;
    const deg = Math.atan2(y, x) * 180 / Math.PI; // 0 = east, clockwise (y down)
    return ((Math.round((deg + 90) / 60) % 6) + 6) % 6;
  }
  function ammoText(i) {
    const st = getState();
    if (i === 0) return '∞';
    const a = st.ammo[i];
    return a ? `${a.mag} / ${a.reserve}` : '—';
  }
  function render() {
    const st = getState();
    for (let i = 0; i < chips.length; i++) {
      const owned = st.owned.includes(i);
      chips[i].classList.toggle('locked', !owned);
      chips[i].classList.toggle('active', i === highlighted);
      chips[i].classList.toggle('current', i === st.index);
      chips[i].querySelector('.ww-ammo').textContent = owned ? ammoText(i) : 'LOCKED';
    }
    const show = highlighted >= 0 ? highlighted : st.index;
    nameEl.textContent = WEAPONS[show].name;
    ammoEl.textContent = st.owned.includes(show) ? ammoText(show) : 'Harbor Arms';
    cursorEl.style.transform = `translate(${cursor.x}px, ${cursor.y}px)`;
  }

  // Build the 6 segment chips once, positioned around the ring.
  for (let i = 0; i < 6; i++) {
    const c = document.createElement('div');
    c.className = 'ww-chip';
    c.dataset.slot = i;
    const a = chipAngle(i);
    c.style.left = `calc(50% + ${Math.cos(a) * CHIP_RADIUS}px)`;
    c.style.top = `calc(50% + ${Math.sin(a) * CHIP_RADIUS}px)`;
    c.innerHTML = `<div class="ww-label">${SHORT[i]}</div><div class="ww-ammo">—</div>`;
    // Tap/click a segment to equip it directly (the touch path: hold
    // WHEEL with one thumb, tap a segment with another finger).
    c.addEventListener('click', () => {
      if (!open) return;
      onSelect(i);
      close();
    });
    ring.appendChild(c);
    chips.push(c);
  }

  // The virtual cursor follows the mouse. Pointer-locked (the usual
  // in-game state) the cursor position freezes, so the deltas steer
  // it; unlocked, the absolute position does. The listener is on the
  // window, not the canvas — it must work whether or not the pointer
  // is locked.
  window.addEventListener('mousemove', (e) => {
    if (!open) return;
    if (document.pointerLockElement) {
      cursor.x += e.movementX || 0;
      cursor.y += e.movementY || 0;
    } else {
      const rect = el.getBoundingClientRect();
      cursor.x = e.clientX - (rect.left + rect.width / 2);
      cursor.y = e.clientY - (rect.top + rect.height / 2);
    }
    const r = Math.hypot(cursor.x, cursor.y);
    if (r > CURSOR_MAX) { cursor.x *= CURSOR_MAX / r; cursor.y *= CURSOR_MAX / r; }
    highlighted = segmentAt(cursor.x, cursor.y);
    render();
  });

  function openWheel() {
    if (open) return;
    open = true;
    highlighted = -1;
    cursor.x = 0; cursor.y = 0;
    render();
    el.style.display = 'block';
  }
  function close() {
    if (!open) return;
    open = false;
    highlighted = -1;
    el.style.display = 'none';
  }
  // Release Tab: equip the highlighted weapon (if any) and close. A
  // locked highlight refuses via switchWeapon's own toast; no
  // highlight (cursor near the centre) just closes, keeping the
  // current weapon.
  function confirm() {
    if (!open) return;
    const slot = highlighted;
    close();
    if (slot >= 0) onSelect(slot);
  }

  return {
    open: openWheel,
    close,
    confirm,
    isOpen: () => open,
    timeScale: () => (open ? SLOWMO : 1),
    probeState: () => ({ open, highlighted, timeScale: open ? SLOWMO : 1 }),
  };
}
