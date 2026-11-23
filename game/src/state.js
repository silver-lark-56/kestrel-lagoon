// KESTREL LAGOON — the single mutable game state: money, rep, wanted level,
// mission progress, crew orders, radio, statistics and the three save slots.
// Pure data and save/load; no rendering and no three.js in here.
import { CACHES, CREW, JOBS, PROPERTIES, RACES, RADIO, REP_NEEDS, REP_TITLES, WEAPONS, repLevel } from './config.js';

export const SAVE_PREFIX = 'kestrel-lagoon.save.';
export const SETTINGS_KEY = 'kestrel-lagoon.settings';

export function freshStats() {
  return {
    kills: 0, shotsFired: 0, shotsHit: 0, distanceDriven: 0, distanceWalked: 0,
    moneyEarned: 0, timePlayed: 0, carsStolen: 0, racesWon: 0, faresDone: 0,
    stunts: 0, cachesFound: 0, deaths: 0, missionsDone: 0,
  };
}

export function freshState() {
  return {
    seed: 1,
    screen: 'title', // title | play | paused | map | stats | controls | settings | over | victory
    prevScreen: 'play',
    day: 1, clock: 18.2, // game clock in hours; day 1 starts at golden hour
    cash: 250, rep: 0,
    health: 100, armour: 0,
    wanted: 0, wantedTimer: 0, inSight: false, searchZone: 0,
    heat: 0, // v8a #4: heat points — stars are derived from heat (34 = 1st star, then +100/star)
    // v8a #6: leonida-style search state — the circle is centred where
    // the player was LAST SEEN (not on the player) and grows while the
    // cops sweep; hotScenes are crime scenes that re-raise the heat if
    // the player walks back through them while clean.
    searchCenter: null, // {x, z} while searching, else null
    searchRadius: 0, // metres, grows 8/s while searching
    lastSeen: null, // {x, z} where a cop last had eyes on the player
    hotScenes: [], // {x, z, radius, until, playerInside}
    weaponIndex: 1,
    ammo: WEAPONS.map((w) => ({ mag: w.ammo === Infinity ? Infinity : w.ammo, reserve: w.reserve })),
    ownedWeapons: [0, 1],
    jobIndex: 0, stageIndex: 0, stageKills: 0, jobActive: false,
    jobsDone: [],
    crew: CREW.map((c) => ({ id: c.id, order: 'FOLLOW', cooldown: 0, active: true, recruited: false })),
    crewSelected: 0, // which crew member C / X acts on (index into CREW)
    playerX: -200, playerZ: 140, // updated every frame by main.js
    stageTimer: 0, objectiveDist: 0,
    radioIndex: 1, radioTrack: 0, radioTime: 0, radioOn: true,
    muted: false, volume: 0.7, sensitivity: 1, cameraMode: 0,
    inCar: false, speedKmh: 0, vehicleName: '', vehicleHealth: 100, gear: 1,
    districtHeat: {}, // district id -> extra heat 0..5, decays over time
    cachesFound: [],
    propertiesOwned: [],
    garage: [],
    raceBest: {},
    taxiActive: false, deliveryActive: false,
    stats: freshStats(),
    dialogue: null, // {speaker, role, color, text, until}
    banner: null, // {text, sub, until} big centre announcement
    areaBanner: null, // {name, blurb, until} district-entry announcement (v8a #5)
    toast: null, // {text, until} small notice
    objective: null, // {x, z, label, dist}
    gameOverReason: '',
    victoryShown: false,
  };
}

// The one live state object. Modules import S and mutate it; main.js owns boot.
export const S = freshState();

export function resetState() {
  const fresh = freshState();
  for (const k of Object.keys(S)) delete S[k];
  Object.assign(S, fresh);
}

export function currentJob() {
  return S.jobIndex < JOBS.length ? JOBS[S.jobIndex] : null;
}

export function currentStage() {
  const job = currentJob();
  return job ? job.stages[S.stageIndex] : null;
}

export function nextStageLabel() {
  const job = currentJob();
  if (!job) return 'Story complete';
  const next = job.stages[S.stageIndex + 1];
  return next ? next.label : 'Finish the job';
}

export function money(n) {
  return '$' + Math.floor(n).toLocaleString('en-US');
}

export function clockText() {
  const h = Math.floor(S.clock) % 24;
  const m = Math.floor((S.clock % 1) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function dayName() {
  return ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'][(S.day - 1) % 7];
}

export function addCash(n, why) {
  S.cash += n;
  if (n > 0) S.stats.moneyEarned += n;
  if (why) showToast(`${n >= 0 ? '+' : ''}${money(n)} — ${why}`);
}

// Alias used by the mission/activity modules.
export function addMoney(n, why) { return addCash(n, why); }

export function repTitle() { return REP_TITLES[repLevel(S.rep)]; }

// Skills (1–5 pips each) derived from play statistics — shown on the map
// screen so progression is visible at a glance. Every pip is earned by a
// real stat, never staged directly.
export function skillLevels() {
  const st = S.stats;
  const pips = (v) => Math.max(1, Math.min(5, v));
  return [
    { name: 'DRIVING', level: pips(1 + Math.floor(st.distanceDriven / 6000)) },
    { name: 'SHOOTING', level: pips(1 + Math.floor(st.kills / 6)) },
    { name: 'STAMINA', level: pips(1 + Math.floor(st.distanceWalked / 4000)) },
    { name: 'STEALTH', level: pips(1 + Math.floor(S.cachesFound.length / 5)) },
    { name: 'INFLUENCE', level: pips(1 + Math.floor(S.rep / 400)) },
    { name: 'STREET SENSE', level: pips(1 + Math.floor(S.jobsDone.length / 2)) },
  ];
}

// Overall completion: story jobs 50%, Gull Caches 20%, properties 15%,
// street races 15%.
export function completionPct() {
  const jobs = (S.jobsDone.length / JOBS.length) * 50;
  const caches = (S.cachesFound.length / CACHES.length) * 20;
  const props = (S.propertiesOwned.length / PROPERTIES.length) * 15;
  const races = (S.stats.racesWon / RACES.length) * 15;
  return Math.round(jobs + caches + props + races);
}

// Next REP title and the REP it needs, or null at the top title.
export function repNext() {
  const lvl = repLevel(S.rep);
  if (lvl >= REP_TITLES.length - 1) return null;
  return { title: REP_TITLES[lvl + 1], need: REP_NEEDS[lvl + 1] };
}

export function hideDialogue() { S.dialogue = null; }

export function listSlots() { return [slotSummary(0), slotSummary(1), slotSummary(2)]; }
export function saveSlot(slot) { return saveToSlot(slot); }
export function loadSlot(slot) { return loadFromSlot(slot); }

export function addRep(n) {
  S.rep = Math.max(0, S.rep + n);
}

export function showDialogue(speaker, role, color, text, seconds = 6) {
  S.dialogue = { speaker, role, color, text, until: performance.now() / 1000 + seconds };
}

export function showBanner(text, sub = '', seconds = 3) {
  S.banner = { text, sub, until: performance.now() / 1000 + seconds };
}

// v8a #5: the district name + blurb shown when the player enters a new
// area (GTA's area-name card). Same expiry pattern as showBanner.
export function showAreaBanner(name, blurb, seconds = 4) {
  S.areaBanner = { name, blurb, until: performance.now() / 1000 + seconds };
}

export function showToast(text, seconds = 3) {
  S.toast = { text, until: performance.now() / 1000 + seconds };
}

export function saveSnapshot() {
  return {
    v: 1, savedAt: new Date().toISOString(), day: S.day, clock: S.clock,
    cash: S.cash, rep: S.rep, health: S.health, armour: S.armour,
    jobIndex: S.jobIndex, stageIndex: S.stageIndex, jobActive: S.jobActive,
    jobsDone: S.jobsDone, cachesFound: S.cachesFound,
    crewRecruited: S.crew.map((c) => c.recruited),
    propertiesOwned: S.propertiesOwned, garage: S.garage,
    ownedWeapons: S.ownedWeapons, stats: S.stats, raceBest: S.raceBest,
  };
}

export function saveToSlot(slot) {
  try {
    window.localStorage.setItem(SAVE_PREFIX + slot, JSON.stringify(saveSnapshot()));
    showToast(`Saved to slot ${slot}`);
    return true;
  } catch { return false; }
}

export function loadFromSlot(slot) {
  try {
    const raw = window.localStorage.getItem(SAVE_PREFIX + slot);
    if (!raw) return null;
    const d = JSON.parse(raw);
    resetState();
    S.day = d.day; S.clock = d.clock; S.cash = d.cash; S.rep = d.rep;
    S.health = d.health; S.armour = d.armour; S.jobIndex = d.jobIndex;
    S.stageIndex = d.stageIndex || 0; S.jobActive = !!d.jobActive;
    if (Array.isArray(d.crewRecruited)) d.crewRecruited.forEach((r, i) => { if (S.crew[i]) S.crew[i].recruited = !!r; });
    S.jobsDone = d.jobsDone || []; S.cachesFound = d.cachesFound || [];
    S.propertiesOwned = d.propertiesOwned || []; S.garage = d.garage || [];
    S.ownedWeapons = d.ownedWeapons || [0, 1]; S.stats = { ...freshStats(), ...(d.stats || {}) };
    S.raceBest = d.raceBest || {};
    return d;
  } catch { return null; }
}

export function slotSummary(slot) {
  try {
    const raw = window.localStorage.getItem(SAVE_PREFIX + slot);
    if (!raw) return null;
    const d = JSON.parse(raw);
    const job = JOBS[d.jobIndex];
    return {
      chapter: job ? `Ch.${job.no} ${job.title}` : 'Story complete',
      cash: d.cash, day: d.day, clock: d.clock, savedAt: d.savedAt,
    };
  } catch { return null; }
}

export function loadSettings() {
  try {
    const d = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) || '{}');
    if (typeof d.volume === 'number') S.volume = d.volume;
    if (typeof d.sensitivity === 'number') S.sensitivity = d.sensitivity;
    if (typeof d.muted === 'boolean') S.muted = d.muted;
    if (typeof d.cameraMode === 'number') S.cameraMode = d.cameraMode;
  } catch { /* defaults stand */ }
}

export function saveSettings() {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      volume: S.volume, sensitivity: S.sensitivity, muted: S.muted, cameraMode: S.cameraMode,
    }));
  } catch { /* storage can be off */ }
}

export function radioStation() { return RADIO[S.radioIndex]; }
export function radioTrack() { return radioStation().tracks[S.radioTrack % radioStation().tracks.length]; }
