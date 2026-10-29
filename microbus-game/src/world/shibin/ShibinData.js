// =====================================================================
//  بيانات منطقة حقيقية (مثلًا شبين الكوم) جاية من tools/osm/build_region.py:
//  تحميل الملفات + تحويل شبكة الطرق لنفس شكل RoadGraph (عشان الـ GPS والشرطة والركاب يشتغلوا عليها من غير تغيير)
//  مفيش أي اسم شارع متألف: الاسم يا من OSM يا فاضي.
// =====================================================================

export const REGION_BASE = (id) => `${import.meta.env.BASE_URL}data/${id}/`;

// ===== مدن مضغوطة (tools/osm/egypt/pack_city.py): نفس روابط data/<id>/… بس بتتقري من كام ملف gzip =====
// base.txt = الملفات اللي مش مربعات، p_<gi>_<gj>.txt = مربعات 7×7. الصفحة على Claude ليها حد لعدد الملفات.
const packed = new Map();   // base → { dir }
const raw = new Map();      // ملف → Promise<Uint8Array> (المضغوط بس: ~0.5م.ب للملف)
const decoded = new Map();  // ملف → Promise<object> — آخر ملفين بس (المفكوك = نصوص المربعات ~2.5م.ب)
export function usePacks(id) { packed.set(REGION_BASE(id), { dir: `${import.meta.env.BASE_URL}packs/${id}/` }); }
function fetchRaw(url) {
  if (!raw.has(url)) {
    // الملف = gzip متخزن base64 نص (.txt — الصفحة على Claude مابتقدّمش ملفات binary)
    const p = fetch(url).then((r) => { if (!r.ok) throw new Error(`${r.status} ${url}`); return r.text(); }).then((s) => {
      s = s.trim();
      if (s[0] === '{') return new TextEncoder().encode(s); // (نسخة مش مضغوطة)
      const bin = atob(s), u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      return u;
    });
    raw.set(url, p); p.catch(() => raw.delete(url));
  }
  return raw.get(url);
}
async function readPack(url, keep = false) {
  if (decoded.has(url)) { const p = decoded.get(url); decoded.delete(url); decoded.set(url, p); return p; } // (LRU)
  const p = fetchRaw(url).then(async (buf) => {
    // (لو السيرفر فك الضغط بنفسه: نقراه JSON على طول)
    if (buf[0] !== 0x1f || buf[1] !== 0x8b) return JSON.parse(new TextDecoder().decode(buf));
    const s = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(s).text());
  });
  decoded.set(url, p);
  p.catch(() => decoded.delete(url));
  if (!keep) for (const k of [...decoded.keys()].filter((k) => !k.endsWith('base.txt'))) if (decoded.size > 3) decoded.delete(k);
  return p;
}
async function fromPack(P, rel) {
  const m = /^\w+\/t_(-?\d+)_(-?\d+)\.json$/.exec(rel);
  // الفهرس (أنهي مربع في أنهي ملف) بيتخزن لوحده — الملف الكبير بيتشال من الذاكرة بعد البناء (releaseBase)
  let obj = null;
  if (!m || !P.index) { obj = await readPack(P.dir + 'base.txt', true); P.index = obj.pack; }
  if (m) {
    const { group, off } = P.index, pk = P.index.packs;
    const name = `p_${Math.floor((+m[1] + off) / group)}_${Math.floor((+m[2] + off) / group)}`;
    if (!pk.includes(name)) throw new Error(`404 ${rel}`);
    obj = await readPack(P.dir + name + '.txt');
  }
  if (!(rel in obj)) throw new Error(`404 ${rel}`);
  const v = obj[rel];
  return typeof v === 'string' ? JSON.parse(v) : v; // (المربعات متخزنة نص: بتتفك لما تتطلب بس)
}

/** بعد ما الخريطة تتبني: الملفات الكبيرة اللي اتقرت مرة (الشبكة 40 ألف وصلة في الجيزة ≈ 40م.ب في الذاكرة)
 *  بتتشال من الكاش — المربعات بتفضل بتتقري من الـ packs عادي (الفهرس متخزن لوحده) */
export function releaseBase() {
  for (const [b, P] of packed) { if (P.index) decoded.delete(P.dir + 'base.txt'); }
  for (const k of [...cache.keys()]) if (!/\/t_-?\d+_-?\d+\.json$/.test(k)) cache.delete(k);
}

const cache = new Map();
export async function loadJSON(url) {
  if (cache.has(url)) return cache.get(url);
  for (const [b, P] of packed) if (url.startsWith(b)) {
    const p = fromPack(P, url.slice(b.length));
    cache.set(url, p);
    try { return await p; } catch (e) { cache.delete(url); throw e; }
  }
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
  // الاتجاهين المتداخلين (الكوبري العلوي: خطين OSM بينهم 5-7م وكل واحد عرضه 8م): الحارة الجوانية للاتجاه ده
  // كانت لازقة في الحارة الجوانية للاتجاه العكسي (متر بينهم) = خبط وش في وش فوق الكوبري → الركاب يتخضوا وينزلوا.
  // بنحسب لكل وصلة اتجاه واحد عرضها الفعلي لحد نص المسافة للاتجاه التاني (laneLo..laneHi = إزاحة يمين السير)
  for (const e of edges) {
    e.laneLo = -e.half; e.laneHi = e.half;
    if (!e.oneway) continue;
    for (let i = 0; i < e.pts.length - 1; i++) {
      const a = e.pts[i], b = e.pts[i + 1], L = Math.hypot(b.x - a.x, b.z - a.z) || 1, dx = (b.x - a.x) / L, dz = (b.z - a.z) / L;
      const x = (a.x + b.x) / 2, z = (a.z + b.z) / 2, y = (a.y + b.y) / 2;
      for (let gx = -1; gx <= 1; gx++) for (let gz = -1; gz <= 1; gz++) {
      const arr = grid.get(key(Math.floor(x / CELL) + gx, Math.floor(z / CELL) + gz)) || [];
      for (let k = 0; k < arr.length; k += 2) {
        const o = arr[k]; if (o === e || !o.oneway) continue;
        const p = o.pts[arr[k + 1]], q = o.pts[arr[k + 1] + 1], ol = Math.hypot(q.x - p.x, q.z - p.z) || 1;
        if (((q.x - p.x) * dx + (q.z - p.z) * dz) / ol > -0.8) continue; // نفس الاتجاه/تقاطع
        const ex = q.x - p.x, ez = q.z - p.z, tt = Math.max(0, Math.min(1, ((x - p.x) * ex + (z - p.z) * ez) / (ol * ol)));
        const cx = p.x + ex * tt, cz = p.z + ez * tt, cy = p.y + (q.y - p.y) * tt;
        const d = Math.hypot(cx - x, cz - z);
        if (d > e.half + o.half + 0.6 || Math.abs(cy - y) > 1.5) continue;
        const side = (cx - x) * -dz + (cz - z) * dx; // + = ناحية الإزاحة الموجبة
        const room = Math.max(1.6, d / 2 - 0.25);
        if (side > 0) e.laneHi = Math.min(e.laneHi, room); else e.laneLo = Math.max(e.laneLo, -room);
      }
      }
    }
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
