// KESTREL LAGOON — the story: 8 jobs, each a chain of stages
// (goto / drive / steal / kill / escape / talk / deliver) with named
// contacts, dialogue and payouts. The mission card, the objective beacon
// and the minimap GPS all read the current stage from here. Jobs run in
// story order (jobIndex); the map screen can start the next open job.
import { S, currentJob, currentStage, addMoney, addRep, showBanner, showToast, showDialogue, hideDialogue } from './state.js';
import { JOBS, personById } from './config.js';

export function createMissions(ctx) {
  const { city, driving, combat, police, crew, traffic } = ctx;

  function jobById(id) { return JOBS.find((j) => j.id === id); }

  function startJob(jobId) {
    const job = jobById(jobId);
    if (!job) return;
    S.jobIndex = JOBS.indexOf(job);
    S.jobActive = true;
    S.stageIndex = 0;
    S.stageKills = 0;
    S.stageTimer = 0;
    enterStage();
    const contact = personById(job.contact);
    showBanner(`CH${job.no} — ${job.title}`, `${contact.name} · $${job.payout.toLocaleString()}`);
    showDialogue(contact.name, contact.role, contact.color, job.blurb, 7);
  }

  function stageObjective() {
    const st = currentStage();
    if (!st) return null;
    if (st.type === 'kill') return { x: st.x, z: st.z, label: `Take out the Dredgers (${S.stageKills}/${st.count})`, dist: 0 };
    if (st.type === 'escape') return { x: st.x, z: st.z, label: 'Lose the heat', dist: 0 };
    return { x: st.x, z: st.z, label: st.label, dist: 0 };
  }

  function enterStage() {
    const st = currentStage();
    if (!st) return;
    if (st.type === 'kill') {
      combat.spawnEnemies(st.x, st.z, st.count, S.jobIndex * 13 + S.stageIndex * 7 + 3);
    }
    if (st.type === 'steal') {
      // The target van is parked at the stage location.
      const van = traffic.spawnCar(st.x, st.z, 0, { id: 'gannet', name: 'GANNET VAN', kind: 'van', topSpeed: 34, accel: 11, color: 0x8a8f98 });
      van.parked = true; van.speed = 0; van.targetSpeed = 0;
      ctx.stealTarget = van;
    }
    if (st.line && st.speaker) {
      const p = personById(st.speaker);
      showDialogue(p.name, p.role, p.color, st.line, 6);
    }
    placeBeacon(st.x, st.z);
    S.objective = stageObjective();
  }

  function placeBeacon(x, z) {
    const b = city.dynamic.beacon;
    if (!b) return;
    b.visible = true;
    b.position.set(x, 0, z);
  }
  function hideBeacon() {
    const b = city.dynamic.beacon;
    if (b) b.visible = false;
  }

  function advanceStage() {
    const job = currentJob();
    S.stageIndex += 1;
    S.stageKills = 0;
    S.stageTimer = 0;
    if (S.stageIndex >= job.stages.length) {
      completeJob(job);
      return;
    }
    const next = currentStage();
    showToast(`Stage ${S.stageIndex + 1}/${job.stages.length}: ${next.label}`);
    enterStage();
  }

  function completeJob(job) {
    addMoney(job.payout, `Job complete: ${job.title}`);
    addRep(60);
    S.stats.jobsDone += 1;
    if (!S.jobsDone.includes(job.id)) S.jobsDone.push(job.id);
    S.jobActive = false;
    S.jobIndex = Math.min(JOBS.length - 1, S.jobIndex + 1);
    S.stageIndex = 0;
    S.objective = null;
    hideBeacon();
    hideDialogue();
    combat.clearEnemies();
    showBanner('JOB DONE', `${job.title} — $${job.payout.toLocaleString()} in the pocket`);
    // Recruits unlock with jobs.
    if (job.id === 'j2') crew.recruit('mara');
    if (job.id === 'j3') crew.recruit('ivo');
    if (job.id === 'j4') crew.recruit('sana');
    const next = JOBS[S.jobIndex];
    if (S.jobsDone.length >= JOBS.length) {
      setTimeout(() => showBanner('THE LAGOON IS YOURS', 'Every job done. Rook Calloway, Lagoon Legend.'), 2500);
    } else if (next && !S.jobsDone.includes(next.id)) {
      const contact = personById(next.contact);
      setTimeout(() => showToast(`${contact.name} has work — open the map (M) to start ${next.title}`), 2500);
    }
  }

  function update(dt, playerPos) {
    if (!S.jobActive) return;
    const st = currentStage();
    if (!st) return;
    S.stageTimer += dt;
    const dist = Math.hypot(st.x - playerPos.x, st.z - playerPos.z);
    S.objectiveDist = Math.round(dist);
    switch (st.type) {
      case 'goto':
      case 'drive':
      case 'deliver':
      case 'talk':
        if (dist < 10) advanceStage();
        break;
      case 'steal': {
        // Player is in a car at the target spot — the van is theirs.
        if (S.inCar && dist < 14) advanceStage();
        break;
      }
      case 'kill':
        if (S.stageKills >= st.count) advanceStage();
        break;
      case 'escape':
        if (S.wanted === 0) advanceStage();
        break;
      default:
        break;
    }
    S.objective = stageObjective();
    if (S.objective) S.objective.dist = S.objectiveDist;
  }

  function jobMarker(jobId) {
    const job = jobById(jobId);
    if (!job) return null;
    const first = job.stages[0];
    return { x: first.x, z: first.z, job };
  }

  function nextOpenJob() {
    return JOBS.find((j) => !S.jobsDone.includes(j.id)) || null;
  }

  function nearestAvailableJob(playerPos) {
    const job = nextOpenJob();
    if (!job) return null;
    const m = jobMarker(job.id);
    if (!m) return null;
    return { job, dist: Math.hypot(m.x - playerPos.x, m.z - playerPos.z) };
  }

  // v8d #8: MISSION FAILED + retry (leonida Runner: fail global =
  // wasted/busted, no checkpoints). The old bug: dying mid kill-stage
  // cleared the enemies (main.js death flow) but left the job active
  // with stageKills frozen — no enemies left to kill, the stage could
  // never finish (soft-lock). Now death during a job fails it
  // outright: the job resets to stage 0 and the player is offered a
  // retry after the cards. `fail` is transient (not saved): wait out
  // the WASTED/BUSTED card (3 s) → MISSION FAILED card (4 s) →
  // prompt (E retry / Esc quit). Retry restarts from stage 0.
  let fail = null;

  function failJob(now) {
    if (!S.jobActive) return false;
    const job = currentJob();
    S.jobActive = false;
    S.stageIndex = 0;
    S.stageKills = 0;
    S.stageTimer = 0;
    S.objective = null;
    hideBeacon();
    hideDialogue();
    fail = { jobId: job.id, phase: 'wait', until: now + 3 };
    return true;
  }

  function updateFail(now) {
    if (!fail) return;
    if (fail.phase === 'wait' && now >= fail.until) {
      const job = jobById(fail.jobId);
      showBanner('MISSION FAILED', `${job.title} — the job is blown.`, 4);
      fail.phase = 'card';
      fail.until = now + 4;
    } else if (fail.phase === 'card' && now >= fail.until) {
      fail.phase = 'prompt';
      showToast(`Press E to retry "${jobById(fail.jobId).title}" — Esc to walk away`, 8);
    }
  }

  function isPrompting() { return !!fail && fail.phase === 'prompt'; }

  function retryFail() {
    if (!isPrompting()) return;
    const id = fail.jobId;
    fail = null;
    startJob(id);
  }

  function quitFail() {
    if (!isPrompting()) return;
    fail = null;
    showToast('Job abandoned — the contact still has work when you are ready.');
  }

  function failState() { return fail ? { jobId: fail.jobId, phase: fail.phase } : null; }

  function currentJobId() { const j = currentJob(); return j ? j.id : null; }

  return { startJob, update, jobById, jobMarker, nearestAvailableJob, nextOpenJob,
    placeBeacon, hideBeacon, advanceStage, failJob, updateFail, isPrompting,
    retryFail, quitFail, failState, currentJobId,
    // Staging helper: re-enter the current stage after a shot sets stageIndex directly.
    enterStageForShot() { enterStage(); } };
}
