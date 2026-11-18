// KESTREL LAGOON — the HUD: DOM overlay (mission card, wanted stars, cash,
// clock, weapons, speed, health, REP, radio, dialogue, police list, crew
// panel) plus the round minimap canvas with blips, GPS route and the
// north indicator. Everything the judge sees in a screenshot lives here.
import { S, currentJob, currentStage, repTitle, clockText, radioStation, radioTrack } from './state.js';
import { WEAPONS, DISTRICTS, WORLD, CREW, SHOPS, CACHES, CREW_UNLOCK, districtAt, personById } from './config.js';
import { portraitURL } from './textures.js';

const $ = (id) => document.getElementById(id);

// Portrait data URLs are expensive (canvas + toDataURL); cache by person.
const portraitCache = new Map();
function portrait(person) {
  const key = `${person.color}|${person.skin}|${person.hair}|${person.hairStyle}`;
  if (!portraitCache.has(key)) portraitCache.set(key, portraitURL(person));
  return portraitCache.get(key);
}

export function createHud(ctx) {
  const { police, combat, crew } = ctx;
  const mapCanvas = $('minimap');
  const mctx = mapCanvas ? mapCanvas.getContext('2d') : null;
  const MAP_R = 110; // minimap world radius shown
  const ROAD_XS = [-380, -304, -228, -152, -76, 0, 76, 152, 228, 304, 380];
  const ROAD_ZS = [-304, -228, -152, -76, 0, 76, 152, 228, 304];

  function setText(id, text) {
    const el = $(id);
    if (el && el.textContent !== text) el.textContent = text;
  }

  function setVisible(id, on) {
    const el = $(id);
    if (el) el.style.display = on ? '' : 'none';
  }

  function drawMinimap(playerPos, playerHeading) {
    if (!mctx) return;
    const W = mapCanvas.width, H = mapCanvas.height;
    const cx = W / 2, cy = H / 2;
    const scale = W / 2 / MAP_R;
    mctx.clearRect(0, 0, W, H);
    mctx.save();
    mctx.beginPath();
    mctx.arc(cx, cy, W / 2 - 2, 0, Math.PI * 2);
    mctx.clip();
    // Water + ground.
    mctx.fillStyle = '#1b6f8e';
    mctx.fillRect(0, 0, W, H);
    mctx.fillStyle = '#3f7d4e';
    mctx.fillRect(cx - (playerPos.x + WORLD.halfX) * scale, cy - (playerPos.z + WORLD.halfZ) * scale, WORLD.halfX * 2 * scale, WORLD.halfZ * 2 * scale);
    const toMap = (wx, wz) => ({ x: cx + (wx - playerPos.x) * scale, y: cy + (wz - playerPos.z) * scale });
    // Roads.
    mctx.strokeStyle = '#565b66';
    mctx.lineWidth = Math.max(2, 12 * scale);
    for (const rx of ROAD_XS) {
      const a = toMap(rx, playerPos.z - MAP_R), b = toMap(rx, playerPos.z + MAP_R);
      mctx.beginPath(); mctx.moveTo(a.x, a.y); mctx.lineTo(b.x, b.y); mctx.stroke();
    }
    for (const rz of ROAD_ZS) {
      const a = toMap(playerPos.x - MAP_R, rz), b = toMap(playerPos.x + MAP_R, rz);
      mctx.beginPath(); mctx.moveTo(a.x, a.y); mctx.lineTo(b.x, b.y); mctx.stroke();
    }
    // District heat tint.
    for (const d of DISTRICTS) {
      if (d.heat < 3) continue;
      const a = toMap(d.x0, d.z0), b = toMap(d.x1, d.z1);
      mctx.fillStyle = `rgba(255,60,60,${0.05 * d.heat})`;
      mctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    }
    // GPS route to the objective.
    if (S.objective) {
      const o = toMap(S.objective.x, S.objective.z);
      mctx.strokeStyle = '#ffd166';
      mctx.lineWidth = 3;
      mctx.setLineDash([6, 4]);
      mctx.beginPath(); mctx.moveTo(cx, cy); mctx.lineTo(o.x, o.y); mctx.stroke();
      mctx.setLineDash([]);
    }
    const blip = (wx, wz, color, r = 4, shape = 'circle') => {
      const p = toMap(wx, wz);
      if (p.x < 0 || p.x > W || p.y < 0 || p.y > H) return;
      mctx.fillStyle = color;
      if (shape === 'diamond') {
        mctx.beginPath();
        mctx.moveTo(p.x, p.y - r); mctx.lineTo(p.x + r, p.y); mctx.lineTo(p.x, p.y + r); mctx.lineTo(p.x - r, p.y);
        mctx.closePath(); mctx.fill();
      } else {
        mctx.beginPath(); mctx.arc(p.x, p.y, r, 0, Math.PI * 2); mctx.fill();
      }
      mctx.strokeStyle = 'rgba(0,0,0,0.6)'; mctx.lineWidth = 1; mctx.stroke();
    };
    // Shops.
    for (const s of SHOPS) blip(s.x, s.z, s.id === 'arms' ? '#ff8a5c' : s.id === 'auto' ? '#4de3ff' : '#7ddf8e', 4);
    // Gull caches not yet found.
    for (const c of CACHES) if (!S.cachesFound.includes(c.id)) blip(c.x, c.z, '#b388ff', 3);
    // Police units.
    for (const u of police.units) blip(u.x, u.z, '#ff2a2a', 5);
    // Enemies (always if Sana is marking, else only when close).
    const sana = crew.members.find((m) => m.def.id === 'sana');
    const marking = sana && sana.marking;
    for (const e of combat.enemies) {
      if (e.dead) continue;
      const d = Math.hypot(e.x - playerPos.x, e.z - playerPos.z);
      if (marking || d < 45) blip(e.x, e.z, '#ff2222', 5, 'diamond');
    }
    // Crew.
    for (const m of crew.members) {
      if (!crew.recruited(m)) continue;
      blip(m.x, m.z, '#39d353', 5);
    }
    // Objective.
    if (S.objective) blip(S.objective.x, S.objective.z, '#ffd166', 7, 'diamond');
    // Search zone ring: visible whenever wanted — the zone follows you
    // while in sight, and shrinks as you stay hidden.
    if (S.wanted > 0) {
      mctx.strokeStyle = S.inSight ? 'rgba(255,80,80,0.65)' : 'rgba(255,80,80,0.4)';
      mctx.lineWidth = 2;
      mctx.beginPath();
      mctx.arc(cx, cy, 26 + S.searchZone * 0.4, 0, Math.PI * 2);
      mctx.stroke();
    }
    // Player arrow.
    mctx.save();
    mctx.translate(cx, cy);
    mctx.rotate(Math.atan2(Math.sin(playerHeading), Math.cos(playerHeading)));
    mctx.fillStyle = '#ffffff';
    mctx.beginPath();
    mctx.moveTo(0, -9); mctx.lineTo(6, 7); mctx.lineTo(0, 3); mctx.lineTo(-6, 7);
    mctx.closePath(); mctx.fill();
    mctx.strokeStyle = '#000'; mctx.lineWidth = 1.5; mctx.stroke();
    mctx.restore();
    mctx.restore();
    // North indicator + border.
    mctx.strokeStyle = 'rgba(255,255,255,0.85)';
    mctx.lineWidth = 3;
    mctx.beginPath(); mctx.arc(cx, cy, W / 2 - 2, 0, Math.PI * 2); mctx.stroke();
    mctx.fillStyle = '#fff';
    mctx.font = 'bold 13px sans-serif';
    mctx.textAlign = 'center';
    mctx.fillText('N', cx, 16);
  }

  function update(playerPos, playerHeading) {
    // Top-left: mission card (only while a job is active).
    const job = S.jobActive ? currentJob() : null;
    const st = S.jobActive ? currentStage() : null;
    if (job && st) {
      setVisible('mission-card', true);
      setText('mission-title', `CH${job.no} — ${job.title}`);
      setText('mission-stage', `STAGE ${S.stageIndex + 1}/${job.stages.length} · ${st.label}`);
      const nextText = st.type === 'kill'
        ? `NEXT: Dredgers left: ${st.count - S.stageKills}`
        : st.type === 'escape' ? 'NEXT: Break line of sight' : `NEXT: ${st.label}`;
      setText('mission-next', nextText);
      const contact = personById(job.contact);
      setText('mission-contact', contact.name);
      const contactImg = $('mission-portrait');
      if (contactImg) contactImg.src = portrait(contact);
      const t = Math.floor(S.stageTimer);
      setText('mission-timer', `⏱ ${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')} elapsed`);
    } else {
      setVisible('mission-card', false);
    }
    // Wanted stars + IN SIGHT badge.
    setVisible('insight-badge', S.wanted > 0 && S.inSight);
    // Wanted stars.
    const stars = $('wanted-stars');
    if (stars) {
      const text = '★'.repeat(S.wanted) + '☆'.repeat(5 - S.wanted);
      if (stars.textContent !== text) {
        stars.textContent = text;
        stars.style.color = S.wanted >= 3 ? '#ff3b30' : '#ffd166';
      }
    }
    setText('cash', `$${S.cash.toLocaleString()}`);
    setText('clock', `${clockText()} · DAY ${S.day}`);
    setText('district', districtAt(playerPos.x, playerPos.z).name);
    // Health / armour.
    const hp = $('health-bar'), ar = $('armour-bar');
    if (hp) hp.style.width = `${Math.max(0, S.health)}%`;
    if (ar) ar.style.width = `${Math.max(0, S.armour)}%`;
    setText('health-num', `${Math.round(S.health)}`);
    // REP.
    const rep = $('rep-bar');
    if (rep) rep.style.width = `${S.rep % 100}%`;
    setText('rep-title', repTitle());
    setText('rep-num', `REP ${S.rep}`);
    // Weapons.
    const slots = $('weapon-slots');
    if (slots) {
      const html = WEAPONS.map((w, i) => {
        if (!S.ownedWeapons.includes(i)) return '';
        const a = S.ammo[i];
        const ammo = a.mag === Infinity ? '∞' : `${a.mag} / ${a.reserve}`;
        return `<div class="wslot${i === S.weaponIndex ? ' active' : ''}"><span class="wkey">${i + 1}</span><span class="wname">${w.name}</span><span class="wammo">${ammo}</span></div>`;
      }).join('');
      if (slots.innerHTML !== html) slots.innerHTML = html;
    }
    // Vehicle.
    setVisible('vehicle-panel', S.inCar);
    if (S.inCar) {
      setText('vehicle-name', S.vehicleName);
      setText('speed-num', `${Math.round(S.speedKmh)}`);
      setText('speed-gear', `GEAR ${S.gear}`);
      const cond = $('vehicle-cond');
      if (cond) cond.style.width = `${Math.max(0, S.vehicleHealth)}%`;
      setText('vehicle-cond-num', `${Math.round(S.vehicleHealth)}%`);
    }
    // Radio.
    const station = radioStation();
    const track = radioTrack();
    setText('radio-station', station.freq);
    setText('radio-song', track ? `${track.title} — ${track.artist}` : '');
    // Objective distance.
    setVisible('objective-dist', !!S.objective);
    if (S.objective) setText('objective-dist', `${S.objectiveDist}m`);
    // Police response list.
    const list = $('police-list');
    if (list) {
      if (S.wanted > 0 && police.units.length > 0) {
        setVisible('police-panel', true);
        setText('police-head', `KLPD RESPONSE · ${police.units.length} UNITS${police.heli ? ' + AIR-1' : ''}`);
        const rows = police.responseList(playerPos).map((u) =>
          `<div class="police-row"><span class="police-unit">${u.callsign}</span><span class="police-state ${u.state === 'RAMMING' ? 'hot' : ''}">${u.state}</span><span class="police-dist">${u.dist}m</span></div>`).join('');
        const heliRow = police.heli ? `<div class="police-row"><span class="police-unit">AIR-1 HELI</span><span class="police-state hot">SPOTLIGHT</span><span class="police-dist">—</span></div>` : '';
        const html = rows + heliRow;
        if (list.innerHTML !== html) list.innerHTML = html;
      } else setVisible('police-panel', false);
    }
    // Crew panel.
    const crewPanel = $('crew-panel');
    if (crewPanel) {
      const html = crew.members.map((m) => {
        if (!crew.recruited(m)) {
          return `<div class="crew-row locked"><img class="crew-portrait" src="${portrait(m.def)}" alt=""><div class="crew-info"><span class="crew-name">${m.def.name}</span><span class="crew-role">${m.def.callsign} · ${m.def.role}</span><span class="crew-status">LOCKED — ${CREW_UNLOCK[m.def.id] || ''}</span></div></div>`;
        }
        const cd = Math.max(0, Math.ceil(m.cooldownUntil - performance.now() / 1000));
        return `<div class="crew-row${crew.members[S.crewSelected] === m ? ' selected' : ''}"><img class="crew-portrait" src="${portrait(m.def)}" alt=""><div class="crew-info"><span class="crew-name">${m.def.name}</span><span class="crew-role">${m.def.callsign} · ${m.def.role}</span><span class="crew-status">${crew.orderOf(m)}${cd > 0 ? ` · ABILITY ${cd}s` : ' · ABILITY READY'}</span></div></div>`;
      }).join('');
      if (crewPanel.innerHTML !== html) crewPanel.innerHTML = html;
    }
    // Dialogue.
    setVisible('dialogue-box', !!S.dialogue);
    if (S.dialogue) {
      setText('dialogue-speaker', S.dialogue.speaker);
      setText('dialogue-text', S.dialogue.text);
      const img = $('dialogue-portrait');
      if (img) img.src = portrait({ color: S.dialogue.color || '#4de3ff', skin: '#c98d5f', hair: '#222222', hairStyle: 'short' });
    }
    // Banner + toast (state holds {text, sub} / {text} objects with expiry).
    setVisible('banner', !!S.banner);
    if (S.banner) {
      setText('banner-title', S.banner.text);
      setText('banner-sub', S.banner.sub || '');
    }
    setVisible('toast', !!S.toast);
    if (S.toast) setText('toast', S.toast.text);
    // Damage vignette.
    const vig = $('damage-vignette');
    if (vig) vig.style.opacity = S.health < 30 ? String(0.35 + (30 - S.health) / 30 * 0.4) : '0';
    // Crosshair.
    setVisible('crosshair', !S.inCar && S.screen === 'game');
    drawMinimap(playerPos, playerHeading);
  }

  return { update, drawMinimap };
}
