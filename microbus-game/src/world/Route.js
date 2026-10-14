// =====================================================================
//  الطريق الدائري الكبير: بيبدأ من آخر شارع المدينة (جنوب) ويلف ويرجع لأوله (شمال)
//  مناطق: سكني ← ميدان ← كوبري على النيل ← طريق زراعي جنب ترعة ← قرية ← صحراوي ← جبلي ونفق ← طريق سريع ← المدينة
//  ملف رياضيات بس (من غير Three.js) عشان الفيزياء تستخدمه.
// =====================================================================

const CTRL = [
  // x, y(ارتفاع), z, zone
  [0, 0, -275, 'residential'],
  [0, 0, -340, 'residential'],
  [0, 0, -420, 'residential'],
  [18, 0, -500, 'residential'],
  [75, 0, -568, 'roundabout'],
  [150, 0, -605, 'roundabout'],
  [228, 0, -585, 'roundabout'],
  [278, 0, -530, 'bridge'],
  [318, 3.5, -488, 'bridge'],
  [352, 7, -455, 'bridge'],
  [388, 3.5, -421, 'bridge'],
  [428, 0, -386, 'agri'],
  [475, 0, -320, 'agri'],
  [500, 0, -235, 'agri'],
  [486, 0, -145, 'agri'],
  [510, 0, -55, 'village'],
  [532, 0, 30, 'village'],
  [530, 0, 110, 'desert'],
  [552, 0, 210, 'desert'],
  [592, 0, 320, 'desert'],
  [612, 2, 430, 'mountain'],
  [598, 7, 520, 'mountain'],
  [560, 12, 585, 'mountain'],
  [575, 16, 660, 'mountain'],
  [530, 19, 720, 'tunnel'],
  [460, 20, 745, 'tunnel'],
  [385, 16, 742, 'highway'],
  [300, 9, 705, 'highway'],
  [205, 3, 650, 'highway'],
  [110, 0, 565, 'highway'],
  [35, 0, 455, 'highway'],
  [2, 0, 345, 'highway'],
  [0, 0, 250, 'highway'],
  [0, 0, 175, 'highway'],
];

export const ZONE_LABEL = {
  city: 'وسط البلد', residential: 'حي سكني', roundabout: 'الميدان', bridge: 'كوبري النيل', agri: 'الطريق الزراعي',
  village: 'القرية', desert: 'الطريق الصحراوي', mountain: 'الطريق الجبلي', tunnel: 'النفق', highway: 'الطريق السريع',
};

// ====== Catmull-Rom (centripetal-ish uniform) ======
function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

const STEP = 2; // متر بين كل عينة

export const ROUTE = (() => {
  const pts = [];
  const n = CTRL.length;
  // أول وآخر نقطة: امتداد على نفس الخط (عشان الاتجاه يبقى -Z زي شارع المدينة)
  const P = (i) => {
    if (i < 0) return [0, 0, -275 + 60, 'residential'];
    if (i >= n) return [0, 0, 175 - 60, 'highway'];
    return CTRL[i];
  };
  for (let i = 0; i < n - 1; i++) {
    const a = P(i - 1), b = P(i), c = P(i + 1), d = P(i + 2);
    const segLen = Math.hypot(c[0] - b[0], c[2] - b[2]);
    const m = Math.max(4, Math.ceil(segLen / 0.5));
    for (let k = 0; k < m; k++) {
      const t = k / m;
      pts.push({ x: catmull(a[0], b[0], c[0], d[0], t), y: catmull(a[1], b[1], c[1], d[1], t), z: catmull(a[2], b[2], c[2], d[2], t), zone: b[3], ctrl: i + t });
    }
  }
  pts.push({ x: CTRL[n - 1][0], y: CTRL[n - 1][1], z: CTRL[n - 1][2], zone: CTRL[n - 2][3], ctrl: n - 1 });
  // إعادة تقسيم بمسافات ثابتة
  const dense = [{ ...pts[0], s: 0 }];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    acc += d;
    dense.push({ ...pts[i], s: acc });
  }
  const total = acc;
  const S = [];
  let j = 0;
  for (let s = 0; s <= total; s += STEP) {
    while (j < dense.length - 2 && dense[j + 1].s < s) j++;
    const a = dense[j], b = dense[j + 1];
    const t = (s - a.s) / Math.max(1e-6, b.s - a.s);
    S.push({ s, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, zone: a.zone, ctrl: a.ctrl + (b.ctrl - a.ctrl) * t });
  }
  // اتجاه + يمين + انحناء
  for (let i = 0; i < S.length; i++) {
    const a = S[Math.max(0, i - 1)], b = S[Math.min(S.length - 1, i + 1)];
    let dx = b.x - a.x, dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    S[i].dx = dx; S[i].dz = dz;
    S[i].rx = -dz; S[i].rz = dx; // يمين اتجاه السير
    S[i].grade = (b.y - a.y) / Math.max(1e-6, Math.hypot(b.x - a.x, b.z - a.z));
  }
  for (let i = 0; i < S.length; i++) {
    const a = S[Math.max(0, i - 3)], b = S[Math.min(S.length - 1, i + 3)];
    const da = Math.atan2(a.dx, a.dz), db = Math.atan2(b.dx, b.dz);
    let dd = db - da; dd = Math.atan2(Math.sin(dd), Math.cos(dd));
    S[i].curv = dd / Math.max(1, b.s - a.s); // 1/R (موجب = شمال)
  }
  // مناطق خاصة بمسافات s
  const zoneRanges = {};
  for (const p of S) { const r = (zoneRanges[p.zone] ||= [p.s, p.s]); r[1] = p.s; }
  return { samples: S, length: total, zones: zoneRanges };
})();

// ====== شبكة بحث سريعة عن أقرب نقطة ======
const CELL = 24;
const grid = new Map();
const key = (cx, cz) => cx * 73856093 ^ cz * 19349663;
for (let i = 0; i < ROUTE.samples.length; i++) {
  const p = ROUTE.samples[i];
  for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
    const k = key(Math.floor(p.x / CELL) + ox, Math.floor(p.z / CELL) + oz);
    let arr = grid.get(k);
    if (!arr) grid.set(k, (arr = []));
    arr.push(i);
  }
}

/** أقرب نقطة على الطريق: { i, s, d (المسافة الجانبية بإشارة، موجب = يمين)، y، zone } أو null لو بعيد */
const _res = { i: 0, s: 0, d: 0, y: 0, zone: '', dist: 0 };
export function nearestRoute(x, z, out = _res) {
  const arr = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
  if (!arr) return null;
  let best = -1, bd = Infinity;
  for (const i of arr) {
    const p = ROUTE.samples[i];
    const d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  const S = ROUTE.samples;
  const p = S[best];
  // إسقاط على القطعة المجاورة
  let s = p.s + ((x - p.x) * p.dx + (z - p.z) * p.dz);
  s = Math.max(0, Math.min(ROUTE.length, s));
  const q = sampleAt(s);
  out.i = best; out.s = s; out.d = (x - q.x) * q.rx + (z - q.z) * q.rz; out.y = q.y; out.zone = q.zone; out.dist = Math.abs(out.d);
  return out;
}

const _q = { x: 0, y: 0, z: 0, dx: 0, dz: 1, rx: 1, rz: 0, zone: '', curv: 0, grade: 0 };
/** نقطة على الطريق عند مسافة s (استيفاء) */
export function sampleAt(s, out = _q) {
  const S = ROUTE.samples;
  const f = Math.max(0, Math.min(S.length - 1.001, s / STEP));
  const i = Math.floor(f), t = f - i;
  const a = S[i], b = S[i + 1];
  out.x = a.x + (b.x - a.x) * t; out.y = a.y + (b.y - a.y) * t; out.z = a.z + (b.z - a.z) * t;
  out.dx = a.dx + (b.dx - a.dx) * t; out.dz = a.dz + (b.dz - a.dz) * t;
  const l = Math.hypot(out.dx, out.dz) || 1; out.dx /= l; out.dz /= l;
  out.rx = -out.dz; out.rz = out.dx;
  out.zone = a.zone; out.curv = a.curv; out.grade = a.grade;
  return out;
}

export function zoneRange(z) { return ROUTE.zones[z]; }

// ====== ضوضاء للتضاريس ======
function hash(ix, iz) { let h = ix * 374761393 + iz * 668265263; h = (h ^ (h >> 13)) * 1274126177; return ((h ^ (h >> 16)) >>> 0) / 4294967296; }
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return (a + (b - a) * sx) * (1 - sz) + (c + (d - c) * sx) * sz;
}
export function fbm(x, z, oct = 4) {
  let v = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { v += a * vnoise(x * f, z * f); f *= 2.03; a *= 0.5; }
  return v;
}

// النيل: خط عرضي تحت الكوبري
const BRIDGE_MID = CTRL[9];
const RIVER = (() => {
  const a = CTRL[8], b = CTRL[10];
  let dx = b[0] - a[0], dz = b[2] - a[2];
  const l = Math.hypot(dx, dz); dx /= l; dz /= l;
  return { cx: BRIDGE_MID[0], cz: BRIDGE_MID[2], nx: dx, nz: dz, half: 38 }; // n = عمودي على مجرى النهر
})();
export { RIVER };
export function riverDist(x, z) { return Math.abs((x - RIVER.cx) * RIVER.nx + (z - RIVER.cz) * RIVER.nz); }

// الترعة: جنب الطريق الزراعي (يمين) على بعد 24م
export const CANAL_OFFSET = 24;

/** نوع الأرض حوالين المكان */
function baseTerrain(x, z, zone, roadY = 0) {
  const n = fbm(x * 0.012, z * 0.012);
  switch (zone) {
    case 'desert': return (fbm(x * 0.008 + 10, z * 0.02) - 0.4) * 9 + fbm(x * 0.05, z * 0.05) * 1.5;
    case 'mountain': return roadY + 4 + n * 30 + fbm(x * 0.04, z * 0.04) * 8;
    case 'tunnel': return roadY + 15 + n * 14;
    case 'highway': return (n - 0.5) * 6;
    case 'agri': case 'village': return (n - 0.5) * 0.8 - 0.2;
    default: return (n - 0.5) * 1.5;
  }
}

// ===== تقاطعات الطرق الفرعية (بتتملى من RoadNetwork) =====
export const JUNCTIONS = [];
/** فيه تقاطع طريق فرعي هنا؟ (عشان نسيب فتحة في الأرصفة/الجاردريل/العمارات) */
export function nearJunction(s, side, margin = 0) {
  for (const j of JUNCTIONS) if ((side === 0 || j.side === side) && Math.abs(j.s - s) < j.half + margin) return true;
  return false;
}
let hooks = { blend: (x, z, h) => h };
export function setSideRoadHooks(h) { hooks = h; }

/** ارتفاع الأرض (التضاريس) — نفس الدالة للرسم والفيزياء (ومعاها الطرق الفرعية) */
export function terrainHeight(x, z) { return hooks.blend(x, z, terrainRaw(x, z)); }

/** التضاريس من غير الطرق الفرعية */
export function terrainRaw(x, z) {
  const r = nearestRoute(x, z);
  if (!r) return -0.5;
  const ad = r.dist;
  let base = baseTerrain(x, z, r.zone, r.y);
  // النيل
  const rd = riverDist(x, z);
  if (rd < RIVER.half + 25) {
    const k = Math.min(1, Math.max(0, (RIVER.half + 25 - rd) / 25));
    base = base * (1 - k) + -4 * k;
  }
  // الترعة
  if (r.zone === 'agri' || r.zone === 'village') {
    const cd = Math.abs(r.d - CANAL_OFFSET);
    if (cd < 6) base = Math.min(base, -1.8 + (cd / 6) ** 2 * 1.8);
  }
  // جنب الطريق: الأرض بتنزل لمستوى الطريق (أوسع للمناطق المفتوحة، ضيق جدًا في الجبل = جدران صخر)
  const inner = 10.5, outer = r.zone === 'mountain' ? 16 : r.zone === 'tunnel' ? 13 : 34;
  let road = r.y - 0.25;
  if (r.zone === 'bridge') {
    // تحت الكوبري: الأرض متبقاش لازقة في الطريق
    const k = Math.min(1, r.y / 3.5);
    road = road * (1 - k) + Math.min(road, base) * k;
  }
  if (ad <= inner) return road;
  if (ad >= outer) return base;
  const t = (ad - inner) / (outer - inner);
  const sm = t * t * (3 - 2 * t);
  return road + (base - road) * sm;
}

// مطبات القرية
export const ROUTE_BUMPS = [];
(() => {
  const v = ROUTE.zones.village;
  if (v) for (const s of [v[0] + 40, v[0] + 120, v[1] - 30]) ROUTE_BUMPS.push({ s, half: 0.5, height: 0.08 });
  const r = ROUTE.zones.residential;
  if (r) ROUTE_BUMPS.push({ s: r[0] + 160, half: 0.5, height: 0.085 });
})();

/** ارتفاع سطح الطريق (للفيزياء) + المطبات + خشونة حسب نوع الطريق */
export const URBAN_ZONES = new Set(['residential', 'roundabout']);
export const SIDEWALK_H = 0.18, MEDIAN_H = 0.24;

export function routeSurface(x, z) {
  const r = nearestRoute(x, z);
  if (!r) return { h: terrainHeight(x, z), onRoad: false, rough: 1 };
  const urban = URBAN_ZONES.has(r.zone);
  // المناطق السكنية: رصيف مرفوع (10م → 15م) — بيتطلع عليه بالعجل، مش حيطة (ماعدا مدخل طريق فرعي)
  if (urban && r.dist >= 10 && r.dist <= 15.4 && !nearJunction(r.s, Math.sign(r.d))) return { h: r.y + SIDEWALK_H, onRoad: false, rough: 0, zone: r.zone, curb: true };
  if (r.dist > 11.5) return { h: terrainHeight(x, z), onRoad: false, rough: 1 };
  let h = r.y;
  // الجزيرة الوسطى بالزرع (ماعدا فتحات الدوران)
  if (urban && r.dist < 0.7 && !inUturn(r.s)) return { h: h + MEDIAN_H, onRoad: false, rough: 0, zone: r.zone, curb: true };
  for (const b of ROUTE_BUMPS) {
    const d = r.s - b.s;
    if (d > -b.half && d < b.half) h += b.height * 0.5 * (1 + Math.cos((Math.PI * d) / b.half));
  }
  // طرق مش مثالية: خشونة أكتر في الزراعي والقرية
  const rough = r.zone === 'village' || r.zone === 'agri' ? 0.008 : r.zone === 'bridge' ? 0.003 : 0.004;
  h += rough * Math.sin(x * 1.3 + z * 0.7) * Math.sin(z * 1.9 - x * 0.5);
  // فواصل تمدد على الكوبري
  if (r.zone === 'bridge' && r.y > 2 && (r.s % 30) < 0.25) h -= 0.012;
  return { h, onRoad: true, rough, zone: r.zone };
}

// فتحات الدوران للخلف (U-Turn) في الجزيرة الوسطى
export const UTURNS = [];
(() => {
  const a = ROUTE.zones.agri, h = ROUTE.zones.highway, d = ROUTE.zones.desert;
  if (a) UTURNS.push({ s0: a[0] + 160, s1: a[0] + 188 });
  if (d) UTURNS.push({ s0: d[0] + 150, s1: d[0] + 178 });
  if (h) UTURNS.push({ s0: h[1] - 210, s1: h[1] - 182 });
})();
export function inUturn(s) { return UTURNS.some((u) => s > u.s0 && s < u.s1); }
