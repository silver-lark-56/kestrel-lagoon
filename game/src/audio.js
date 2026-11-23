// KESTREL LAGOON — all sound is synthesized live with WebAudio: engine hum,
// sirens, gunfire, footsteps of UI, and three procedural radio stations.
// No audio files, no network. Everything is guarded: no AudioContext, no sound.
import { RADIO } from './config.js';
import { S } from './state.js';

// One station = a bass line + a lead arp, as semitone patterns over a root.
const PATTERNS = [
  { root: 110, bpm: 96, bass: [0, 0, 7, 5, 3, 3, 7, 10], lead: [12, 15, 19, 15, 12, 10, 7, 10], wave: 'triangle' },
  { root: 130.8, bpm: 118, bass: [0, 0, 0, 7, 0, 0, 10, 7], lead: [12, 12, 15, 19, 24, 19, 15, 12], wave: 'sawtooth' },
  { root: 98, bpm: 132, bass: [0, 7, 0, 5, 0, 7, 10, 5], lead: [7, 12, 10, 12, 15, 12, 10, 7], wave: 'square' },
];

function noteFreq(root, semitone) { return root * Math.pow(2, semitone / 12); }

export function createAudio() {
  let ctx = null, master = null, musicGain = null, sfxGain = null;
  let engineOsc = null, engineGain = null, engineFilter = null;
  let sirenOsc = null, sirenGain = null, sirenTimer = 0;
  let radioTimer = null, radioStep = 0;
  let rainSrc = null, rainGain = null;
  let started = false;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = S.muted ? 0 : S.volume;
      master.connect(ctx.destination);
      musicGain = ctx.createGain(); musicGain.gain.value = 0.5; musicGain.connect(master);
      sfxGain = ctx.createGain(); sfxGain.gain.value = 0.9; sfxGain.connect(master);
      return true;
    } catch { return false; }
  }

  function start() {
    if (started || !ensure()) return;
    started = true;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    // Engine: a detuned saw pair through a lowpass, pitch follows speed.
    engineOsc = ctx.createOscillator(); engineOsc.type = 'sawtooth'; engineOsc.frequency.value = 55;
    engineFilter = ctx.createBiquadFilter(); engineFilter.type = 'lowpass'; engineFilter.frequency.value = 320;
    engineGain = ctx.createGain(); engineGain.gain.value = 0;
    engineOsc.connect(engineFilter); engineFilter.connect(engineGain); engineGain.connect(sfxGain);
    engineOsc.start();
    // Siren: two-tone square, gain gated by wanted level.
    sirenOsc = ctx.createOscillator(); sirenOsc.type = 'square'; sirenOsc.frequency.value = 720;
    sirenGain = ctx.createGain(); sirenGain.gain.value = 0;
    sirenOsc.connect(sirenGain); sirenGain.connect(sfxGain);
    sirenOsc.start();
    scheduleRadio();
  }

  function scheduleRadio() {
    if (radioTimer) clearInterval(radioTimer);
    radioTimer = setInterval(() => {
      if (!ctx || !S.radioOn || S.muted) return;
      const p = PATTERNS[S.radioIndex % PATTERNS.length];
      const stepDur = 60 / p.bpm / 2;
      const t = ctx.currentTime + 0.02;
      const bass = ctx.createOscillator(); bass.type = 'sine';
      bass.frequency.value = noteFreq(p.root / 2, p.bass[radioStep % p.bass.length]);
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(0.22, t); bg.gain.exponentialRampToValueAtTime(0.01, t + stepDur);
      bass.connect(bg); bg.connect(musicGain); bass.start(t); bass.stop(t + stepDur);
      if (radioStep % 2 === 0) {
        const lead = ctx.createOscillator(); lead.type = p.wave;
        lead.frequency.value = noteFreq(p.root, p.lead[(radioStep / 2) % p.lead.length]);
        const lg = ctx.createGain();
        lg.gain.setValueAtTime(0.08, t); lg.gain.exponentialRampToValueAtTime(0.01, t + stepDur * 2);
        lead.connect(lg); lg.connect(musicGain); lead.start(t); lead.stop(t + stepDur * 2);
      }
      radioStep++;
    }, 240);
  }

  function blip(freq, dur, type, vol) {
    if (!ensure() || !ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = type || 'sine'; o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol || 0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(sfxGain); o.start(t); o.stop(t + dur);
  }

  function noiseBurst(dur, vol, low) {
    if (!ensure() || !ctx) return;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = low ? 'lowpass' : 'highpass'; f.frequency.value = low ? 900 : 1200;
    const g = ctx.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(sfxGain); src.start();
  }

  return {
    start,
    ensure,
    setMuted(m) { if (master) master.gain.value = m ? 0 : S.volume; },
    setVolume(v) { if (master) master.gain.value = S.muted ? 0 : v; },
    update(dt, speedKmh, wanted) {
      if (!ctx || !started) return;
      if (engineOsc) {
        const target = S.inCar ? 0.05 + Math.min(0.12, speedKmh / 900) : 0;
        engineGain.gain.setTargetAtTime(target, ctx.currentTime, 0.1);
        engineOsc.frequency.setTargetAtTime(50 + speedKmh * 1.1, ctx.currentTime, 0.08);
        engineFilter.frequency.setTargetAtTime(280 + speedKmh * 6, ctx.currentTime, 0.1);
      }
      if (sirenOsc) {
        sirenTimer += dt;
        sirenOsc.frequency.value = Math.floor(sirenTimer * 1.6) % 2 === 0 ? 720 : 960;
        sirenGain.gain.setTargetAtTime(wanted > 0 ? 0.02 + wanted * 0.006 : 0, ctx.currentTime, 0.3);
      }
    },
    gunshot() { noiseBurst(0.12, 0.5, false); blip(160, 0.08, 'square', 0.2); },
    punch() { noiseBurst(0.08, 0.3, true); },
    crash() { noiseBurst(0.3, 0.5, true); blip(70, 0.25, 'sawtooth', 0.25); },
    // v8d #10: a car explosion — long low noise + a sub sine drop.
    explosion() { noiseBurst(0.8, 0.9, true); blip(60, 0.7, 'sine', 0.5); },
    // v8d #12: a dual-tone car horn (two detuned saws, 0.4 s).
    horn() { blip(370, 0.4, 'sawtooth', 0.18); blip(466, 0.4, 'sawtooth', 0.18); },
    thunder() { noiseBurst(2.2, 0.5, true); blip(48, 1.8, 'sine', 0.25); },
    // Rain ambience: one looping filtered-noise source, gain follows the
    // weather intensity. Created lazily on the first rain — while dry,
    // this returns before ensure() so no AudioContext is even built.
    setRain(level) {
      if (level <= 0.01 && !rainSrc) return;
      if (!ensure() || !ctx) return;
      if (!rainSrc) {
        const len = ctx.sampleRate * 2;
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        rainSrc = ctx.createBufferSource(); rainSrc.buffer = buf; rainSrc.loop = true;
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1400;
        rainGain = ctx.createGain(); rainGain.gain.value = 0;
        rainSrc.connect(f); f.connect(rainGain); rainGain.connect(sfxGain);
        rainSrc.start();
      }
      if (rainGain) rainGain.gain.setTargetAtTime(Math.max(0, Math.min(1, level)) * 0.14, ctx.currentTime, 0.5);
    },
    pickup() { blip(660, 0.1, 'sine', 0.2); setTimeout(() => blip(990, 0.14, 'sine', 0.2), 90); },
    cash() { blip(880, 0.09, 'triangle', 0.2); setTimeout(() => blip(1320, 0.12, 'triangle', 0.18), 80); },
    click() { blip(1200, 0.05, 'sine', 0.12); },
    denied() { blip(180, 0.15, 'square', 0.15); },
    radioSwitch() { scheduleRadio(); blip(1500, 0.06, 'sine', 0.12); },
    stationName() { return RADIO[S.radioIndex].freq; },
  };
}
