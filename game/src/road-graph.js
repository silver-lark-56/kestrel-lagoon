// KESTREL LAGOON — the road graph: the 99 intersections of the road grid
// as a graph for police A* routing, plus a line-of-sight test against the
// building colliders. Pure functions, no three.js, no game state.
//
// A* structure follows NEONBAY world.js (MIT): g-costs in a Float64Array,
// predecessors in an Int32Array, an open list with a linear min-f scan
// (fine for 99 nodes), Euclidean heuristic, iteration cap. The graph
// itself is Kestrel's own grid (11 x-lines x 9 z-lines, 4-connected).
import { ROAD_XS, ROAD_ZS } from './city.js';

const NX = ROAD_XS.length; // 11
const NZ = ROAD_ZS.length; // 9
export const NODE_COUNT = NX * NZ; // 99

const idx = (ix, iz) => iz * NX + ix;

export function nodePos(i) {
  return { x: ROAD_XS[i % NX], z: ROAD_ZS[Math.floor(i / NX)] };
}

// The intersection nearest to a world position (on a grid, the nearest
// intersection is the nearest x-line crossed with the nearest z-line).
export function nearestNode(x, z) {
  let bix = 0, bd = Infinity;
  for (let i = 0; i < NX; i++) { const d = Math.abs(ROAD_XS[i] - x); if (d < bd) { bd = d; bix = i; } }
  let biz = 0; bd = Infinity;
  for (let i = 0; i < NZ; i++) { const d = Math.abs(ROAD_ZS[i] - z); if (d < bd) { bd = d; biz = i; } }
  return idx(bix, biz);
}

function heuristic(a, b) {
  const pa = nodePos(a), pb = nodePos(b);
  return Math.hypot(pa.x - pb.x, pa.z - pb.z);
}

// A* from node `from` to node `to`. Returns the node indices to visit,
// EXCLUDING the start and INCLUDING the goal (empty when already there
// or when no route exists — impossible on the full grid).
export function astar(from, to) {
  if (from === to) return [];
  const g = new Float64Array(NODE_COUNT).fill(Infinity);
  const prev = new Int32Array(NODE_COUNT).fill(-1);
  const closed = new Uint8Array(NODE_COUNT);
  g[from] = 0;
  const open = [from];
  let iter = 0;
  while (open.length > 0 && iter++ < 4000) {
    // Linear min-f scan (neonbay's approach — cheap at 99 nodes).
    let bi = 0, bf = Infinity;
    for (let i = 0; i < open.length; i++) {
      const f = g[open[i]] + heuristic(open[i], to);
      if (f < bf) { bf = f; bi = i; }
    }
    const cur = open.splice(bi, 1)[0];
    if (cur === to) break;
    closed[cur] = 1;
    const cx = cur % NX, cz = Math.floor(cur / NX);
    for (const [nx, nz] of [[cx + 1, cz], [cx - 1, cz], [cx, cz + 1], [cx, cz - 1]]) {
      if (nx < 0 || nx >= NX || nz < 0 || nz >= NZ) continue;
      const n = idx(nx, nz);
      if (closed[n]) continue;
      // Every grid segment is 76 m; the Euclidean cost keeps the
      // heuristic admissible if the grid ever stops being uniform.
      const ng = g[cur] + heuristic(cur, n);
      if (ng < g[n]) {
        g[n] = ng;
        prev[n] = cur;
        if (!open.includes(n)) open.push(n);
      }
    }
  }
  if (prev[to] === -1) return [];
  const path = [];
  for (let c = to; c !== from && c !== -1; c = prev[c]) path.unshift(c);
  return path;
}

// True when the straight segment from (x0, z0) to (x1, z1) clears every
// building AABB (expanded by 1 m, so a cop does not route through a
// wall's edge). Slab test per axis — exact, no sampling.
export function lineOfSight(colliders, x0, z0, x1, z1) {
  const dx = x1 - x0, dz = z1 - z0;
  for (const c of colliders) {
    const x0b = c.x0 - 1, x1b = c.x1 + 1, z0b = c.z0 - 1, z1b = c.z1 + 1;
    let tmin = 0, tmax = 1;
    if (Math.abs(dx) < 1e-9) {
      if (x0 < x0b || x0 > x1b) continue;
    } else {
      let t1 = (x0b - x0) / dx, t2 = (x1b - x0) / dx;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    if (Math.abs(dz) < 1e-9) {
      if (z0 < z0b || z0 > z1b) continue;
    } else {
      let t1 = (z0b - z0) / dz, t2 = (z1b - z0) / dz;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) continue;
    }
    return false; // the segment enters this building's box
  }
  return true;
}
