// KESTREL LAGOON — graphics presets + adaptive resolution: four named
// presets (Low / Medium / High / Ultra) that drive the pixel-ratio cap,
// bloom, rain density and the streetlight pool size, plus a resolution
// scaler that steps the pixel ratio down when the frame rate sags and
// back up when the device has headroom — so the game holds its frame
// rate on a phone without the player touching anything.
//
// Pattern: neonbay index.html (MIT — the PRESETS table, the G-key cycle,
// the 0.5 s fps windows, the 0.85 down-step after 3 low windows and the
// 1.1 up-step after 8 high windows, the 0.6 floor). Kestrel's own code:
// the preset table is Kestrel's (bloom / rain / light-pool knobs neonbay
// does not have), the apply callback is injected by main.js so this
// module owns state and math, not the renderer.
export const PRESETS = {
  low:    { label: 'LOW',    cap: 1.0,  bloom: false, rain: 0.4, lights: 3 },
  medium: { label: 'MEDIUM', cap: 1.25, bloom: false, rain: 0.7, lights: 4 },
  high:   { label: 'HIGH',   cap: 1.5,  bloom: false, rain: 1.0, lights: 6 },
  ultra:  { label: 'ULTRA',  cap: 2.0,  bloom: true,  rain: 1.0, lights: 6 },
};
export const PRESET_ORDER = ['low', 'medium', 'high', 'ultra'];
export const DEFAULT_PRESET = 'high';

const LOW_FPS = 48; // below this the device is struggling
const HIGH_FPS = 58; // above this the device has headroom
const LOW_WINDOWS = 3; // consecutive low windows before stepping down
const HIGH_WINDOWS = 8; // consecutive high windows before stepping up
const DOWN_STEP = 0.85;
const UP_STEP = 1.1;
const MIN_SCALE = 0.6; // never render below 60% resolution

export function createGraphics(apply) {
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  let preset = DEFAULT_PRESET;
  let scale = Math.min(PRESETS[preset].cap, dpr);
  let fpsN = 0, fpsT = 0, fps = 60;
  let lowFor = 0, highFor = 0;

  function cap() { return Math.min(PRESETS[preset].cap, dpr); }

  function setPreset(name) {
    if (!PRESETS[name]) name = DEFAULT_PRESET;
    preset = name;
    // A new preset resets the adaptive scale to its cap: the scaler
    // re-probes from the top instead of inheriting a sagged scale.
    scale = cap();
    lowFor = 0; highFor = 0;
    apply(PRESETS[preset], scale);
    return preset;
  }

  function cyclePreset() {
    const next = PRESET_ORDER[(PRESET_ORDER.indexOf(preset) + 1) % PRESET_ORDER.length];
    return setPreset(next);
  }

  // Adaptive resolution (neonbay pattern): measure fps over 0.5 s
  // windows; step the pixel ratio down fast (3 low windows) and up
  // slowly (8 high windows), so the scaler never oscillates. main.js
  // gates this to normal play — never during ?shot= staging or the
  // self-test, where a moving pixel ratio would make the capture
  // non-deterministic (neonbay disables it in view/VCLK mode too).
  function update(dt) {
    fpsN++; fpsT += dt;
    if (fpsT < 0.5) return;
    fps = Math.round(fpsN / fpsT);
    fpsN = 0; fpsT = 0;
    lowFor = fps < LOW_FPS ? lowFor + 1 : 0;
    highFor = fps > HIGH_FPS ? highFor + 1 : 0;
    if (lowFor >= LOW_WINDOWS && scale > MIN_SCALE) {
      scale = Math.max(MIN_SCALE, +(scale * DOWN_STEP).toFixed(2));
      lowFor = 0;
      apply(PRESETS[preset], scale);
    } else if (highFor >= HIGH_WINDOWS && scale < cap()) {
      scale = Math.min(cap(), +(scale * UP_STEP).toFixed(2));
      highFor = 0;
      apply(PRESETS[preset], scale);
    }
  }

  return {
    setPreset, cyclePreset, update,
    applyNow() { apply(PRESETS[preset], scale); },
    state() {
      return { preset, scale, cap: cap(), fps, bloom: PRESETS[preset].bloom };
    },
    get preset() { return preset; },
    get scale() { return scale; },
  };
}
