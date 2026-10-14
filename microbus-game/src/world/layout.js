// تخطيط الشارع: كل الأبعاد بالمتر. الشارع الرئيسي على محور Z.
// الحركة يمين الطريق (زي مصر): العربيات اللي رايحة ناحية -Z ماشية في x > 0

export const ROAD = {
  medianHalf: 0.7,          // الجزيرة الوسطى
  lanes: [2.45, 5.95],      // مراكز الحارات (لكل اتجاه)
  laneHalf: 1.75,
  parkLine: 7.7,            // بداية حارة الركن
  parkCenter: 8.85,
  curb: 10.0,               // حرف الرصيف
  sidewalkOuter: 14.5,      // واجهات العمارات
  sidewalkHeight: 0.18,
  zMin: -275,
  zMax: 175,
};

export const CROSSINGS = [
  { id: 'A', z: 0, half: 6.5, signal: true, xMin: -95, xMax: 95, sidewalk: 4.0 },
  { id: 'B', z: -165, half: 4.2, signal: false, xMin: -70, xMax: 70, sidewalk: 2.6, narrow: true }, // شارع شعبي ضيق
];

export const PLAYER_START = { x: ROAD.lanes[0], z: 150, yaw: 0 };

// مطبات صناعية عرضية
export const BUMPS = [
  { z: 95, half: 0.5, height: 0.085, xMin: 0.7, xMax: 10 },
  { z: 60, half: 0.5, height: 0.085, xMin: -10, xMax: -0.7 },
  { z: -60, half: 0.55, height: 0.09, xMin: -10, xMax: 10 },
  { z: -120, half: 0.45, height: 0.08, xMin: 0.7, xMax: 10 },
  { z: -215, half: 0.5, height: 0.085, xMin: -10, xMax: 10 },
];

// غطيان بلاعات (هبوط بسيط) وحفر
export const MANHOLES = [];
export const POTHOLES = [];
(function seedRoadDetails() {
  let s = 12345;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let z = ROAD.zMax - 15; z > ROAD.zMin + 15; z -= 22 + r() * 18) {
    const side = r() < 0.5 ? -1 : 1;
    const lane = ROAD.lanes[r() < 0.5 ? 0 : 1];
    MANHOLES.push({ x: side * (lane + (r() - 0.5) * 1.5), z, r: 0.36 });
  }
  for (let i = 0; i < 9; i++) {
    const z = ROAD.zMin + 20 + r() * (ROAD.zMax - ROAD.zMin - 40);
    if (CROSSINGS.some((c) => Math.abs(c.z - z) < c.half + 6)) continue;
    const side = r() < 0.5 ? -1 : 1;
    POTHOLES.push({ x: side * (1.6 + r() * 5.5), z, r: 0.28 + r() * 0.3, depth: 0.035 + r() * 0.03 });
  }
})();

/** ارتفاع سطح الطريق في نقطة (للفيزياء) */
export const MEDIAN_HEIGHT = 0.24;

/** الأرصفة والجزيرة: ارتفاعات حقيقية (العجل بيطلع عليها) بدل حيطان خفية */
function curbHeight(x, z) {
  const ax = Math.abs(x);
  const cross = CROSSINGS.find((c) => z > c.z - c.half - c.sidewalk && z < c.z + c.half + c.sidewalk);
  if (cross) {
    // رصيف الشارع العرضي (بعد واجهات الشارع الرئيسي)
    const inStreet = Math.abs(z - cross.z) < cross.half;
    if (ax > ROAD.sidewalkOuter + 0.4 && !inStreet) return ax < (x > 0 ? cross.xMax : -cross.xMin) + 4 ? ROAD.sidewalkHeight : 0;
    if (ax >= ROAD.curb && Math.abs(z - cross.z) >= cross.half && ax <= ROAD.sidewalkOuter + 0.4) {
      // ركن الرصيف عند التقاطع
      return ROAD.sidewalkHeight;
    }
    return 0;
  }
  if (ax >= ROAD.curb) return ROAD.sidewalkHeight;
  if (ax <= ROAD.medianHalf) {
    // الجزيرة بتقف قبل التقاطعات بـ 4.5م
    if (!CROSSINGS.some((c) => Math.abs(z - c.z) < c.half + 4.5) && z < ROAD.zMax && z > ROAD.zMin) return MEDIAN_HEIGHT;
  }
  return 0;
}

export function groundHeight(x, z) {
  let h = curbHeight(x, z);
  for (let i = 0; i < BUMPS.length; i++) {
    const b = BUMPS[i];
    const d = z - b.z;
    if (d > -b.half && d < b.half && x > b.xMin && x < b.xMax) {
      h += b.height * 0.5 * (1 + Math.cos((Math.PI * d) / b.half));
    }
  }
  for (let i = 0; i < MANHOLES.length; i++) {
    const m = MANHOLES[i];
    const dx = x - m.x, dz = z - m.z;
    if (dx * dx + dz * dz < m.r * m.r) h -= 0.012;
  }
  for (let i = 0; i < POTHOLES.length; i++) {
    const p = POTHOLES[i];
    const d2 = (x - p.x) ** 2 + (z - p.z) ** 2;
    if (d2 < p.r * p.r) h -= p.depth * (1 - d2 / (p.r * p.r));
  }
  // خشونة خفيفة جدًا في الأسفلت
  h += 0.0025 * Math.sin(x * 1.7 + z * 0.9) * Math.sin(z * 2.3 - x * 0.4);
  return h;
}

export function crossingAt(z, margin = 0) {
  return CROSSINGS.find((c) => Math.abs(z - c.z) < c.half + margin);
}

/** مقاطع الشارع الرئيسي بين التقاطعات [zStart, zEnd] (zStart > zEnd) */
export function mainSegments(margin = 0) {
  const cuts = [...CROSSINGS].sort((a, b) => b.z - a.z);
  const segs = [];
  let top = ROAD.zMax;
  for (const c of cuts) {
    segs.push([top, c.z + c.half + margin]);
    top = c.z - c.half - margin;
  }
  segs.push([top, ROAD.zMin]);
  return segs;
}

/** صناديق التصادم الثابتة: واجهات العمارات ونهايات الشوارع بس.
 *  الأرصفة والجزيرة مش حيطان — ليها ارتفاع في groundHeight والعجل بيطلع عليها. */
export function staticColliders() {
  const out = [];
  const box = (x0, x1, z0, z1, kind = 'building') => out.push({
    cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, hx: Math.abs(x1 - x0) / 2, hz: Math.abs(z1 - z0) / 2, angle: 0, restitution: 0.12, kind,
  });
  const face = ROAD.sidewalkOuter + 0.4;
  for (const [zs, ze] of mainSegments(0)) {
    // بلوكات العمارات بين التقاطعات (بتبدأ بعد الرصيف العرضي)
    const c1 = CROSSINGS.find((c) => Math.abs(c.z + c.half - ze) < 0.01);
    const c0 = CROSSINGS.find((c) => Math.abs(c.z - c.half - zs) < 0.01);
    const zEnd = c1 ? ze + c1.sidewalk : ze, zStart = c0 ? zs - c0.sidewalk : zs;
    for (const s of [-1, 1]) box(s * face, s * (face + 30), zEnd, zStart);
  }
  for (const c of CROSSINGS) {
    // نهايات الشوارع الجانبية مفتوحة على الطرق الفرعية
    // عمارات على جانبي الشارع العرضي (بعد الرصيف بتاعه)
    for (const s of [-1, 1]) {
      const z0 = c.z + s * (c.half + c.sidewalk), z1 = c.z + s * (c.half + c.sidewalk + 30);
      box(face + 30, c.xMax + 8, z0, z1);
      box(c.xMin - 8, -face - 30, z0, z1);
    }
  }
  return out;
}
