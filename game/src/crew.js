// KESTREL LAGOON — LIVE CREW ORDERS: the three recruitable crew members
// walk beside Rook, take orders (FOLLOW / HOLD / ATTACK / DISTRACT) and
// each run one signature ability: Mara brings a getaway car, Ivo kills the
// heli spotlight and drops a star, Sana marks every enemy on the minimap.
// Recruitment state lives in S.crew (survives save/load); orders too.
import { S, showToast, showBanner } from './state.js';
import { CREW, CREW_COOLDOWN } from './config.js';
import { buildPersonMesh } from './pedestrians.js';
import { resolveCircle } from './city.js';

const ORDER_LIST = ['FOLLOW', 'HOLD', 'ATTACK', 'DISTRACT'];

export function createCrew(scene, colliders, driving, police) {
  const members = CREW.map((def, i) => {
    const mesh = buildPersonMesh(def.color, def.skin, 1.02, { hair: def.hair, hairStyle: def.hairStyle });
    mesh.position.set(-200 + i * 3, 0, 144 + i * 2);
    mesh.visible = false;
    scene.add(mesh);
    return {
      def, mesh, index: i,
      x: -200 + i * 3, z: 144 + i * 2,
      heading: 0, walkPhase: 0,
      cooldownUntil: 0, marking: false,
    };
  });

  // Always read live state — S.crew is replaced on reset/load.
  const st = (m) => S.crew[m.index];
  const recruited = (m) => !!st(m).recruited;
  const orderOf = (m) => st(m).order || 'FOLLOW';

  function active() { return members.filter(recruited); }

  function cycleOrder() {
    const m = members[S.crewSelected];
    if (!recruited(m)) { showToast(`${m.def.name} is not recruited yet`); return; }
    const i = ORDER_LIST.indexOf(orderOf(m));
    st(m).order = ORDER_LIST[(i + 1) % ORDER_LIST.length];
    showToast(`${m.def.callsign}: ${st(m).order}`);
  }

  function ability() {
    const m = members[S.crewSelected];
    if (!recruited(m)) { showToast(`${m.def.name} is not recruited yet`); return; }
    const now = performance.now() / 1000;
    if (now < m.cooldownUntil) {
      showToast(`${m.def.callsign} ability recharging (${Math.ceil(m.cooldownUntil - now)}s)`);
      return;
    }
    m.cooldownUntil = now + (CREW_COOLDOWN[m.def.id] || 30);
    if (m.def.id === 'mara') {
      // Mara drives a getaway car to the player.
      driving.spawnPlayerCar('peregrine', S.playerX + 6, S.playerZ + 6, 0);
      showBanner('MARA — GETAWAY', 'WRENCH brought the Peregrine S. Go.');
      showToast('Mara delivered a Peregrine S');
    } else if (m.def.id === 'ivo') {
      police.blackout();
      if (S.wanted > 0) {
        police.dropStar(); // heat cools by one band with the star
        showToast(`Ivo killed the feed — wanted ${S.wanted}★`);
      } else showToast('Ivo killed the CCTV feed');
      showBanner('IVO — BLACKOUT', 'GHOSTLINE cut the cameras. The heli is blind.');
    } else if (m.def.id === 'sana') {
      m.marking = true;
      setTimeout(() => { m.marking = false; }, 20000);
      showBanner('SANA — EYES UP', 'FARSHOT is marking every hostile on your minimap.');
      showToast('Enemies marked for 20s');
    }
  }

  function update(dt, playerPos, playerInCar, enemies) {
    for (const m of members) {
      if (!recruited(m)) { m.mesh.visible = false; continue; }
      m.mesh.visible = !playerInCar;
      // Formation slot beside the player.
      const side = m.index === 0 ? -2.6 : m.index === 1 ? 2.6 : 0;
      const back = m.index === 2 ? 3.2 : 1.2;
      const slot = { x: playerPos.x + side, z: playerPos.z + back };
      let tx = slot.x, tz = slot.z, speed = 0;
      const distToPlayer = Math.hypot(m.x - playerPos.x, m.z - playerPos.z);
      const order = orderOf(m);
      if (order === 'FOLLOW') {
        if (distToPlayer > 4) speed = distToPlayer > 15 ? 9 : 6.5;
      } else if (order === 'HOLD') {
        speed = 0;
      } else if (order === 'ATTACK') {
        const target = enemies.find((e) => !e.dead);
        if (target) { tx = target.x; tz = target.z; speed = 7; }
      } else if (order === 'DISTRACT') {
        tx = playerPos.x + 20; tz = playerPos.z - 10;
        speed = distToPlayer > 20 ? 7 : 0;
      }
      if (speed > 0) {
        m.heading = Math.atan2(tx - m.x, tz - m.z);
        m.x += Math.sin(m.heading) * speed * dt;
        m.z += Math.cos(m.heading) * speed * dt;
        m.walkPhase += dt * 8;
      }
      const fixed = resolveCircle(colliders, m.x, m.z, 0.8);
      m.x = fixed.x; m.z = fixed.z;
      const u = m.mesh.userData;
      const swing = speed > 0 ? Math.sin(m.walkPhase) * 0.55 : 0;
      u.legL.rotation.x = swing; u.legR.rotation.x = -swing;
      u.armL.rotation.x = -swing; u.armR.rotation.x = swing;
      m.mesh.position.set(m.x, 0, m.z);
      m.mesh.rotation.y = m.heading;
      // ATTACK order: crew members shoot the nearest enemy.
      if (order === 'ATTACK') {
        const target = enemies.find((e) => !e.dead && Math.hypot(e.x - m.x, e.z - m.z) < 30);
        if (target && Math.random() < dt * 1.2) {
          target.hp -= 12;
          if (target.hp <= 0 && !target.dead) {
            target.dead = true;
            target.mesh.rotation.x = -Math.PI / 2;
            target.mesh.position.y = 0.4;
            S.stageKills += 1;
            S.stats.kills += 1;
            showToast(`${m.def.callsign} dropped a Dredger`);
          }
        }
      }
    }
  }

  function recruit(id) {
    const m = members.find((mm) => mm.def.id === id);
    if (!m || recruited(m)) return;
    st(m).recruited = true;
    m.mesh.visible = true;
    m.x = S.playerX + 2; m.z = S.playerZ + 2;
    showBanner(`${m.def.name.toUpperCase()} JOINS THE CREW`, `${m.def.callsign} — ${m.def.role}. ${m.def.abilityDesc}`);
  }

  function teleportBeside(x, z) {
    members.forEach((m, i) => {
      m.x = x + (i - 1) * 3;
      m.z = z + 3;
      m.mesh.position.set(m.x, 0, m.z);
    });
  }

  return { members, active, cycleOrder, ability, update, recruit, teleportBeside,
    recruited, orderOf, st };
}
