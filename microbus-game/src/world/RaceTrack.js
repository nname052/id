// =====================================================================
//  حلبة السباق: في الأرض المفتوحة غرب البلد (طريق الحلبة طالع من الطريق الغربي).
//  حلبة مقفولة ~1.2 كم (مش طويلة أوي ولا قصيرة): مستقيم طويل للسرعة + منحنيات واسعة + شيكان،
//  عرض 13م، حواف حمرا وبيضا (Kerbs)، حواجز كاوتش/خرسانة على الجناب (جسم حقيقي)، خط البداية/النهاية
//  ببوابة وإشارة بداية، ومدرجات فيها ناس. الأرض مستوية (-0.5) فالفيزياء مش محتاجة حاجة خاصة.
// =====================================================================
import * as THREE from 'three';
import { GeoBuilder } from '../render/GeoBuilder.js';
import { canvas, tex, fitFont } from '../render/textures.js';
import { humanVariants, humanStaticMaterial } from './Humans.js';

export const RACE_Y = -0.5;
const HALF = 6.5;               // نص عرض الأسفلت
const WALL = HALF + 4.5;        // مكان الحاجز من النص

// نقط التحكم (مقفولة) — الاتجاه: على المستقيم الشرقي ناحية +z
const CTRL = [
  [-262, -30], [-262, 60], [-268, 130], [-310, 185], [-390, 200], [-470, 185],
  [-535, 135], [-560, 60], [-540, -10], [-480, -45], [-430, -25], [-400, -60], [-345, -80], [-290, -70],
];

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

export const RACE = (() => {
  const n = CTRL.length, raw = [];
  for (let i = 0; i < n; i++) {
    const a = CTRL[(i - 1 + n) % n], b = CTRL[i], c = CTRL[(i + 1) % n], d = CTRL[(i + 2) % n];
    const m = Math.ceil(Math.hypot(c[0] - b[0], c[1] - b[1]) / 0.5);
    for (let k = 0; k < m; k++) { const t = k / m; raw.push([catmull(a[0], b[0], c[0], d[0], t), catmull(a[1], b[1], c[1], d[1], t)]); }
  }
  // إعادة تقسيم كل 2م
  const cum = [0];
  for (let i = 1; i <= raw.length; i++) { const p = raw[i % raw.length], q = raw[i - 1]; cum.push(cum[i - 1] + Math.hypot(p[0] - q[0], p[1] - q[1])); }
  const length = cum[cum.length - 1], S = [];
  let j = 0;
  for (let s = 0; s < length - 0.5; s += 2) {
    while (cum[j + 1] < s) j++;
    const a = raw[j], b = raw[(j + 1) % raw.length], t = (s - cum[j]) / ((cum[j + 1] - cum[j]) || 1);
    S.push({ s, x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t });
  }
  const N = S.length;
  for (let i = 0; i < N; i++) {
    const a = S[(i - 1 + N) % N], b = S[(i + 1) % N];
    let dx = b.x - a.x, dz = b.z - a.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    Object.assign(S[i], { dx, dz, rx: -dz, rz: dx });
  }
  for (let i = 0; i < N; i++) {
    const a = S[(i - 4 + N) % N], b = S[(i + 4) % N];
    let d = Math.atan2(b.dx, b.dz) - Math.atan2(a.dx, a.dz); d = Math.atan2(Math.sin(d), Math.cos(d));
    S[i].curv = d / 16;
  }
  // خط البداية: على المستقيم الشرقي عند z≈40
  let start = 0, bd = Infinity;
  for (let i = 0; i < N; i++) { const d = Math.abs(S[i].x + 262) + Math.abs(S[i].z - 40); if (d < bd) { bd = d; start = i; } }
  return { samples: S, length: N * 2, half: HALF, start };
})();

/** أقرب نقطة على الحلبة: { i, s (من خط البداية), d (جانبي) } أو null لو بعيد */
const _cell = 30, _grid = new Map();
const gkey = (x, z) => `${Math.floor(x / _cell)},${Math.floor(z / _cell)}`;
RACE.samples.forEach((p, i) => { for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) { const k = `${Math.floor(p.x / _cell) + ox},${Math.floor(p.z / _cell) + oz}`; (_grid.get(k) || _grid.set(k, []).get(k)).push(i); } });
const _pr = { i: 0, s: 0, d: 0 };
export function raceProject(x, z, out = _pr) {
  const arr = _grid.get(gkey(x, z));
  if (!arr) return null;
  let bi = -1, bd = Infinity;
  for (const i of arr) { const p = RACE.samples[i], d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; bi = i; } }
  const p = RACE.samples[bi], N = RACE.samples.length;
  out.i = bi;
  out.s = (((bi - RACE.start + N) % N) * 2);
  out.d = (x - p.x) * p.rx + (z - p.z) * p.rz;
  return out;
}

function bannerTex(lines, bg, fg = '#fff', w = 1024, h = 192) {
  const c = canvas(w, h), x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, w, h);
  x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle'; x.direction = 'rtl';
  lines.forEach((t, i) => { fitFont(x, t, w - 40, i ? h * 0.26 : h * (lines.length > 1 ? 0.46 : 0.62)); x.fillText(t, w / 2, lines.length > 1 ? (i ? h * 0.77 : h * 0.38) : h * 0.52); });
  return tex(c, { repeat: false });
}

export function buildRaceTrack(M) {
  const group = new THREE.Group(); group.name = 'race-track';
  const S = RACE.samples, N = S.length, y = RACE_Y;
  const P = (p, d, h = 0) => [p.x + p.rx * d, y + h, p.z + p.rz * d];
  // الأرض المفتوحة حوالين الحلبة (رمل ونجيلة) — مستطيل واحد كبير
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(520, 420, 1, 1).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xb9a57c, roughness: 0.98, map: M.dirt?.map || null }));
  ground.position.set(-410, y - 0.02, 65); ground.receiveShadow = true;
  if (ground.material.map) { ground.material.map = ground.material.map.clone(); ground.material.map.repeat.set(60, 50); ground.material.map.needsUpdate = true; }
  group.add(ground);
  const asphalt = new GeoBuilder(), kerb = new GeoBuilder(), paint = new GeoBuilder(), grass = new GeoBuilder(), wall = new GeoBuilder();
  for (let i = 0; i < N; i++) {
    const a = S[i], b = S[(i + 1) % N];
    asphalt.setColor([0.92, 0.92, 0.92]);
    asphalt.quad(P(a, -HALF, 0.004), P(a, HALF, 0.004), P(b, HALF, 0.004), P(b, -HALF, 0.004));
    // نجيلة خضرا على الجناب (منطقة الهروب)
    for (const sg of [-1, 1]) {
      grass.setColor([0.36, 0.55, 0.26]);
      const d0 = sg * (HALF + 1.2), d1 = sg * WALL;
      if (sg > 0) grass.quad(P(a, d0, 0.002), P(a, d1, 0.002), P(b, d1, 0.002), P(b, d0, 0.002));
      else grass.quad(P(a, d1, 0.002), P(a, d0, 0.002), P(b, d0, 0.002), P(b, d1, 0.002));
      // الكيرب الأحمر والأبيض (أوضح في المنحنيات)
      kerb.setColor(Math.floor(i / 1) % 2 ? [0.85, 0.08, 0.08] : [0.96, 0.96, 0.96]);
      const k0 = sg * HALF, k1 = sg * (HALF + 1.2);
      if (sg > 0) kerb.quad(P(a, k0, 0.03), P(a, k1, 0.01), P(b, k1, 0.01), P(b, k0, 0.03));
      else kerb.quad(P(a, k1, 0.01), P(a, k0, 0.03), P(b, k0, 0.03), P(b, k1, 0.01));
      // الحاجز: كاوتش أحمر/أبيض متعاكس على خرسانة
      const w0 = sg * WALL, w1 = sg * (WALL + 0.8);
      wall.setColor([0.78, 0.76, 0.72]);
      if (sg > 0) { wall.quad(P(a, w0, 0), P(b, w0, 0), P(b, w0, 0.9), P(a, w0, 0.9)); wall.quad(P(a, w0, 0.9), P(b, w0, 0.9), P(b, w1, 0.9), P(a, w1, 0.9)); }
      else { wall.quad(P(b, w0, 0), P(a, w0, 0), P(a, w0, 0.9), P(b, w0, 0.9)); wall.quad(P(b, w0, 0.9), P(a, w0, 0.9), P(a, w1, 0.9), P(b, w1, 0.9)); }
      wall.setColor(i % 4 < 2 ? [0.82, 0.1, 0.1] : [0.95, 0.95, 0.95]);
      const wy0 = 0.32, wy1 = 0.62;
      if (sg > 0) wall.quad(P(a, w0 - 0.01, wy0), P(b, w0 - 0.01, wy0), P(b, w0 - 0.01, wy1), P(a, w0 - 0.01, wy1));
      else wall.quad(P(b, w0 + 0.01, wy0), P(a, w0 + 0.01, wy0), P(a, w0 + 0.01, wy1), P(b, w0 + 0.01, wy1));
    }
    // خطوط بيضا على الحرف + خط متقطع في النص على المستقيمات
    paint.setColor([0.97, 0.97, 0.94]);
    for (const d of [-HALF + 0.35, HALF - 0.35]) paint.quad(P(a, d - 0.12, 0.009), P(a, d + 0.12, 0.009), P(b, d + 0.12, 0.009), P(b, d - 0.12, 0.009));
  }
  // خط البداية/النهاية (شطرنج) + مربعات البداية
  {
    const p = S[RACE.start];
    for (let r = 0; r < 2; r++) for (let c = 0; c < 13; c++) {
      paint.setColor((r + c) % 2 ? [0.06, 0.06, 0.06] : [0.98, 0.98, 0.98]);
      const d0 = -HALF + c * (2 * HALF / 13), d1 = d0 + 2 * HALF / 13, q0 = { ...p, x: p.x + p.dx * (r * 0.5), z: p.z + p.dz * (r * 0.5) }, q1 = { ...p, x: p.x + p.dx * (r * 0.5 + 0.5), z: p.z + p.dz * (r * 0.5 + 0.5) };
      paint.quad(P(q0, d0, 0.011), P(q0, d1, 0.011), P(q1, d1, 0.011), P(q1, d0, 0.011));
    }
    paint.setColor([0.97, 0.97, 0.94]);
    for (const slot of RACE_GRID) {
      const q = { ...p, x: p.x - p.dx * slot.back, z: p.z - p.dz * slot.back };
      for (const [d0, d1] of [[slot.side - 1.2, slot.side + 1.2]]) paint.quad(P(q, d0, 0.011), P(q, d1, 0.011), P({ ...q, x: q.x + q.dx * 0.25, z: q.z + q.dz * 0.25 }, d1, 0.011), P({ ...q, x: q.x + q.dx * 0.25, z: q.z + q.dz * 0.25 }, d0, 0.011));
    }
  }
  const mk = (gb, mat, shadow = false) => { const m = new THREE.Mesh(gb.build(), mat); m.receiveShadow = true; m.castShadow = shadow; group.add(m); return m; };
  mk(asphalt, M.asphalt);
  mk(grass, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1 }));
  mk(kerb, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }));
  mk(paint, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -3 }));
  mk(wall, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }), true);

  // بوابة البداية: عمودين + كمرة + يافطة + إشارة البداية (5 لمبات)
  const p = S[RACE.start];
  const gate = new GeoBuilder();
  for (const sg of [-1, 1]) { gate.setColor([0.2, 0.2, 0.22]); const [x, , z] = P(p, sg * (WALL + 0.4)); gate.box(x - 0.35, y, z - 0.35, x + 0.35, y + 7.5, z + 0.35); }
  const yaw = Math.atan2(p.dx, p.dz);
  const gm = mk(gate, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.4 }), true);
  void gm;
  const beam = new THREE.Mesh(new THREE.BoxGeometry(2 * WALL + 1.5, 1.6, 0.6), new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.6 }));
  beam.position.set(p.x, y + 7.2, p.z); beam.rotation.y = yaw; beam.castShadow = true; group.add(beam);
  const bt = bannerTex(['حلبة شبين الكوم', 'سباق 3 لفات'], '#b91c1c');
  for (const sz of [-1, 1]) {
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(2 * WALL, 1.45), new THREE.MeshStandardMaterial({ map: bt, emissive: 0xffffff, emissiveMap: bt, emissiveIntensity: 0.25 }));
    pl.position.set(p.x - p.dx * sz * 0.31, y + 7.2, p.z - p.dz * sz * 0.31); pl.rotation.y = yaw + (sz > 0 ? Math.PI : 0);
    group.add(pl);
  }
  // إشارة البداية
  const lights = [];
  const lampOff = new THREE.MeshStandardMaterial({ color: 0x220606, emissive: 0xff1010, emissiveIntensity: 0, roughness: 0.3 });
  for (let k = 0; k < 5; k++) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.28, 18), lampOff.clone());
    m.position.set(p.x - p.dx * 0.32 + p.rx * (k - 2) * 0.8, y + 6.0, p.z - p.dz * 0.32 + p.rz * (k - 2) * 0.8);
    m.rotation.y = yaw + Math.PI;
    group.add(m); lights.push(m.material);
  }
  const lampBox = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.9, 0.3), new THREE.MeshStandardMaterial({ color: 0x0b0b0c }));
  lampBox.position.set(p.x - p.dx * 0.15, y + 6.0, p.z - p.dz * 0.15); lampBox.rotation.y = yaw; group.add(lampBox);

  // مدرجات على الشمال من خط البداية + ناس قاعدين
  {
    const st = new GeoBuilder(), D = -(WALL + 3);
    const A = { ...p, x: p.x - p.dx * 30, z: p.z - p.dz * 30 };
    for (let r = 0; r < 6; r++) {
      st.setColor(r % 2 ? [0.7, 0.7, 0.72] : [0.62, 0.62, 0.65]);
      const d0 = D - r * 1.1, d1 = d0 - 1.1, h = 0.5 + r * 0.55;
      const a = A, b = { ...A, x: A.x + A.dx * 60, z: A.z + A.dz * 60 };
      st.quad(P(b, d0, h), P(a, d0, h), P(a, d1, h), P(b, d1, h));
      st.quad(P(b, d0, h - 0.55), P(a, d0, h - 0.55), P(a, d0, h), P(b, d0, h));
    }
    st.setColor([0.75, 0.15, 0.15]);
    const a = A, b = { ...A, x: A.x + A.dx * 60, z: A.z + A.dz * 60 };
    st.quad(P(b, D - 7, 6.2), P(a, D - 7, 6.2), P(a, D + 0.5, 4.6), P(b, D + 0.5, 4.6)); // مظلة
    mk(st, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }), true);
    // جمهور: نفس أشكال الناس (static) قاعدين على المدرج
    const v = humanVariants(6, 4242, true), seat = [];
    for (let r = 0; r < 6; r++) for (let k = 0; k < 18; k++) {
      if ((r * 7 + k * 3) % 5 === 0) continue;
      const q = { ...A, x: A.x + A.dx * (3 + k * 3.2 + (r % 2) * 1.2), z: A.z + A.dz * (3 + k * 3.2 + (r % 2) * 1.2) };
      const [x, yy, z] = P(q, D - r * 1.1 - 0.55, 0.5 + r * 0.55);
      seat.push([x, yy, z]);
    }
    // (نفس طريقة ناس شبين الثابتين: geometry واحدة مدموجة)
    const hg = new GeoBuilder(), rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(p.rx, p.rz));
    seat.forEach(([x, yy, z], i) => { const h = v[i % v.length]; hg.addGeometry(h.geo, new THREE.Matrix4().compose(new THREE.Vector3(x, yy, z), rot, new THREE.Vector3(h.scale, h.scale, h.scale))); });
    const pm = new THREE.Mesh(hg.build(), humanStaticMaterial()); pm.castShadow = true; group.add(pm);
  }
  // أعلام على الحواجز (كل 40م)
  {
    const fg = new GeoBuilder();
    for (let i = 0; i < N; i += 20) {
      const a = S[i];
      for (const sg of [-1, 1]) {
        const [x, , z] = P(a, sg * (WALL + 0.4));
        fg.setColor([0.3, 0.3, 0.3]); fg.box(x - 0.04, y + 0.9, z - 0.04, x + 0.04, y + 4.2, z + 0.04);
        fg.setColor(i % 40 ? [0.95, 0.75, 0.1] : [0.1, 0.45, 0.85]); fg.box(x + 0.04, y + 3.3, z - 0.02, x + 1.3, y + 4.1, z + 0.02);
      }
    }
    mk(fg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide }));
  }
  // الحواجز جسم حقيقي: صناديق قصيرة على الحرفين (شبكة للبحث السريع)
  const cols = new Map();
  for (let i = 0; i < N; i += 2) {
    const a = S[i];
    for (const sg of [-1, 1]) {
      const [x, , z] = P(a, sg * (WALL + 0.4));
      const c = { cx: x, cz: z, hx: 0.45, hz: 2.3, angle: Math.atan2(a.dx, a.dz), restitution: 0.25, kind: 'wall' };
      const k = gkey(x, z);
      (cols.get(k) || cols.set(k, []).get(k)).push(c);
    }
  }
  group.userData.lights = lights;
  return {
    group, lights,
    colliders(box, out) {
      if (box.cx > -180 || box.cx < -650) return;
      for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
        const arr = cols.get(`${Math.floor(box.cx / _cell) + ox},${Math.floor(box.cz / _cell) + oz}`);
        if (arr) for (const c of arr) if (Math.abs(c.cx - box.cx) < 8 && Math.abs(c.cz - box.cz) < 8) out.push(c);
      }
    },
  };
}

/** أماكن البداية (ورا خط البداية): back = المسافة لورا، side = جانبي */
export const RACE_GRID = [
  { back: 8, side: -2.8 }, { back: 14, side: 2.8 }, { back: 20, side: -2.8 }, { back: 26, side: 2.8 },
];
