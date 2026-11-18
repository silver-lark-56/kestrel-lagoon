// KESTREL LAGOON — the screens: title (logo, saves, crew, logline), pause,
// the full city map (jobs, payouts, districts, legend, stats, GPS route),
// controls, settings and statistics. The map screen is also the hub for
// starting jobs, races, gigs and property deals.
import { S, saveToSlot, loadFromSlot, slotSummary, repTitle } from './state.js';
import { JOBS, DISTRICTS, WORLD, CREW, RACES, PROPERTIES, CACHES, RADIO, SHOPS, districtAt, personById } from './config.js';
import { portraitURL } from './textures.js';

const $ = (id) => document.getElementById(id);

export function createScreens(ctx) {
  const { missions, activities, audio } = ctx;
  let mapCanvas = null;
  let mapCtx = null;
  let onStartGame = null; // set by main.js: (fresh) => void
  let onResume = null;
  let onQuitToTitle = null;

  function show(id) {
    for (const s of ['title-screen', 'pause-screen', 'map-screen', 'controls-screen', 'settings-screen', 'stats-screen']) {
      const el = $(s);
      if (el) el.style.display = s === id ? '' : 'none';
    }
    const hud = $('hud');
    if (hud) hud.style.display = (id === null || id === undefined) ? '' : 'none';
    S.screen = id ? id.replace('-screen', '') : 'game';
  }

  function hideAll() { show(null); }

  // --- Title ------------------------------------------------------------------
  function renderTitle() {
    const slot = slotSummary(0);
    const cont = $('btn-continue');
    if (cont) {
      cont.disabled = !slot;
      if (slot) cont.textContent = `CONTINUE — ${slot.chapter} · $${slot.cash.toLocaleString()} · DAY ${slot.day}`;
      else cont.textContent = 'CONTINUE — NO SAVE YET';
    }
    const crewRow = $('title-crew');
    if (crewRow) {
      crewRow.innerHTML = CREW.map((c) => `<div class="title-crew-card"><img src="${portraitURL(c)}" alt="${c.name}"><div class="tc-name">${c.name}</div><div class="tc-role">${c.callsign} · ${c.role}</div><div class="tc-ability">${c.ability} — ${c.abilityDesc}</div></div>`).join('');
    }
    const contacts = $('title-contacts');
    if (contacts) {
      contacts.innerHTML = JOBS.slice(0, 4).map((j) => {
        const p = personById(j.contact);
        return `<div class="contact-chip"><span class="contact-name">${p.name}</span><span class="contact-job">${j.title} · $${j.payout.toLocaleString()}</span></div>`;
      }).join('');
    }
  }

  // --- Full map -----------------------------------------------------------------
  function drawMap(playerPos) {
    if (!mapCanvas) { mapCanvas = $('map-canvas'); if (!mapCanvas) return; mapCtx = mapCanvas.getContext('2d'); }
    const W = mapCanvas.width, H = mapCanvas.height;
    const sx = W / (WORLD.halfX * 2 + 80), sz = H / (WORLD.halfZ * 2 + 80);
    const toMap = (wx, wz) => ({ x: W / 2 + wx * sx, y: H / 2 + wz * sz });
    const c = mapCtx;
    c.fillStyle = '#123a4d';
    c.fillRect(0, 0, W, H);
    // Land.
    c.fillStyle = '#3f7d4e';
    const tl = toMap(-WORLD.halfX, -WORLD.halfZ), br = toMap(WORLD.halfX, WORLD.halfZ);
    c.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    // Sand ring.
    c.strokeStyle = '#e8d8a8'; c.lineWidth = 6;
    c.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    // District fills + labels + heat.
    for (const d of DISTRICTS) {
      const a = toMap(d.x0, d.z0), b = toMap(d.x1, d.z1);
      c.fillStyle = `rgba(255,80,60,${0.06 * d.heat})`;
      c.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
      c.strokeStyle = 'rgba(255,255,255,0.25)'; c.lineWidth = 1;
      c.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      // District label with a dark outline so it stays legible over blips.
      // Two lines keep narrow districts from colliding with their neighbours.
      const lx = (a.x + b.x) / 2, ly = (a.y + b.y) / 2;
      const words = d.name.split(' ');
      const line1 = words.slice(0, Math.ceil(words.length / 2)).join(' ');
      const line2 = words.slice(Math.ceil(words.length / 2)).join(' ');
      c.font = 'bold 10px sans-serif'; c.textAlign = 'center';
      c.lineWidth = 3; c.strokeStyle = 'rgba(0,0,0,0.65)';
      c.strokeText(line1, lx, ly - 5);
      c.fillStyle = 'rgba(255,255,255,0.92)';
      c.fillText(line1, lx, ly - 5);
      if (line2) {
        c.strokeText(line2, lx, ly + 6);
        c.fillText(line2, lx, ly + 6);
      }
      c.font = '9px sans-serif';
      c.strokeText(`HEAT ${'★'.repeat(d.heat)}${'☆'.repeat(5 - d.heat)}`, lx, ly + 18);
      c.fillStyle = 'rgba(255,255,255,0.7)';
      c.fillText(`HEAT ${'★'.repeat(d.heat)}${'☆'.repeat(5 - d.heat)}`, lx, ly + 18);
    }
    // Roads.
    const ROAD_XS = [-380, -304, -228, -152, -76, 0, 76, 152, 228, 304, 380];
    const ROAD_ZS = [-304, -228, -152, -76, 0, 76, 152, 228, 304];
    c.strokeStyle = '#565b66'; c.lineWidth = 3;
    for (const rx of ROAD_XS) { const a = toMap(rx, -WORLD.halfZ), b = toMap(rx, WORLD.halfZ); c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); }
    for (const rz of ROAD_ZS) { const a = toMap(-WORLD.halfX, rz), b = toMap(WORLD.halfX, rz); c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); }
    // Causeway + airstrip + marina basin.
    c.strokeStyle = '#ffc933'; c.lineWidth = 4;
    { const a = toMap(318, 0), b = toMap(386, 0); c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); }
    c.fillStyle = '#3a3f4a';
    { const a = toMap(388, 195), b = toMap(412, 345); c.fillRect(a.x, a.y, b.x - a.x, b.y - a.y); }
    c.fillStyle = '#1b6f8e';
    { const a = toMap(150, 210), b = toMap(330, 350); c.fillRect(a.x, a.y, b.x - a.x, b.y - a.y); }
    const blip = (wx, wz, color, r = 6, label) => {
      const p = toMap(wx, wz);
      c.fillStyle = color;
      c.beginPath(); c.arc(p.x, p.y, r, 0, Math.PI * 2); c.fill();
      c.strokeStyle = '#000'; c.lineWidth = 1.5; c.stroke();
      if (label) { c.fillStyle = '#fff'; c.font = 'bold 9px sans-serif'; c.textAlign = 'center'; c.fillText(label, p.x, p.y - r - 3); }
    };
    // Jobs.
    for (const j of JOBS) {
      const m = missions.jobMarker(j.id);
      if (!m) continue;
      const done = S.jobsDone.includes(j.id);
      const active = S.jobActive && S.jobIndex === JOBS.indexOf(j);
      blip(m.x, m.z, done ? '#39d353' : active ? '#ffd166' : '#ff5d8f', active ? 9 : 6, `CH${j.no}`);
    }
    // Shops, caches, races, properties.
    for (const s of SHOPS) blip(s.x, s.z, s.id === 'arms' ? '#ff8a5c' : s.id === 'auto' ? '#4de3ff' : '#7ddf8e', 5);
    for (const cc of CACHES) if (!S.cachesFound.includes(cc.id)) blip(cc.x, cc.z, '#b388ff', 3);
    for (const r of RACES) blip(r.x, r.z, '#4de3ff', 6, 'RACE');
    for (const p of PROPERTIES) blip(p.x, p.z, S.propertiesOwned.includes(p.id) ? '#39d353' : '#ffd166', 6, '$');
    // GPS route.
    if (S.objective) {
      const a = toMap(playerPos.x, playerPos.z), b = toMap(S.objective.x, S.objective.z);
      c.strokeStyle = '#ffd166'; c.lineWidth = 3; c.setLineDash([8, 5]);
      c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
      c.setLineDash([]);
      blip(S.objective.x, S.objective.z, '#ffd166', 8, 'GPS');
    }
    // Player.
    const pp = toMap(playerPos.x, playerPos.z);
    c.fillStyle = '#fff';
    c.beginPath(); c.arc(pp.x, pp.y, 7, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#000'; c.lineWidth = 2; c.stroke();
    c.fillStyle = '#000'; c.font = 'bold 9px sans-serif'; c.textAlign = 'center';
    c.fillText('YOU', pp.x, pp.y + 3);
  }

  function renderMapPanel() {
    const list = $('map-job-list');
    if (list) {
      const next = missions.nextOpenJob();
      list.innerHTML = JOBS.map((j) => {
        const done = S.jobsDone.includes(j.id);
        const active = S.jobActive && S.jobIndex === JOBS.indexOf(j);
        const locked = !done && !active && next && next.id !== j.id;
        const status = done ? 'DONE ✓' : active ? 'ACTIVE ▶' : locked ? 'LOCKED' : 'AVAILABLE';
        const p = personById(j.contact);
        // Compact cards: only the next available job gets a button, so all 8
        // jobs + races + stats fit on one 720px screen without scrolling.
        const action = (!done && !locked && !active)
          ? `<button class="mj-btn" data-job="${j.id}">START JOB</button>`
          : '';
        return `<div class="map-job ${done ? 'done' : ''} ${active ? 'active' : ''}"><div class="mj-head"><span class="mj-ch">CH${j.no}</span><span class="mj-title">${j.title}</span><span class="mj-pay">$${j.payout.toLocaleString()}</span></div><div class="mj-sub">${p.name} · ${status}</div>${action}</div>`;
      }).join('');
      list.querySelectorAll('.mj-btn').forEach((b) => b.addEventListener('click', () => {
        missions.startJob(b.getAttribute('data-job'));
        hideAll();
        if (onResume) onResume();
      }));
    }
    const stats = $('map-stats');
    if (stats) {
      stats.innerHTML = `<div>Cash <b>$${S.cash.toLocaleString()}</b></div><div>REP <b>${S.rep} · ${repTitle()}</b></div><div>Jobs <b>${S.jobsDone.length}/8</b></div><div>Gull Caches <b>${S.cachesFound.length}/20</b></div><div>Properties <b>${S.propertiesOwned.length}/2</b></div><div>Wanted <b>${'★'.repeat(S.wanted)}${'☆'.repeat(5 - S.wanted)}</b></div><div>District <b>${districtAt(S.playerX, S.playerZ).name}</b></div><div>Day <b>${S.day}</b></div>`;
    }
    const races = $('map-races');
    if (races) {
      races.innerHTML = RACES.map((r) => `<button class="race-btn" data-race="${r.id}">${r.name} — $${r.prize.toLocaleString()}</button>`).join('') +
        `<button class="race-btn" data-gig="taxi">TAXI GIG — pick up a fare</button>` +
        PROPERTIES.map((p) => `<button class="race-btn prop-btn" data-prop="${p.id}" ${S.propertiesOwned.includes(p.id) ? 'disabled' : ''}>${S.propertiesOwned.includes(p.id) ? 'OWNED: ' : 'BUY: '}${p.name} — $${p.price.toLocaleString()} ($${p.income}/day)</button>`).join('');
      races.querySelectorAll('.race-btn').forEach((b) => b.addEventListener('click', () => {
        const rid = b.getAttribute('data-race');
        const gig = b.getAttribute('data-gig');
        const prop = b.getAttribute('data-prop');
        if (rid) activities.startRace(RACES.find((r) => r.id === rid));
        if (gig === 'taxi') activities.startTaxi();
        if (prop) activities.buyProperty(PROPERTIES.find((p) => p.id === prop));
        hideAll();
        if (onResume) onResume();
      }));
    }
  }

  function openMap(playerPos) {
    renderMapPanel();
    drawMap(playerPos);
    show('map-screen');
  }

  // --- Stats --------------------------------------------------------------------
  function renderStats() {
    const el = $('stats-body');
    if (!el) return;
    const acc = S.stats.shotsFired > 0 ? Math.round(S.stats.shotsHit / S.stats.shotsFired * 100) : 0;
    el.innerHTML = `
      <div class="stat-row"><span>Jobs completed</span><b>${S.stats.jobsDone} / 8</b></div>
      <div class="stat-row"><span>Money earned</span><b>$${S.stats.moneyEarned.toLocaleString()}</b></div>
      <div class="stat-row"><span>Accuracy</span><b>${acc}% (${S.stats.shotsHit}/${S.stats.shotsFired})</b></div>
      <div class="stat-row"><span>Distance driven</span><b>${(S.stats.distanceDriven / 1000).toFixed(1)} km</b></div>
      <div class="stat-row"><span>Distance walked</span><b>${(S.stats.distanceWalked / 1000).toFixed(1)} km</b></div>
      <div class="stat-row"><span>Cars stolen</span><b>${S.stats.carsStolen}</b></div>
      <div class="stat-row"><span>Races won</span><b>${S.stats.racesWon}</b></div>
      <div class="stat-row"><span>Taxi fares</span><b>${S.stats.faresDone}</b></div>
      <div class="stat-row"><span>Stunt jumps</span><b>${S.stats.stunts}</b></div>
      <div class="stat-row"><span>Gull Caches</span><b>${S.cachesFound.length} / 20</b></div>
      <div class="stat-row"><span>Time played</span><b>${Math.floor(S.stats.timePlayed)} min</b></div>
      <div class="stat-row"><span>REP</span><b>${S.rep} · ${repTitle()}</b></div>`;
  }

  // --- Wiring ---------------------------------------------------------------------
  let lastMenu = 'title-screen';
  function openSub(id, from) {
    lastMenu = from;
    if (id === 'stats-screen') renderStats();
    show(id);
  }

  function wire() {
    const btnNew = $('btn-new');
    if (btnNew) btnNew.addEventListener('click', () => { audio.start(); if (onStartGame) onStartGame(true); });
    const btnCont = $('btn-continue');
    if (btnCont) btnCont.addEventListener('click', () => { audio.start(); if (onStartGame) onStartGame(false); });
    const btnControls = $('btn-controls');
    if (btnControls) btnControls.addEventListener('click', () => openSub('controls-screen', 'title-screen'));
    const btnSettings = $('btn-settings');
    if (btnSettings) btnSettings.addEventListener('click', () => openSub('settings-screen', 'title-screen'));
    const btnStats = $('btn-stats');
    if (btnStats) btnStats.addEventListener('click', () => openSub('stats-screen', 'title-screen'));
    const btnPauseControls = $('btn-pause-controls');
    if (btnPauseControls) btnPauseControls.addEventListener('click', () => openSub('controls-screen', 'pause-screen'));
    const btnPauseSettings = $('btn-pause-settings');
    if (btnPauseSettings) btnPauseSettings.addEventListener('click', () => openSub('settings-screen', 'pause-screen'));
    const btnPauseStats = $('btn-pause-stats');
    if (btnPauseStats) btnPauseStats.addEventListener('click', () => openSub('stats-screen', 'pause-screen'));
    document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => {
      if (lastMenu === 'title-screen') renderTitle();
      show(lastMenu);
    }));
    const btnResume = $('btn-resume');
    if (btnResume) btnResume.addEventListener('click', () => { hideAll(); if (onResume) onResume(); });
    const btnSave = $('btn-save');
    if (btnSave) btnSave.addEventListener('click', () => { saveToSlot(0); });
    const btnQuit = $('btn-quit');
    if (btnQuit) btnQuit.addEventListener('click', () => { renderTitle(); show('title-screen'); if (onQuitToTitle) onQuitToTitle(); });
    const btnMapClose = $('btn-map-close');
    if (btnMapClose) btnMapClose.addEventListener('click', () => { hideAll(); if (onResume) onResume(); });
    // Settings controls.
    const vol = $('setting-volume');
    if (vol) { vol.value = Math.round(S.volume * 100); vol.addEventListener('input', () => { S.volume = vol.value / 100; audio.setVolume(S.volume); }); }
    const sens = $('setting-sensitivity');
    if (sens) { sens.value = Math.round(S.sensitivity * 100); sens.addEventListener('input', () => { S.sensitivity = sens.value / 100; }); }
    const cam = $('setting-camera');
    if (cam) { cam.value = String(S.cameraMode); cam.addEventListener('change', () => { S.cameraMode = parseInt(cam.value, 10); }); }
    const radio = $('setting-radio');
    if (radio) {
      radio.innerHTML = RADIO.map((r, i) => `<option value="${i}">${r.freq} — ${r.genre}</option>`).join('');
      radio.value = String(S.radioIndex);
      radio.addEventListener('change', () => { S.radioIndex = parseInt(radio.value, 10); audio.radioSwitch(); });
    }
  }

  return {
    show, hideAll, renderTitle, openMap, renderMapPanel, drawMap, renderStats, wire,
    set onStartGame(fn) { onStartGame = fn; },
    set onResume(fn) { onResume = fn; },
    set onQuitToTitle(fn) { onQuitToTitle = fn; },
  };
}
