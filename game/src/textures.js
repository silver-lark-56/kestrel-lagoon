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

const FACADE_PALETTES = [
  ['#e8dcc8', '#f4ead6', '#d9c9a8'], // sand stucco
  ['#f2b8c6', '#e89aad', '#d97f96'], // coral pink
  ['#a8d8d0', '#8fc9c0', '#79b8ad'], // seafoam
  ['#ffd9a0', '#ffcc7d', '#f0b85e'], // marigold
  ['#c9d6e8', '#b3c6de', '#9db4d0'], // pale blue
  ['#e8e4da', '#d8d2c2', '#c4bca6'], // bone
];

export function facadeTexture(seed, floors) {
  const rng = makeRng(seed);
  const pal = rng.pick(FACADE_PALETTES);
  const base = pal[0], trim = pal[2];
  return canvasTexture(128, 256, (g) => {
    g.fillStyle = base; g.fillRect(0, 0, 128, 256);
    g.fillStyle = trim; g.fillRect(0, 0, 128, 10); g.fillRect(0, 246, 128, 10);
    const cols = 4;
    for (let f = 0; f < floors; f++) {
      for (let c = 0; c < cols; c++) {
        const x = 8 + c * 30, y = 22 + f * Math.floor(210 / floors);
        const lit = rng.chance(0.45);
        g.fillStyle = lit ? '#ffe9a8' : '#2c3a4d';
        g.fillRect(x, y, 20, 26);
        g.fillStyle = 'rgba(255,255,255,0.25)';
        g.fillRect(x, y, 20, 4);
      }
    }
    // Ground-floor shopfront band.
    g.fillStyle = 'rgba(20,24,32,0.85)'; g.fillRect(0, 208, 128, 38);
    g.fillStyle = rng.pick(['#ff5d8f', '#4de3ff', '#ffd166', '#7ddf8e']);
    g.fillRect(6, 216, 116, 22);
    g.fillStyle = '#14181f'; g.font = 'bold 13px sans-serif'; g.textAlign = 'center';
    g.fillText(rng.pick(['MARKET', 'TACOS', 'SURF', 'BAR', 'HOTEL', 'PIER 9', 'RAMEN', 'DIVE']), 64, 232);
  });
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
  return canvasTexture(256, 64, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, 256, 64);
    g.strokeStyle = fg; g.lineWidth = 4; g.strokeRect(4, 4, 248, 56);
    g.fillStyle = fg; g.font = 'bold 30px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 128, 34);
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
