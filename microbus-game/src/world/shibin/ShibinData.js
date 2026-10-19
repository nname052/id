// =====================================================================
//  بيانات منطقة حقيقية (مثلًا شبين الكوم) جاية من tools/osm/build_region.py:
//  تحميل الملفات + تحويل شبكة الطرق لنفس شكل RoadGraph (عشان الـ GPS والشرطة والركاب يشتغلوا عليها من غير تغيير)
//  مفيش أي اسم شارع متألف: الاسم يا من OSM يا فاضي.
// =====================================================================

export const REGION_BASE = (id) => `${import.meta.env.BASE_URL}data/${id}/`;

const cache = new Map();
export async function loadJSON(url) {
  if (cache.has(url)) return cache.get(url);
  const p = fetch(url).then((r) => {
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return r.json();
  });
  cache.set(url, p);
  try { return await p; } catch (e) { cache.delete(url); throw e; }
}
export function dropCache(prefix) { for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cache.delete(k); }

// تكلفة الـ GPS: الطرق الكبيرة مفضلة شوية (زي سواقين التاكسي)، والخدمة/الغيطان أغلى
const COST = { motorway: 0.8, trunk: 0.82, primary: 0.85, secondary: 0.9, tertiary: 0.95, unclassified: 1.0, residential: 1.05, living_street: 1.3, service: 1.4, road: 1.05, track: 1.6 };
const FLAG = { gate: 1, bridge: 2, tunnel: 4, foot: 8, noAccess: 16 };

/**
 * graph.json → { nodes, edges, grid, CELL, key } بنفس شكل GRAPH بتاع RoadGraph.js
 * + حاجات زيادة للمرور: edge.cls / lanes / width / speed / heights / oneway / closed(gate)
 */
export function buildGraph(G) {
  const nodes = G.nodes.map(([x, z, f], id) => ({ id, x, z, outside: !!(f & 1), edges: [] }));
  const edges = [];
  for (let k = 0; k < G.edges.length; k++) {
    const [a, b, len, ci, ni, ow, lanes, width, speed, flags, flat, hs] = G.edges[k];
    if (flags & FLAG.foot) continue; // الـ GPS والعربيات: طرق العربيات بس
    const cls = G.classes[ci], name = ni >= 0 ? G.names[ni] : '';
    const pts = [];
    for (let i = 0; i < flat.length; i += 2) pts.push({ x: flat[i], z: flat[i + 1], y: hs ? hs[i >> 1] : 0, name });
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    const e = {
      id: edges.length, src: k, from: nodes[a], to: nodes[b], pts, cum, length: cum[cum.length - 1], name, line: 'osm',
      cls, lanes, width, half: width / 2, speed, oneway: !!ow, closed: !!(flags & FLAG.gate), bridge: !!(flags & FLAG.bridge),
      noAccess: !!(flags & FLAG.noAccess), tunnel: !!(flags & FLAG.tunnel), elevated: !!hs, osm: G.edge_osm?.[k],
    };
    e.cost = e.length * (COST[cls.replace('_link', '')] || 1.1) * (e.noAccess ? 3 : 1);
    edges.push(e);
    e.from.edges.push(e);
    if (e.to !== e.from) e.to.edges.push(e);
  }
  // شبكة بحث للإسقاط السريع (نفس شكل RoadGraph)
  const CELL = 40, grid = new Map();
  const key = (cx, cz) => `${cx},${cz}`;
  for (const e of edges) for (let i = 0; i < e.pts.length - 1; i++) {
    const a = e.pts[i], b = e.pts[i + 1];
    const cx0 = Math.floor(Math.min(a.x, b.x) / CELL), cx1 = Math.floor(Math.max(a.x, b.x) / CELL);
    const cz0 = Math.floor(Math.min(a.z, b.z) / CELL), cz1 = Math.floor(Math.max(a.z, b.z) / CELL);
    for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) { const kk = key(cx, cz); let arr = grid.get(kk); if (!arr) grid.set(kk, (arr = [])); arr.push(e, i); }
  }
  return { nodes, edges, grid, CELL, key, names: G.names };
}

/** نقطة على وصلة عند مسافة s (من from): { x, y, z, dx, dz (اتجاه from→to), i } */
export function edgePoint(e, s, out = {}) {
  const P = e.pts, C = e.cum, n = P.length;
  s = Math.max(0, Math.min(e.length, s));
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (C[m] <= s) lo = m; else hi = m; }
  const a = P[lo], b = P[hi], L = C[hi] - C[lo] || 1e-6, t = (s - C[lo]) / L;
  out.x = a.x + (b.x - a.x) * t; out.z = a.z + (b.z - a.z) * t; out.y = a.y + (b.y - a.y) * t;
  out.dx = (b.x - a.x) / L; out.dz = (b.z - a.z) / L; out.i = lo;
  return out;
}

/** كل الوصلات القريبة من نقطة (بشبكة البحث) */
export function edgesNear(graph, x, z, r, out = []) {
  out.length = 0;
  const { grid, CELL, key } = graph, seen = new Set();
  const c0 = Math.floor((x - r) / CELL), c1 = Math.floor((x + r) / CELL), d0 = Math.floor((z - r) / CELL), d1 = Math.floor((z + r) / CELL);
  for (let cx = c0; cx <= c1; cx++) for (let cz = d0; cz <= d1; cz++) {
    const arr = grid.get(key(cx, cz));
    if (!arr) continue;
    for (let k = 0; k < arr.length; k += 2) { const e = arr[k]; if (!seen.has(e)) { seen.add(e); out.push(e); } }
  }
  return out;
}
