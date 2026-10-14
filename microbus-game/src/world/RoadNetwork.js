// شبكة الطرق الفرعية: طرق بتطلع من نهايات الشوارع الجانبية في وسط البلد ومن الطريق الدائري
// (الزراعي/القرية، الصحراوي، مخرج الطريق السريع، الميدان، الحي السكني) وبتتقابل في الأرض اللي في النص.
// الملف ده بيانات + فيزياء بس (من غير رسم): الرسم في RouteWorld._buildSideRoads.

import { sampleAt, nearestRoute, JUNCTIONS, setSideRoadHooks, terrainRaw } from './Route.js';

const HALF_MAIN = 10;
const STEP = 2;

// كل طريق: نقط تحكم. { J: s, side } = تقاطع على شكل T مع الطريق الدائري، { snap: 'R1' } = يقفل على طريق تاني،
// { city: [x, z] } = نهاية شارع جانبي في وسط البلد (الارتفاع 0)
export const ROAD_DEFS = [
  { id: 'R1', name: 'طريق الترعة', sign: 'القرية', half: 3.6, surface: 'asphalt', style: 'agri',
    pts: [{ city: [99, 0] }, [150, 2], [230, -8], [330, -22], [430, -35], { J: 1160, side: 1 }] },
  { id: 'R2', name: 'مدق الصحراوي', sign: 'طريق الترعة', half: 3.1, surface: 'dirt', style: 'desert',
    pts: [{ J: 1470, side: 1 }, [480, 240], [400, 170], [340, 90], [318, 20], { snap: 'R1' }] },
  { id: 'R3', name: 'مخرج الطريق السريع', sign: 'مخرج ↘', half: 3.6, surface: 'asphalt', style: 'highway',
    pts: [{ J: 2330, side: 1 }, [240, 540], [285, 440], [325, 330], [375, 225], { snap: 'R2' }] },
  { id: 'R4', name: 'الطريق الغربي', sign: 'وسط البلد', half: 3.6, surface: 'asphalt', style: 'highway',
    pts: [{ city: [-99, 0] }, [-150, 5], [-185, 90], [-180, 220], [-130, 320], { J: 2640, side: -1 }] },
  { id: 'R5', name: 'شارع الميدان', sign: 'وسط البلد', half: 3.4, surface: 'asphalt', style: 'city',
    pts: [{ city: [74, -165] }, [110, -175], [130, -280], [120, -400], [100, -490], { J: 335, side: 1 }] },
  { id: 'R6', name: 'حارة المقابر', sign: 'وسط البلد', half: 3.0, surface: 'asphalt', style: 'city',
    pts: [{ city: [-74, -165] }, [-115, -175], [-140, -270], [-110, -350], { J: 140, side: -1 }] },
];

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return [0, 1].map((k) => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3));
}

export const ROADS = [];
const byId = {};

function junctionPts(J, side) {
  const q = sampleAt(J);
  const at = (d) => [q.x + q.rx * d * side, q.z + q.rz * d * side];
  return { mouth: at(HALF_MAIN - 0.6), out: at(HALF_MAIN + 14), y: q.y };
}

function nearestOn(road, x, z) {
  let best = 0, bd = Infinity;
  road.samples.forEach((p, i) => { const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; best = i; } });
  return road.samples[best];
}

for (const def of ROAD_DEFS) {
  // 1) نقط التحكم الحقيقية + ارتفاعات الأطراف
  const ctrl = [];
  const ends = [];
  def.pts.forEach((p, idx) => {
    const first = idx === 0;
    if (Array.isArray(p)) { ctrl.push(p); return; }
    if (p.city) {
      // نهاية الشارع الجانبي: نكمّل على نفس الخط شوية عشان الدخول يبقى مستقيم
      const dir = Math.sign(p.city[0]);
      const a = p.city, b = [p.city[0] + dir * 24, p.city[1]];
      if (first) ctrl.push(a, b); else ctrl.push(b, a);
      ends.push({ first, y: 0, hold: 30 });
      return;
    }
    if (p.J !== undefined) {
      const j = junctionPts(p.J, p.side);
      if (first) ctrl.push(j.mouth, j.out); else ctrl.push(j.out, j.mouth);
      ends.push({ first, y: j.y, hold: 14, flare: true });
      JUNCTIONS.push({ s: p.J, side: p.side, half: def.half + 7, road: def.id });
      return;
    }
    if (p.snap) {
      const target = byId[p.snap];
      const prev = Array.isArray(def.pts[idx - 1]) ? def.pts[idx - 1] : ctrl[ctrl.length - 1];
      const t = nearestOn(target, prev[0], prev[1]);
      ctrl.push([t.x, t.z]);
      ends.push({ first, y: t.y, hold: 6, snap: target });
    }
  });
  // 2) منحنى ناعم + عينات كل 2م
  const P = [ctrl[0], ...ctrl, ctrl[ctrl.length - 1]];
  const raw = [];
  for (let i = 1; i < P.length - 2; i++) {
    const segLen = Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]);
    const n = Math.max(2, Math.ceil(segLen / 0.5));
    for (let k = 0; k < n; k++) raw.push(catmull(P[i - 1], P[i], P[i + 1], P[i + 2], k / n));
  }
  raw.push(ctrl[ctrl.length - 1]);
  const samples = [];
  let acc = 0, last = raw[0];
  samples.push({ x: last[0], z: last[1], s: 0 });
  for (let i = 1; i < raw.length; i++) {
    acc += Math.hypot(raw[i][0] - last[0], raw[i][1] - last[1]);
    last = raw[i];
    if (acc >= samples.length * STEP || i === raw.length - 1) samples.push({ x: last[0], z: last[1], s: acc });
  }
  const L = acc;
  samples.forEach((p, i) => {
    const a = samples[Math.max(0, i - 1)], b = samples[Math.min(samples.length - 1, i + 1)];
    let dx = b.x - a.x, dz = b.z - a.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    p.dx = dx; p.dz = dz; p.rx = -dz; p.rz = dx;
  });
  // 3) الارتفاع: الأرض تحت الخط (ناعمة، ومتنزلش في الترعة) وبعدين الأطراف بتلزق في الطريق اللي بتطلع منه
  const tY = samples.map((p) => Math.max(-0.45, terrainRaw(p.x, p.z)));
  const W = 12;
  samples.forEach((p, i) => {
    let sum = 0, n = 0;
    for (let k = -W; k <= W; k++) { const v = tY[i + k]; if (v !== undefined) { sum += v; n++; } }
    p.y = sum / n;
  });
  for (const e of ends) {
    const blend = 40;
    samples.forEach((p) => {
      const d = e.first ? p.s : L - p.s;
      if (d <= e.hold) p.y = e.y;
      else if (d < e.hold + blend) { const t = (d - e.hold) / blend, k = t * t * (3 - 2 * t); p.y = e.y + (p.y - e.y) * k; }
    });
  }
  // بوق التقاطع: الطريق بيتوسع عند الدخول عشان اللفة تبقى سهلة
  samples.forEach((p) => {
    p.half = def.half;
    for (const e of ends) {
      if (!e.flare) continue;
      const d = e.first ? p.s : L - p.s;
      if (d < 16) p.half = def.half + 5.5 * (1 - d / 16) ** 2;
    }
  });
  const road = { ...def, samples, length: L, ends };
  ROADS.push(road);
  byId[def.id] = road;
}

// ===== شبكة بحث =====
const CELL = 16;
const grid = new Map();
const key = (cx, cz) => (cx * 73856093) ^ (cz * 19349663);
for (const road of ROADS) {
  road.samples.forEach((p, i) => {
    for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
      const k = key(Math.floor(p.x / CELL) + ox, Math.floor(p.z / CELL) + oz);
      let arr = grid.get(k);
      if (!arr) grid.set(k, (arr = []));
      arr.push(road, i);
    }
  });
}

const _r = { road: null, i: 0, d: 0, dist: 0, y: 0, half: 0, s: 0 };
/** أقرب طريق فرعي (لحد ~16م) أو null */
export function nearestSide(x, z, out = _r) {
  const arr = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
  if (!arr) return null;
  let bd = Infinity, br = null, bi = 0;
  for (let k = 0; k < arr.length; k += 2) {
    const p = arr[k].samples[arr[k + 1]];
    const d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d < bd) { bd = d; br = arr[k]; bi = arr[k + 1]; }
  }
  if (!br) return null;
  const S = br.samples, p = S[bi];
  // إسقاط على القطعة عشان الارتفاع يبقى ناعم
  const along = (x - p.x) * p.dx + (z - p.z) * p.dz;
  const j = Math.max(0, Math.min(S.length - 1, along >= 0 ? bi + 1 : bi - 1));
  const q = S[j];
  const seg = Math.abs(q.s - p.s) || 1;
  const t = Math.min(1, Math.abs(along) / seg);
  out.road = br; out.i = bi; out.s = p.s + along;
  out.d = (x - p.x) * p.rx + (z - p.z) * p.rz;
  out.dist = Math.abs(out.d);
  out.y = p.y + (q.y - p.y) * t;
  out.half = p.half + (q.half - p.half) * t;
  return out;
}

/** سطح الطريق الفرعي للفيزياء (أو null لو برا الطريق) */
export function sideSurface(x, z) {
  const n = nearestSide(x, z);
  if (!n || n.dist > n.half + 0.35) return null;
  const rough = n.road.surface === 'dirt' ? 0.02 : 0.004;
  return n.y + 0.03 + rough * Math.sin(x * 1.3 + z * 0.7) * Math.sin(z * 1.9 - x * 0.5);
}

/** اسم الطريق الفرعي اللي إنت عليه */
export function sideRoadAt(x, z) {
  const n = nearestSide(x, z);
  return n && n.dist < n.half + 0.5 ? n.road : null;
}

/** نقطة على طريق فرعي (للمواقف): frac من 0 لـ 1 */
export function roadPointAt(id, frac) {
  const r = byId[id];
  const p = r.samples[Math.round(frac * (r.samples.length - 1))];
  return { x: p.x, z: p.z, y: p.y, dx: p.dx, dz: p.dz, rx: p.rx, rz: p.rz, half: r.half };
}

// الأرض جنب الطرق الفرعية بتنزل لمستوى الطريق (للرسم والفيزياء)
setSideRoadHooks({
  blend(x, z, h) {
    const n = nearestSide(x, z);
    if (!n) return h;
    const inner = n.half + 0.6, outer = n.half + 7;
    const road = n.y - 0.04;
    if (n.dist <= inner) return road; // تحت الطريق بالظبط (فوق الترعة = ردم/برابخ)
    if (n.dist >= outer) return h;
    const t = (n.dist - inner) / (outer - inner), k = t * t * (3 - 2 * t);
    return road + (h - road) * k;
  },
});

export { nearestRoute };
