// KESTREL LAGOON — the open world around the story: Harbor Arms gun shop,
// Lagoon Auto respray, the Boathouse safehouse, income properties, 20 Gull
// Caches, 3 street races, taxi gigs, the stunt counter, and the day/night
// cycle that drives the sun, the lamps and the sky.
import { S, addMoney, addRep, showToast, showBanner, saveToSlot } from './state.js';
import { SHOPS, RACES, PROPERTIES, CACHES, WEAPONS } from './config.js';

export function createActivities(ctx) {
  const { city, driving, police, audio } = ctx;
  const state = {
    race: null, // {def, checkpoint, time}
    taxi: null, // {dest, fare, timer}
    lastDay: 1,
  };

  // --- Day / night ----------------------------------------------------------
  function sunPosition() {
    const t = (S.clock - 6) / 24 * Math.PI * 2; // 06:00 = sunrise
    return {
      x: Math.cos(t) * 100,
      y: Math.sin(t) * 100,
      z: 40,
      elevation: Math.sin(t),
    };
  }
  function isNight() { return S.clock < 6 || S.clock >= 19; }
  function isSunset() { return S.clock >= 17 && S.clock < 19; }

  function updateClock(dt) {
    S.clock += dt * (24 / 480); // one full day = 8 real minutes
    if (S.clock >= 24) {
      S.clock -= 24;
      S.day += 1;
      collectIncome();
    }
    S.stats.timePlayed += dt / 60;
  }

  // --- Shops ------------------------------------------------------------------
  function nearestShop(playerPos) {
    let best = null, bd = 12;
    for (const s of SHOPS) {
      const d = Math.hypot(s.x - playerPos.x, s.z - playerPos.z);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  function useShop(shop) {
    if (shop.id === 'arms') {
      // Buy the next unowned weapon, or top up ammo.
      const nextIdx = WEAPONS.findIndex((w, i) => w.price > 0 && !S.ownedWeapons.includes(i));
      if (nextIdx >= 0) {
        const next = WEAPONS[nextIdx];
        if (S.cash < next.price) { showToast(`Need $${next.price} for the ${next.name}`); audio.denied(); return; }
        addMoney(-next.price, next.name);
        S.ownedWeapons.push(nextIdx);
        S.ammo[nextIdx] = { mag: next.ammo, reserve: next.ammo * 3 };
        showToast(`${next.name} bought — press ${nextIdx + 1} to equip`);
        audio.cash();
      } else {
        if (S.cash < 150) { showToast('Need $150 for ammo'); audio.denied(); return; }
        addMoney(-150, 'Ammo');
        for (const i of S.ownedWeapons) {
          const w = WEAPONS[i];
          if (w.ammo !== Infinity) S.ammo[i].reserve += w.ammo * 2;
        }
        showToast('Ammo topped up');
        audio.cash();
      }
    } else if (shop.id === 'auto') {
      if (!S.inCar) { showToast('Bring a car into Lagoon Auto to respray it'); return; }
      if (S.cash < 300) { showToast('Respray costs $300'); audio.denied(); return; }
      addMoney(-300, 'Respray');
      const car = driving.getCar();
      if (car) {
        car.health = 100;
        S.vehicleHealth = 100;
      }
      police.clearAll();
      showBanner('FRESH PAINT', 'New plates, new colour. The heat is gone.');
      audio.cash();
    } else if (shop.id === 'boathouse') {
      saveToSlot(0);
      S.health = 100;
      showBanner('BOATHOUSE', 'Saved. Rook rests — health restored.');
      audio.cash();
    }
  }

  // --- Collectibles -------------------------------------------------------------
  function checkCaches(playerPos) {
    for (const c of CACHES) {
      if (S.cachesFound.includes(c.id)) continue;
      if (Math.hypot(c.x - playerPos.x, c.z - playerPos.z) < 6) {
        S.cachesFound.push(c.id);
        addMoney(250, 'Gull Cache');
        addRep(15);
        showToast(`Gull Cache found (${S.cachesFound.length}/20) — +$250`);
        audio.pickup();
      }
    }
  }

  // --- Street races ---------------------------------------------------------------
  function startRace(def) {
    state.race = { def, checkpoint: 0, time: 0 };
    showBanner(`RACE — ${def.name}`, `${def.checkpoints.length} checkpoints · win $${def.prize.toLocaleString()}`);
    showToast('Reach the checkpoints in order');
  }

  function updateRace(dt, playerPos) {
    if (!state.race) return;
    const r = state.race;
    r.time += dt;
    const cp = r.def.checkpoints[r.checkpoint];
    if (!cp) return;
    const d = Math.hypot(cp.x - playerPos.x, cp.z - playerPos.z);
    S.objectiveDist = Math.round(d);
    S.objective = { x: cp.x, z: cp.z, label: `Checkpoint ${r.checkpoint + 1}/${r.def.checkpoints.length}`, dist: S.objectiveDist };
    const b = city.dynamic.beacon;
    if (b) { b.visible = true; b.position.set(cp.x, 0, cp.z); }
    if (d < 14) {
      r.checkpoint += 1;
      audio.pickup();
      if (r.checkpoint >= r.def.checkpoints.length) {
        addMoney(r.def.prize, `Race won: ${r.def.name}`);
        addRep(40);
        S.stats.racesWon += 1;
        showBanner('RACE WON', `${r.def.name} — $${r.def.prize.toLocaleString()} · ${r.time.toFixed(1)}s`);
        state.race = null;
        S.objective = null;
        if (b) b.visible = false;
      } else {
        showToast(`Checkpoint ${r.checkpoint}/${r.def.checkpoints.length}`);
      }
    }
  }

  // --- Taxi gigs ----------------------------------------------------------------------
  function startTaxi() {
    const dest = { x: (Math.random() - 0.5) * 700, z: (Math.random() - 0.5) * 600 };
    const fare = 120 + Math.floor(Math.random() * 200);
    state.taxi = { dest, fare, timer: 90 };
    showToast(`Taxi fare: take them to the marker — $${fare} if you're quick`);
    const b = city.dynamic.beacon;
    if (b) { b.visible = true; b.position.set(dest.x, 0, dest.z); }
    S.objective = { x: dest.x, z: dest.z, label: 'Drop off the fare', dist: 0 };
  }

  function updateTaxi(dt, playerPos) {
    if (!state.taxi) return;
    const t = state.taxi;
    t.timer -= dt;
    const d = Math.hypot(t.dest.x - playerPos.x, t.dest.z - playerPos.z);
    S.objectiveDist = Math.round(d);
    if (S.objective) S.objective.dist = S.objectiveDist;
    if (d < 10) {
      const bonus = t.timer > 0 ? Math.floor(t.timer) : 0;
      addMoney(t.fare + bonus, 'Taxi fare');
      S.stats.faresDone += 1;
      showToast(`Fare complete — $${t.fare + bonus}`);
      state.taxi = null;
      const b = city.dynamic.beacon;
      if (b) b.visible = false;
      S.objective = null;
    } else if (t.timer <= 0) {
      showToast('The fare got out — too slow');
      state.taxi = null;
      const b = city.dynamic.beacon;
      if (b) b.visible = false;
      S.objective = null;
    }
  }

  // --- Properties --------------------------------------------------------------------
  function buyProperty(prop) {
    if (S.propertiesOwned.includes(prop.id)) { showToast('Already yours'); return; }
    if (S.cash < prop.price) { showToast(`${prop.name} costs $${prop.price.toLocaleString()}`); audio.denied(); return; }
    addMoney(-prop.price, prop.name);
    S.propertiesOwned.push(prop.id);
    showBanner('PROPERTY BOUGHT', `${prop.name} — earns $${prop.income}/day`);
    audio.cash();
  }

  function collectIncome() {
    let total = 0;
    for (const id of S.propertiesOwned) {
      const p = PROPERTIES.find((x) => x.id === id);
      if (p) total += p.income;
    }
    if (total > 0) {
      addMoney(total, 'Property income');
      showToast(`Property income: +$${total}`);
    }
  }

  // --- Stunt counter -------------------------------------------------------------------
  function noteJump(airSeconds) {
    if (airSeconds > 0.9) {
      S.stats.stunts += 1;
      const bonus = Math.floor(airSeconds * 100);
      addMoney(bonus, 'Stunt jump');
      showToast(`STUNT! ${airSeconds.toFixed(1)}s air — +$${bonus}`);
      addRep(10);
    }
  }

  return {
    state, sunPosition, isNight, isSunset, updateClock,
    nearestShop, useShop, checkCaches, startRace, updateRace,
    startTaxi, updateTaxi, buyProperty, collectIncome, noteJump,
  };
}
