// =====================================================================
//  الشغل على خريطة شبين الحقيقية (نفس نظام الركاب/الكماين القديم، بس الأماكن جاية من البيانات الحقيقية):
//  - أماكن الركوب: على الأرصفة الحقيقية كل ~30م (عمرها ما تبقى على الأسفلت أو جوه تقاطع)
//  - خطوط الميكروباص: بين معالم مؤكدة من OSM، والمحطات اللي في النص بأسامي الشوارع الحقيقية اللي الخط بيعدي عليها
//  - أماكن المشاوير: المعالم المؤكدة + أطول الشوارع اللي ليها اسم حقيقي
//  - الكماين: على طرق رئيسية حقيقية
//  مفيش اسم متألف: الشارع اللي مالوش اسم في OSM مش بيتسمّى.
// =====================================================================
import { edgePoint, edgesNear } from './ShibinData.js';
import { SIDEWALK } from './ShibinWorld.js';

const MAIN = new Set(['primary', 'trunk', 'motorway', 'primary_link', 'trunk_link']);

export function attachJobs(world, findRoute) {
  const G = world.graph;
  const junctions = G.nodes.filter((n) => n.edges.length >= 3);
  // شبكة للتقاطعات (بُعد أقرب تقاطع)
  const JC = 40, jgrid = new Map();
  for (const n of junctions) { const k = `${Math.floor(n.x / JC)},${Math.floor(n.z / JC)}`; let a = jgrid.get(k); if (!a) jgrid.set(k, (a = [])); a.push(n); }
  const nearJ = (x, z) => {
    let d = 1e9;
    const cx = Math.floor(x / JC), cz = Math.floor(z / JC);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const n of jgrid.get(`${cx + i},${cz + j}`) || []) d = Math.min(d, Math.hypot(n.x - x, n.z - z));
    return d;
  };
  const onOtherRoad = (x, z, self) => {
    for (const e of edgesNear(G, x, z, 12)) {
      if (e === self) continue;
      for (let i = 0; i < e.pts.length - 1; i++) {
        const a = e.pts[i], b = e.pts[i + 1], ex = b.x - a.x, ez = b.z - a.z, l2 = ex * ex + ez * ez || 1e-9;
        const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / l2));
        if (Math.hypot(x - (a.x + ex * t), z - (a.z + ez * t)) < e.half + 0.4) return true;
      }
    }
    return false;
  };

  let cache = null;
  world.stopCandidates = () => {
    if (cache) return cache;
    const cands = [], grid = new Map();
    const q = {};
    // المدن الكبيرة (الجيزة ~39 ألف وصلة): مكان كل 30م على كل الشوارع كان ~17MB ذاكرة → المسافة بتكبر مع حجم الشبكة
    const STEP = Math.round(30 * Math.max(1, Math.sqrt(G.edges.length / 12000)));
    for (const e of G.edges) {
      if (e.closed || e.elevated || e.noAccess) continue;
      const sw = SIDEWALK[e.cls.replace('_link', '')] || 0;
      if (sw < 1 || e.half < 2.2 || e.length < 30) continue;
      for (let s = 15; s < e.length - 15; s += STEP) {
        edgePoint(e, s, q);
        const rx = -q.dz, rz = q.dx; // يمين اتجاه الوصلة
        for (const side of e.oneway ? [1] : [1, -1]) {
          const lat = e.half + Math.min(sw - 0.3, 0.9);
          const x = q.x + rx * side * lat, z = q.z + rz * side * lat;
          const mx = q.x + rx * side * (e.half - 1.15), mz = q.z + rz * side * (e.half - 1.15);
          if (onOtherRoad(x, z, e)) continue;
          const c = {
            name: e.name || '', street: e.name, kind: MAIN.has(e.cls) ? 'highway' : 'shibin', side, x, z, y: 0.15,
            nx: -rx * side, nz: -rz * side,
            ax: e.oneway ? q.dx : q.dx * side, az: e.oneway ? q.dz : q.dz * side,
            mx, mz, my: 0, nearX: nearJ(mx, mz), edge: e, s,
          };
          cands.push(c);
          const k = `${Math.floor(c.x / 60)},${Math.floor(c.z / 60)}`;
          let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(c);
        }
      }
    }
    cache = { cands, grid };
    return cache;
  };

  // ===== المعالم (أماكن من OSM) =====
  const LP = Object.fromEntries(world.landmarkPoints.map((l) => [l.id, l]));
  const anchor = (id) => { const l = LP[id]; return l ? { name: l.name, x: l.rx, z: l.rz } : null; };

  // ===== خطوط الميكروباص =====
  // مفيش مصدر موثوق (رسمي) لخطوط ميكروباص شبين الداخلية محطة بمحطة: كل الخطوط هنا "مسار مقترح من اللعبة"
  // بين أماكن حقيقية من OSM (verified: false). الأجرة 6.5ج تقريبية: رقم "السرفيس داخل مدينة شبين" اللي اتنشر
  // في الصحافة بعد تحريك الوقود (مارس 2026) — مش قرار رسمي اتأكدنا منه، فبتتعرض كتقريبي.
  const FARE = 6.5, FARE_NOTE = 'تقريبي — حسب المنشور في الصحافة (مارس 2026)';
  const LINE_DEFS = [
    { id: 1, name: 'خط المحطة — الجامعة', color: '#e8711a', from: 'station_shibin', to: 'menoufia_university' },
    { id: 2, name: 'خط المحطة — المحطة الجديدة', color: '#2f9e5a', from: 'station_shibin', to: 'station_shibin_new' },
    { id: 3, name: 'خط الاستاد — مستشفى موده', color: '#7c3aed', from: 'stadium', to: 'hospital_mawadda' },
    { id: 4, name: 'خط الجامعة — كلية التربية', color: '#0e7490', from: 'menoufia_university', to: 'faculty_education' },
    { id: 5, name: 'خط البريد — مستوصف العذراء', color: '#b45309', from: 'post_office', to: 'hospital_eldazra' },
  ].map((d) => ({ ...d, fare: FARE, fareNote: FARE_NOTE, verified: false, source: 'gameplay-approximation (endpoints: OSM landmarks)' }));
  const lines = [];
  // (الخرايط بقت صغيرة ~1.6 كم: خطوط شبين اللي طرفها برّه الخريطة بتتساب، وبيكمّل بخطوط بين معالم جوه الخريطة،
  //  ولو المعالم مش كفاية: بين شارعين رئيسيين بعاد عن بعض — عشان الميكروباص دايمًا يلاقي 3 خطوط على الأقل)
  const defs = [...(world.id === 'shibin' ? LINE_DEFS : []), ...autoLines(world)];
  const tryLine = (D) => {
    const a = D.a || anchor(D.from), b = D.b || anchor(D.to);
    if (!a || !b || lines.some((L) => (L.from === a.name && L.to === b.name) || (L.from === b.name && L.to === a.name))) return;
    const r = findRoute(a.x, a.z, b.x, b.z);
    if (!r || r.length < 450) return;
    // محطات في النص كل ~550م باسم الشارع الحقيقي اللي الخط ماشي فيه (لو ليه اسم)
    const stops = [{ name: a.name, x: a.x, z: a.z }];
    const used = new Set([a.name, b.name]);
    const STEP = Math.max(300, Math.min(550, r.length / 4));
    for (let s = STEP; s < r.length - 250; s += STEP) {
      let i = 0; while (i < r.pts.length - 1 && r.cum[i + 1] < s) i++;
      const p = r.pts[i];
      if (!p.name || used.has(p.name)) continue;
      used.add(p.name);
      stops.push({ name: p.name, x: p.x, z: p.z });
    }
    stops.push({ name: b.name, x: b.x, z: b.z });
    lines.push({ id: lines.length + 1, name: D.name, to: b.name, from: a.name, color: D.color || COLORS[lines.length % COLORS.length], fare: D.fare, fareNote: D.fareNote, verified: D.verified, source: D.source, stops });
  };
  for (const D of defs) { if (lines.length >= 5) break; tryLine(D); }
  if (lines.length < 3) for (const D of streetLines(world)) { if (lines.length >= 3) break; tryLine(D); }

  world.lines = lines.length ? lines : null;

  // ===== أماكن المشاوير =====
  const pois = [];
  for (const l of world.landmarkPoints) pois.push({ name: l.name, x: l.rx, z: l.rz, tuk: !MAIN.has(l.edge.cls) });
  const byName = new Map();
  for (const e of G.edges) {
    if (!e.name || e.closed || e.elevated) continue;
    const t = byName.get(e.name) || { len: 0, best: null };
    t.len += e.length;
    if (!t.best || e.length > t.best.length) t.best = e;
    byName.set(e.name, t);
  }
  const top = [...byName.entries()].filter(([, t]) => t.len > 250).sort((x, y) => y[1].len - x[1].len).slice(0, 45);
  for (const [name, t] of top) {
    const q = edgePoint(t.best, t.best.length / 2);
    pois.push({ name, x: q.x, z: q.z, tuk: !MAIN.has(t.best.cls) });
  }
  world.pois = pois;

  // ===== الكماين: على أطول طرق رئيسية/ثانوية حقيقية =====
  const spots = [];
  const majors = [...byName.entries()].filter(([, t]) => ['primary', 'secondary'].includes(t.best.cls) && t.best.length > 120)
    .sort((x, y) => y[1].len - x[1].len).slice(0, 3);
  for (const [name, t] of majors) {
    const e = t.best, q = edgePoint(e, e.length * 0.5);
    spots.push({ name: `كمين ${name}`, q: { x: q.x, z: q.z, y: q.y, dx: q.dx, dz: q.dz, rx: -q.dz, rz: q.dx, half: e.half } });
  }
  world.policeSpots = spots;
  return world;
}

// ===== خطوط المدن التانية: من المحطة/الموقف لأماكن حقيقية من OSM (مسار مقترح من اللعبة — verified: false) =====
// الأجرة 7ج تقريبية (السرفيس جوه المدن بعد زيادة 2026) — بتتعرض كتقريبي زي شبين.
const COLORS = ['#e8711a', '#2f9e5a', '#7c3aed', '#0e7490', '#b45309', '#be123c'];
const HUB = ['rail_station', 'bus_station'];
function autoLines(world) {
  const L = world.landmarkPoints.filter((l) => l.kind !== 'park');
  if (L.length < 2) return [];
  const hubs = L.filter((l) => HUB.includes(l.kind));
  const from = hubs.length ? hubs : [L[0]];
  const out = [], used = new Set();
  // كل خط: من محطة (بالدور) لأبعد معلم مختلف على بعد 1.2–3.2 كم بالشارع
  for (let k = 0; out.length < 5 && k < from.length * 6; k++) {
    const a = from[k % from.length];
    let best = null;
    for (const b of L) {
      if (b === a || used.has(b.id) || b.name === a.name) continue;
      const d = Math.hypot(b.rx - a.rx, b.rz - a.rz);
      if (d < 500 || d > 3000) continue;
      const sc = d + (HUB.includes(b.kind) ? -300 : 0) + (b.kind === a.kind ? 400 : 0);
      if (!best || sc > best.sc) best = { b, sc };
    }
    if (!best) continue;
    used.add(best.b.id);
    out.push({ id: out.length + 1, name: `خط ${short(a.name)} — ${short(best.b.name)}`, color: COLORS[out.length % COLORS.length], from: a.id, to: best.b.id,
      fare: 7, fareNote: 'تقريبي', verified: false, source: 'gameplay-approximation (endpoints: OSM landmarks)' });
  }
  return out;
}
// اسم قصير للافتة: لحد 18 حرف بس على حدود كلمة (كان بيقطع في نص الكلمة: "محطة قطار شبين الك")
const short = (s) => {
  if (s.length <= 18) return s;
  s = s.split(/[،,(]/)[0].trim();
  if (s.length <= 18) return s;
  const w = s.split(/\s+/); let o = '';
  for (const x of w) { if ((o ? o.length + 1 : 0) + x.length > 18) break; o = o ? `${o} ${x}` : x; }
  return o || s.slice(0, 18);
};

/** خطوط بين شوارع رئيسية (لما المعالم جوه الخريطة مش كفاية): أبعد نقطتين على شوارع ليها أسامي */
function streetLines(world) {
  const C = (world.stopCandidates?.().cands || []).filter((c) => c.name);
  const out = [], used = new Set();
  for (let k = 0; k < 4 && C.length > 1; k++) {
    let best = null;
    for (let i = 0; i < C.length; i += 3) for (let j = i + 1; j < C.length; j += 3) {
      const a = C[i], b = C[j]; if (a.name === b.name || used.has(a.name) || used.has(b.name)) continue;
      const d = Math.hypot(a.x - b.x, a.z - b.z); if (!best || d > best.d) best = { a, b, d };
    }
    if (!best || best.d < 500) break;
    used.add(best.a.name); used.add(best.b.name);
    out.push({ a: { name: best.a.name, x: best.a.x, z: best.a.z }, b: { name: best.b.name, x: best.b.x, z: best.b.z }, name: `خط ${short(best.a.name)} — ${short(best.b.name)}`, fare: 6, fareNote: 'تقريبي', verified: false, source: 'gameplay-approximation (endpoints: OSM street names)' });
  }
  return out;
}
