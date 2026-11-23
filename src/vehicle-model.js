// KESTREL LAGOON — the vehicle model: a pure arcade driving step
// (velocity vector + lateral grip + handbrake drift) plus the test-strip
// measurement that feeds the showroom. Pure functions, no three.js, no
// game state — the same step drives the player car (driving.js) and the
// measurements (measureModel), so the showroom numbers are the physics,
// not copy.
//
// Step model adapted from depixeled-chris/gta7 VehicleModel.ts (MIT),
// structure intact: engine/brake force along the current forward axis,
// drag + rolling resistance opposing the velocity vector, steering that
// rotates the heading only, then a re-decomposition against the NEW
// heading whose lateral component is bled by the active grip — high grip
// realigns the velocity to the nose (crisp turn), low grip under the
// handbrake preserves the slide (drift). Rewritten for Kestrel's heading
// convention (heading 0 = +Z, forward = (sin h, cos h), steer +1 = right)
// and Kestrel's per-model parameters (topSpeed / accel from config.js).
// Kestrel additions: a separate reversePower (reverse is gentler than the
// engine) and Kestrel's own turnRate / gripSpeed tuning.
export function configFor(model) {
  // Grip by kind: sports cars stay planted, heavy vans and trucks slide
  // sooner — the same numbers the showroom's drift column measures.
  const GRIP = {
    sports: { gripNormal: 11, gripHandbrake: 0.9 },
    police: { gripNormal: 10.5, gripHandbrake: 0.8 },
    sedan: { gripNormal: 10, gripHandbrake: 0.7 },
    taxi: { gripNormal: 10, gripHandbrake: 0.7 },
    suv: { gripNormal: 9, gripHandbrake: 0.6 },
    truck: { gripNormal: 9, gripHandbrake: 0.6 },
    van: { gripNormal: 9, gripHandbrake: 0.6 },
  };
  const grip = GRIP[model.kind] || GRIP.sedan;
  return {
    enginePower: model.accel, // m/s^2 at full throttle
    brakePower: 34, // m/s^2 when the throttle opposes motion
    reversePower: 10, // m/s^2 backing up
    reverseMaxSpeed: 12,
    maxSpeed: model.topSpeed,
    drag: 0.06, // proportional air drag per second
    rollingResistance: 4, // constant deceleration (m/s^2)
    turnRate: 1.9, // rad/s at full steering authority
    gripSpeed: 8, // speed (m/s) at which steering reaches full authority
    gripNormal: grip.gripNormal, // lateral grip (1/s) with tyres planted
    gripHandbrake: grip.gripHandbrake, // lateral grip with the handbrake locked (low = slide)
    handbrakeDrag: 4, // extra deceleration while the handbrake is held
    handbrakeSteer: 1.4, // steering multiplier while sliding (flickability)
  };
}

const EPS = 1e-4;

// One physics step. st is {x, z, heading, vx, vz} (mutated in place);
// input is {throttle: -1..1, steer: -1..1, handbrake: bool}.
export function stepVehicle(st, input, cfg, dt) {
  const throttle = Math.max(-1, Math.min(1, input.throttle));
  const steer = Math.max(-1, Math.min(1, input.steer));
  let { vx, vz } = st;
  const fx = Math.sin(st.heading), fz = Math.cos(st.heading);

  // Engine / brake force along the current forward axis. Throttle that
  // opposes the motion brakes; throttle with the motion (or from rest)
  // drives — forward with the engine, backward with the gentler reverse.
  const vForward = vx * fx + vz * fz;
  if (throttle !== 0) {
    const opposing = (vForward > EPS && throttle < 0) || (vForward < -EPS && throttle > 0);
    const accel = opposing ? cfg.brakePower : throttle > 0 ? cfg.enginePower : cfg.reversePower;
    vx += fx * throttle * accel * dt;
    vz += fz * throttle * accel * dt;
  }

  // Rolling resistance + handbrake drag oppose the velocity vector
  // directly (the factor clamps at 0, so a coasting car stops dead
  // instead of creeping backwards); air drag scales the vector.
  const speed = Math.hypot(vx, vz);
  if (speed > 1e-5) {
    const decel = (cfg.rollingResistance + (input.handbrake ? cfg.handbrakeDrag : 0)) * dt;
    const factor = Math.max(0, 1 - decel / speed);
    vx *= factor;
    vz *= factor;
  }
  vx -= vx * cfg.drag * dt;
  vz -= vz * cfg.drag * dt;

  // Steering rotates the heading; authority ramps with speed. Invert
  // only for a GENUINE reverse (backing up with grip): mid-drift the
  // nose swings past 90° from the travel direction, so the forward
  // projection goes negative even though the car is still sailing
  // forward — inverting there would pin the slide at 90°. The trailing
  // -1 is Kestrel's sign: D (steer +1) turns right, which DECREASES the
  // heading under forward = (sin h, cos h).
  const authority = Math.max(0, Math.min(1, Math.hypot(vx, vz) / cfg.gripSpeed));
  const dir = vForward < -EPS && !input.handbrake ? -1 : 1;
  const steerMul = input.handbrake ? cfg.handbrakeSteer : 1;
  const heading = st.heading + steer * cfg.turnRate * authority * dir * steerMul * dt * -1;

  // Re-decompose velocity against the NEW heading and bleed off the
  // lateral component by the active grip. High grip realigns velocity
  // to the nose (crisp turn); low grip (handbrake) preserves the slide.
  // The forward clamp is what caps the top speed (and the reverse).
  const nfx = Math.sin(heading), nfz = Math.cos(heading);
  const nrx = -Math.cos(heading), nrz = Math.sin(heading);
  let forward = vx * nfx + vz * nfz;
  let lateral = vx * nrx + vz * nrz;
  const grip = input.handbrake ? cfg.gripHandbrake : cfg.gripNormal;
  lateral *= Math.exp(-grip * dt);
  forward = Math.max(-cfg.reverseMaxSpeed, Math.min(cfg.maxSpeed, forward));
  vx = nfx * forward + nrx * lateral;
  vz = nfz * forward + nrz * lateral;

  st.x += vx * dt;
  st.z += vz * dt;
  st.heading = heading;
  st.vx = vx;
  st.vz = vz;
  return st;
}

export function forwardSpeed(st) { return st.vx * Math.sin(st.heading) + st.vz * Math.cos(st.heading); }
export function lateralSpeed(st) { return st.vx * -Math.cos(st.heading) + st.vz * Math.sin(st.heading); }
export function speedOf(st) { return Math.hypot(st.vx, st.vz); }

// --- Test-strip measurement (neonbay measure() pattern, MIT) -------------
// Runs the model on a flat strip at 120 Hz and reports what the car
// actually does: 0-100 km/h, top speed, braking distance from 100 km/h,
// and the peak lateral slide in a 1 s handbrake turn at 60 km/h.
// Cached per model id — measured once, then free.
const measureCache = new Map();
const STEP = 1 / 120;

export function measureModel(model) {
  if (measureCache.has(model.id)) return measureCache.get(model.id);
  const cfg = configFor(model);
  const fresh = () => ({ x: 0, z: 0, heading: 0, vx: 0, vz: 0 });
  const V100 = 100 / 3.6, V60 = 60 / 3.6;

  // Run 1: flat-out for 40 s — records both 0-100 and the top speed.
  const s1 = fresh();
  let t0100 = null, top = 0;
  for (let t = 0; t < 40; t += STEP) {
    stepVehicle(s1, { throttle: 1, steer: 0, handbrake: false }, cfg, STEP);
    const v = forwardSpeed(s1);
    if (t0100 === null && v >= V100) t0100 = t + STEP;
    if (v > top) top = v;
  }

  // Run 2: accelerate to 100 km/h (or the top, whichever comes first),
  // then brake to a stop — the distance is the braking distance.
  const s2 = fresh();
  let brakeFrom = 0;
  for (let t = 0; t < 30 && forwardSpeed(s2) < V100; t += STEP) {
    stepVehicle(s2, { throttle: 1, steer: 0, handbrake: false }, cfg, STEP);
  }
  brakeFrom = forwardSpeed(s2);
  let brakeM = 0;
  for (let t = 0; t < 10 && forwardSpeed(s2) > 0.1; t += STEP) {
    stepVehicle(s2, { throttle: -1, steer: 0, handbrake: false }, cfg, STEP);
    brakeM += speedOf(s2) * STEP;
  }

  // Run 3: 60 km/h, then 1 s of handbrake + full lock — the peak
  // lateral speed is the car's willingness to slide.
  const s3 = fresh();
  for (let t = 0; t < 30 && forwardSpeed(s3) < V60; t += STEP) {
    stepVehicle(s3, { throttle: 1, steer: 0, handbrake: false }, cfg, STEP);
  }
  let driftLat = 0;
  for (let t = 0; t < 1; t += STEP) {
    stepVehicle(s3, { throttle: 0, steer: 1, handbrake: true }, cfg, STEP);
    const lat = Math.abs(lateralSpeed(s3));
    if (lat > driftLat) driftLat = lat;
  }

  const out = {
    t0100, // seconds to 100 km/h, or null if the car never gets there
    topKmh: top * 3.6,
    brakeM,
    brakeFromKmh: brakeFrom * 3.6,
    driftLat, // m/s of sideways slide in the handbrake turn
  };
  measureCache.set(model.id, out);
  return out;
}
