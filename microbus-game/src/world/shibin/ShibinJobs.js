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
    for (const e of G.edges) {
      if (e.closed || e.elevated || e.noAccess) continue;
      const sw = SIDEWALK[e.cls.replace('_link', '')] || 0;
      if (sw < 1 || e.half < 2.2 || e.length < 30) continue;
      for (let s = 15; s < e.length - 15; s += 30) {
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
  for (const D of LINE_DEFS) {
    const a = anchor(D.from), b = anchor(D.to);
    if (!a || !b) continue;
    const r = findRoute(a.x, a.z, b.x, b.z);
    if (!r || r.length < 600) continue;
    // محطات في النص كل ~550م باسم الشارع الحقيقي اللي الخط ماشي فيه (لو ليه اسم)
    const stops = [{ name: a.name, x: a.x, z: a.z }];
    const used = new Set([a.name, b.name]);
    for (let s = 550; s < r.length - 350; s += 550) {
      let i = 0; while (i < r.pts.length - 1 && r.cum[i + 1] < s) i++;
      const p = r.pts[i];
      if (!p.name || used.has(p.name)) continue;
      used.add(p.name);
      stops.push({ name: p.name, x: p.x, z: p.z });
    }
    stops.push({ name: b.name, x: b.x, z: b.z });
    lines.push({ id: D.id, name: D.name, to: b.name, from: a.name, color: D.color, fare: D.fare, fareNote: D.fareNote, verified: D.verified, source: D.source, stops });
  }
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
