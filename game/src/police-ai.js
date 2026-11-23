// KESTREL LAGOON — police AI helpers: the foot cop (an officer who
// leaves the cruiser and chases on foot) and the arrest timer (BUSTED).
// Patterns: fable DESIGN.md (on-foot chase 6.6 m/s — NO LICENSE,
// pattern only, Kestrel's own code) and leonida CopBrain / arrest.ts /
// PoliceDriver (MIT). Pure helpers + one small entity; the police
// system in police.js owns the loop.
import { buildPersonMesh } from './pedestrians.js';
import { resolveCircle } from './city.js';

// Fable's numbers: a foot cop runs 6.6 m/s (faster than Rook's 6.2 m/s
// walk, slower than his 10.5 m/s sprint — you can outrun one, but not
// by strolling). Arrest range 2.5 m, contact timer 1.0 s (leonida).
export const FOOT_COP_SPEED = 6.6;
export const ARREST_RANGE = 2.5;
export const ARREST_SECONDS = 1.0;

export function createFootCop(scene, x, z, heading) {
  // Navy uniform + cap: the same articulated figure as every other
  // person in the city, so the walk cycle just works.
  const mesh = buildPersonMesh(0x1a2f4a, 0xe8b98d, 1.02,
    { hair: 0x1c1c22, hairStyle: 'short', accessory: 'cap', accessoryColor: 0x14181f, pants: 0x14181f });
  mesh.position.set(x, 0, z);
  mesh.rotation.y = heading;
  scene.add(mesh);
  return {
    mesh, x, z, heading, hp: 60, walkPhase: 0, shootTimer: 1,
    dead: false, dist: 0, unit: null, provoked: false,
  };
}

export function removeFootCop(scene, cop) {
  scene.remove(cop.mesh);
}

// Chase the player on foot: run straight at them (buildings push the
// cop out, the same resolveCircle every pedestrian uses), with the
// shared walk cycle. No pathing — at 6.6 m/s over the short distances
// a bail covers, straight-line pursuit reads fine.
export function updateFootCop(cop, dt, playerPos, colliders) {
  if (cop.dead) return;
  const dx = playerPos.x - cop.x, dz = playerPos.z - cop.z;
  const dist = Math.hypot(dx, dz);
  cop.heading = Math.atan2(dx, dz);
  if (dist > 1.2) {
    cop.x += Math.sin(cop.heading) * FOOT_COP_SPEED * dt;
    cop.z += Math.cos(cop.heading) * FOOT_COP_SPEED * dt;
    cop.walkPhase += dt * 11;
  }
  const fixed = resolveCircle(colliders, cop.x, cop.z, 0.8);
  cop.x = fixed.x; cop.z = fixed.z;
  const u = cop.mesh.userData;
  const swing = dist > 1.2 ? Math.sin(cop.walkPhase) * 0.55 : 0;
  u.legL.rotation.x = swing; u.legR.rotation.x = -swing;
  u.armL.rotation.x = -swing; u.armR.rotation.x = swing;
  cop.mesh.position.set(cop.x, 0, cop.z);
  cop.mesh.rotation.y = cop.heading;
}

// BUSTED (leonida arrest.ts): a cop inside arrest range with a still
// player runs the 1.0 s contact timer; at 1.0 s the player is
// arrested. Whether the timer may run at all is the caller's decision
// (s.arrestable — the CopBrain rule in police.js: 1–2★ and the cop
// not lethal). Contact lost: the timer decays 2×/s rather than
// snapping to zero, so a stumble does not reset it.
export function createArrest() {
  return {
    timer: 0,
    busting: false,
    update(dt, s) {
      if (this.busting) return false;
      if (!s.arrestable || !s.contact || !s.still) {
        this.timer = Math.max(0, this.timer - dt * 2);
        return false;
      }
      this.timer += dt;
      if (this.timer >= ARREST_SECONDS) {
        this.busting = true;
        return true;
      }
      return false;
    },
    reset() {
      this.timer = 0;
      this.busting = false;
    },
  };
}

// v8d master study (§8.7): explicit PIT / box-in moved to P2 — no
// reference repo has it, so it is a Kestrel differentiator for a later
// version, not for this submit. The box-in slots and the roadblock
// planner that lived here were removed rather than left as dead code;
// the existing 1-in-3 roadblock mode in police.js stays as-is.
