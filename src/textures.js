// KESTREL LAGOON — every texture is painted at runtime on a 2D canvas:
// building facades, road asphalt, neon signs, sand and water. No image
// files, no downloads — the whole city is procedural.
import * as THREE from 'three';
import { makeRng } from './random.js';

function canvasTexture(w, h, paint) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  paint(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// v8a #1: three facade styles (pattern: gta7 makeFacadeTexture, MIT —
// glass/brick/concrete with per-style window layouts; gta-clone's
// weathering speckle, parapet band and street grime, UNLICENSED so
// re-implemented here in Kestrel's own code). Day map + night emissive
// map are painted in ONE pass from the same RNG calls (gta-clone's
// windowTextures pattern), so lit windows align pixel-perfect with no
// replay pass to drift. The ground-floor shopfront band is kept on all
// styles — this is still a lagoon tourist town.
const FACADE_BASES = {
  glass: ['#232a35', '#1c222e', '#2a323f'],
  brick: ['#6b4a3a', '#7a5240', '#5d4033'],
  concrete: ['#7a7d84', '#83868d', '#6e7178'],
};
const LIT_WARM = ['#ffd9a0', '#ffe9c0', '#ffcf87'];
const LIT_COOL = '#cfe6ff';

export function facadeTexture(seed, floors, style = 'glass') {
  const rng = makeRng(seed);
  const base = rng.pick(FACADE_BASES[style] || FACADE_BASES.glass);
  const mapC = document.createElement('canvas'); mapC.width = 128; mapC.height = 256;
  const emC = document.createElement('canvas'); emC.width = 128; emC.height = 256;
  const g = mapC.getContext('2d'), ge = emC.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 128, 256);
  ge.fillStyle = '#000000'; ge.fillRect(0, 0, 128, 256);
  // Concrete weathering: faint light/dark speckle over the whole wall.
  for (let i = 0; i < 700; i++) {
    g.fillStyle = rng.chance(0.5) ? `rgba(255,255,255,${rng.range(0, 0.05)})` : `rgba(0,0,0,${rng.range(0, 0.05)})`;
    g.fillRect(Math.floor(rng.range(0, 128)), Math.floor(rng.range(0, 256)), 3, 3);
  }
  const litColor = () => (rng.chance(0.75) ? rng.pick(LIT_WARM) : LIT_COOL);
  if (style === 'glass') {
    // Dense lit window grid — a glass tower. Dark mullion grid, floor
    // slab lines, 42% of panes lit (warm + cool).
    const cols = 6, rows = 8, cw = 128 / cols, rh = 200 / rows;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const px = x * cw + 2, py = 12 + y * rh + 2;
        if (rng.chance(0.42)) {
          const c = litColor();
          g.fillStyle = c; g.globalAlpha = rng.range(0.65, 1);
          g.fillRect(px, py, cw - 4, rh - 5);
          g.globalAlpha = 1;
          ge.fillStyle = c; ge.fillRect(px, py, cw - 4, rh - 5);
        } else {
          g.fillStyle = '#1b2030'; g.fillRect(px, py, cw - 4, rh - 5);
        }
      }
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, 12 + (y + 1) * rh - 1, 128, 2);
    }
  } else if (style === 'brick') {
    // Warm masonry: mortar courses, punched windows with frame shadows
    // and sill highlights, ~35% warmly lit.
    for (let r = 0; r < 16; r++) {
      g.fillStyle = r % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)';
      g.fillRect(0, r * 16, 128, 1);
    }
    const cols = 4, rows = Math.max(3, floors);
    for (let f = 0; f < rows; f++) {
      for (let c = 0; c < cols; c++) {
        const x = 8 + c * 30, y = 22 + f * Math.floor(180 / rows);
        g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(x - 2, y - 2, 24, 28); // frame shadow
        if (rng.chance(0.35)) {
          const col = rng.pick(LIT_WARM);
          g.fillStyle = col; g.globalAlpha = rng.range(0.55, 0.9);
          g.fillRect(x, y, 20, 24);
          g.globalAlpha = 1;
          ge.fillStyle = col; ge.fillRect(x, y, 20, 24);
        } else {
          g.fillStyle = '#10141d'; g.fillRect(x, y, 20, 24);
        }
        g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(x - 2, y + 24, 24, 2); // sill
      }
    }
  } else {
    // Concrete: spandrel strips + dark ribbon windows, lit office
    // segments punched along each ribbon.
    const bands = 7, bh = 200 / bands;
    for (let b = 0; b < bands; b++) {
      const y = 12 + b * bh;
      g.fillStyle = b % 2 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)';
      g.fillRect(0, y, 128, bh * 0.42);
      const ribY = y + bh * 0.42, ribH = bh * 0.5;
      g.fillStyle = '#161b24'; g.fillRect(0, ribY, 128, ribH);
      for (let s = 0; s < 6; s++) {
        if (!rng.chance(0.4)) continue;
        const col = litColor();
        g.fillStyle = col; g.globalAlpha = rng.range(0.5, 0.85);
        g.fillRect(s * 21.3 + 2.5, ribY + ribH * 0.2, 16, ribH * 0.6);
        g.globalAlpha = 1;
        ge.fillStyle = col; ge.fillRect(s * 21.3 + 2.5, ribY + ribH * 0.2, 16, ribH * 0.6);
      }
    }
  }
  // Parapet band at the top, street grime at the bottom.
  g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(0, 0, 128, 8);
  const grime = g.createLinearGradient(0, 256, 0, 200);
  grime.addColorStop(0, 'rgba(10,10,8,0.4)');
  grime.addColorStop(1, 'rgba(10,10,8,0)');
  g.fillStyle = grime; g.fillRect(0, 200, 128, 56);
  // Ground-floor shopfront band (all styles): dark backing, coloured
  // stripe + shop name by day; the stripe glows solid after dark.
  g.fillStyle = 'rgba(20,24,32,0.85)'; g.fillRect(0, 208, 128, 38);
  const stripe = rng.pick(['#ff5d8f', '#4de3ff', '#ffd166', '#7ddf8e']);
  g.fillStyle = stripe; g.fillRect(6, 216, 116, 22);
  g.fillStyle = '#14181f'; g.font = 'bold 13px sans-serif'; g.textAlign = 'center';
  g.fillText(rng.pick(['MARKET', 'TACOS', 'SURF', 'BAR', 'HOTEL', 'PIER 9', 'RAMEN', 'DIVE']), 64, 232);
  ge.fillStyle = stripe; ge.fillRect(6, 216, 116, 22);
  const wrap = (c) => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  return { map: wrap(mapC), emissive: wrap(emC) };
}

export function roadTexture() {
  return canvasTexture(128, 128, (g) => {
    g.fillStyle = '#33373f'; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 500; i++) {
      g.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`;
      g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
    }
    g.fillStyle = '#f2c94c'; g.fillRect(60, 0, 4, 40); g.fillRect(60, 88, 4, 40);
    g.fillStyle = '#e8e8e8'; g.fillRect(4, 0, 3, 128); g.fillRect(121, 0, 3, 128);
  });
}

export function groundTexture() {
  return canvasTexture(256, 256, (g) => {
    g.fillStyle = '#7fae6e'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(${60 + Math.random() * 60},${120 + Math.random() * 60},${50 + Math.random() * 40},0.5)`;
      g.fillRect(Math.random() * 256, Math.random() * 256, 3, 3);
    }
  });
}

export function sandTexture() {
  return canvasTexture(128, 128, (g) => {
    g.fillStyle = '#e8d5a8'; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 400; i++) {
      g.fillStyle = `rgba(180,150,90,${Math.random() * 0.4})`;
      g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
    }
  });
}

export function waterTexture() {
  return canvasTexture(128, 128, (g) => {
    const grad = g.createLinearGradient(0, 0, 128, 128);
    grad.addColorStop(0, '#2fa8b8'); grad.addColorStop(1, '#1d7f9e');
    g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
    g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 2;
    for (let i = 0; i < 14; i++) {
      const y = Math.random() * 128;
      g.beginPath(); g.moveTo(Math.random() * 128, y);
      g.bezierCurveTo(40, y - 6, 80, y + 6, 128, y); g.stroke();
    }
  });
}

export function signTexture(text, fg, bg) {
  // Auto-fit: shrink the font until the whole text fits the canvas with a
  // margin, so a long name (KESTREL LAGOON) is never clipped at the edges
  // the way it was on the 256x64 canvas.
  return canvasTexture(512, 128, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, 512, 128);
    g.strokeStyle = fg; g.lineWidth = 6; g.strokeRect(6, 6, 500, 116);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    let size = 72;
    g.font = `bold ${size}px sans-serif`;
    while (g.measureText(text).width > 470 && size > 12) {
      size -= 2;
      g.font = `bold ${size}px sans-serif`;
    }
    g.fillStyle = fg;
    g.fillText(text, 256, 68);
  });
}

export function runwayTexture() {
  return canvasTexture(128, 256, (g) => {
    g.fillStyle = '#3a3f47'; g.fillRect(0, 0, 128, 256);
    g.fillStyle = '#f2f2f2';
    for (let y = 8; y < 256; y += 42) g.fillRect(60, y, 8, 26);
    g.fillStyle = '#ffd166'; g.font = 'bold 34px sans-serif'; g.textAlign = 'center';
    g.fillText('09', 64, 240);
  });
}

// Procedural character portrait: a small canvas face from skin/hair/style.
// Used for crew, contacts and the dialogue box — distinct per character.
export function portraitCanvas(person, size = 72) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const g = c.getContext('2d');
  const u = size / 72;
  g.fillStyle = person.color || '#888';
  g.fillRect(0, 0, size, size);
  // Shoulders.
  g.fillStyle = '#2b2f3a';
  g.beginPath(); g.ellipse(36 * u, 78 * u, 30 * u, 22 * u, 0, Math.PI, 0); g.fill();
  // Head.
  g.fillStyle = person.skin || '#c98d5f';
  g.beginPath(); g.ellipse(36 * u, 36 * u, 19 * u, 22 * u, 0, 0, Math.PI * 2); g.fill();
  // Hair.
  g.fillStyle = person.hair || '#222';
  const style = person.hairStyle || 'short';
  if (style === 'bun') {
    g.beginPath(); g.arc(36 * u, 12 * u, 8 * u, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(36 * u, 20 * u, 20 * u, 10 * u, 0, Math.PI, 0); g.fill();
  } else if (style === 'mohawk') {
    g.fillRect(32 * u, 2 * u, 8 * u, 18 * u);
    g.beginPath(); g.moveTo(28 * u, 14 * u); g.lineTo(36 * u, 0); g.lineTo(44 * u, 14 * u); g.fill();
  } else if (style === 'braids') {
    g.fillRect(14 * u, 18 * u, 7 * u, 34 * u); g.fillRect(51 * u, 18 * u, 7 * u, 34 * u);
    g.beginPath(); g.ellipse(36 * u, 20 * u, 20 * u, 10 * u, 0, Math.PI, 0); g.fill();
  } else if (style === 'bob') {
    g.beginPath(); g.ellipse(36 * u, 26 * u, 21 * u, 22 * u, 0, Math.PI, 0); g.fill();
    g.fillRect(15 * u, 26 * u, 6 * u, 22 * u); g.fillRect(51 * u, 26 * u, 6 * u, 22 * u);
  } else if (style === 'slick') {
    g.beginPath(); g.ellipse(36 * u, 18 * u, 19 * u, 9 * u, 0, Math.PI, 0); g.fill();
    g.fillRect(17 * u, 16 * u, 38 * u, 4 * u);
  } else {
    g.beginPath(); g.ellipse(36 * u, 20 * u, 20 * u, 9 * u, 0, Math.PI, 0); g.fill();
  }
  // Eyes + brows + mouth.
  g.fillStyle = '#14181f';
  g.beginPath(); g.arc(29 * u, 36 * u, 2.4 * u, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(43 * u, 36 * u, 2.4 * u, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#14181f'; g.lineWidth = 2 * u;
  g.beginPath(); g.moveTo(25 * u, 30 * u); g.lineTo(33 * u, 29 * u); g.stroke();
  g.beginPath(); g.moveTo(39 * u, 29 * u); g.lineTo(47 * u, 30 * u); g.stroke();
  g.beginPath(); g.arc(36 * u, 46 * u, 6 * u, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
  return c;
}

export function portraitURL(person, size = 72) {
  return portraitCanvas(person, size).toDataURL('image/png');
}
