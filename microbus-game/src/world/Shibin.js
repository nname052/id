import * as THREE from 'three';
import { Buckets, GeoBuilder } from '../render/GeoBuilder.js';
import { rng, canvas, tex } from '../render/textures.js';
import { buildOne } from './Buildings.js';
import { ROADS, SHIBIN, SIDEWALK_W, SIDEWALK_H, onOtherCarriageway, nearestSide } from './RoadNetwork.js';
import { terrainHeight } from './Route.js';
import { person } from './Pedestrians.js';

// حي شبين الكوم: شارع باريس (تجاري)، شارع الجامعة وبوابة جامعة المنوفية والكليات، قصر ثقافة شبين الكوم،
// محطة القطر بالرصيف والقطر والمزلقان، وبحر شبين بالكورنيش.
// التقسيم قريب من روح المدينة (مش خريطة مطابقة بالمتر).

const byId = (id) => ROADS.find((r) => r.id === id);

// موقف الميكروباص: أرض ركنة شرق شارع المحطة (الميكروباصات الراكنة بتتضاف من Game لأنها محتاجة الموديل)
export const TERMINAL = { x0: 259.5, x1: 298, z0: 244, z1: 289 };
export const TERMINAL_VANS = [];
for (let i = 0; i < 7; i++) TERMINAL_VANS.push({ x: 266 + (i % 2) * 9, z: 248 + Math.floor(i / 2) * 10 + (i % 2) * 4, yaw: Math.PI / 2 + (i % 3 - 1) * 0.06 });

function textPlate(lines, { w = 1024, h = 256, bg = '#11663a', fg = '#ffffff', font = 'Cairo', border = true } = {}) {
  const c = canvas(w, h), x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, w, h);
  if (border) { x.strokeStyle = fg; x.lineWidth = Math.max(4, h * 0.03); x.strokeRect(h * 0.05, h * 0.05, w - h * 0.1, h - h * 0.1); }
  x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle'; x.direction = 'rtl';
  const n = lines.length;
  lines.forEach((t, i) => {
    const size = i === 0 ? h * (n > 1 ? 0.38 : 0.55) : h * 0.22;
    x.font = `bold ${size}px "${font}", Cairo, sans-serif`;
    x.fillText(t, w / 2, n > 1 ? (i === 0 ? h * 0.4 : h * 0.76) : h * 0.53);
  });
  return tex(c, { repeat: false });
}

export function buildShibin(world) {
  const M = world.M, R = rng(1955);
  const cols = (world._sideCols ||= []);
  const box = (cx, cz, hx, hz, angle = 0, kind = 'building') => cols.push({ cx, cz, hx, hz, angle, restitution: 0.12, kind });
  const chunks = new Map();
  const B = (x, z) => {
    const k = `${Math.floor(x / 60)},${Math.floor(z / 60)}`;
    if (!chunks.has(k)) chunks.set(k, { b: new Buckets(), x: Math.floor(x / 60) * 60 + 30, z: Math.floor(z / 60) * 60 + 30 });
    return chunks.get(k).b;
  };
  const SB = SHIBIN.box, C = SHIBIN.canal, RL = SHIBIN.rail;
  const Y0 = -0.45;
  // أماكن محجوزة للمعالم (مفيش عمارات عادية فيها)
  const reserved = [
    { x0: 150, x1: 196, z0: 304, z1: 340 },   // قصر الثقافة
    { x0: 210, x1: 300, z0: 200, z1: 236 },   // المحطة والرصيف
    { x0: 100, x1: 240, z0: 470, z1: 560 },   // الجامعة
    { x0: 90, x1: 330, z0: RL.z - 10, z1: RL.z + 8 }, // السكة
    { x0: 259, x1: 299, z0: 243, z1: 290 },   // موقف الميكروباص
  ];
  const isReserved = (x, z, pad = 0) => reserved.some((r) => x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad) || Math.abs(x - C.x) < C.half + 6;

  // ===== أرضية الحي (تراب/بلاط باهت) — مقطوعة عند البحر =====
  {
    const g = new GeoBuilder();
    g.setColor([0.66, 0.63, 0.58]);
    const y = -0.475;
    const rect = (x0, x1, z0, z1) => g.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [[x0 / 6, z1 / 6], [x1 / 6, z1 / 6], [x1 / 6, z0 / 6], [x0 / 6, z0 / 6]]);
    rect(SB.x0, C.x - C.half - 3, SB.z0, SB.z1);
    rect(C.x + C.half + 3, SB.x1, SB.z0, SB.z1);
    const m = new THREE.Mesh(g.build(), M.concrete);
    m.receiveShadow = true;
    const grp = new THREE.Group(); grp.add(m);
    world._addChunk(grp, (SB.x0 + SB.x1) / 2, (SB.z0 + SB.z1) / 2, 260);
  }

  // ===== الأرصفة على الشوارع (بتتقطع عند التقاطعات) =====
  for (const road of ROADS) {
    if (road.style !== 'urban') continue;
    const S = road.samples;
    for (let i = 0; i < S.length - 1; i++) {
      const a = S[i], b = S[i + 1];
      for (const sx of [-1, 1]) {
        const dm = sx * (a.half + SIDEWALK_W / 2);
        const mx = (a.x + b.x) / 2 + a.rx * dm, mz = (a.z + b.z) / 2 + a.rz * dm;
        if (onOtherCarriageway(mx, mz, road, 1.2)) continue;
        if (road.corniche && sx < 0 && Math.abs(mx - C.x) < C.half + 4) continue;
        const P = (p, d, h) => [p.x + p.rx * d, p.y + h, p.z + p.rz * d];
        const d0 = sx * a.half, d1 = sx * (a.half + SIDEWALK_W), top = 0.03 + SIDEWALK_H;
        const bk = B(mx, mz);
        const t = bk.get('sidewalkTop');
        t.setColor([0.92 + R() * 0.06, 0.9, 0.86]);
        if (sx > 0) t.quad(P(a, d0, top), P(a, d1, top), P(b, d1, top), P(b, d0, top), [[0, a.s / 2], [1.6, a.s / 2], [1.6, b.s / 2], [0, b.s / 2]]);
        else t.quad(P(a, d1, top), P(a, d0, top), P(b, d0, top), P(b, d1, top), [[0, a.s / 2], [1.6, a.s / 2], [1.6, b.s / 2], [0, b.s / 2]]);
        const cu = bk.get('curb');
        if (sx > 0) cu.quad(P(b, d0, 0.03), P(a, d0, 0.03), P(a, d0, top), P(b, d0, top), [[b.s, 0], [a.s, 0], [a.s, 1], [b.s, 1]]);
        else cu.quad(P(a, d0, 0.03), P(b, d0, 0.03), P(b, d0, top), P(a, d0, top), [[a.s, 0], [b.s, 0], [b.s, 1], [a.s, 1]]);
      }
    }
  }

  // ===== عمارات على الشوارع =====
  let seed = 7000;
  const row = (road, side, opts) => {
    const S = road.samples;
    let s = 8;
    while (s < road.length - 8) {
      const w = opts.wMin + R() * (opts.wMax - opts.wMin);
      const p = S[Math.min(S.length - 1, Math.round((s + w / 2) / 2))];
      const off = side * (p.half + SIDEWALK_W + 0.2);
      const x = p.x + p.rx * off, z = p.z + p.rz * off;
      const fx = -side * p.rx, fz = -side * p.rz, rotY = Math.atan2(fx, fz);
      const D = opts.depth;
      const cx = x - fx * D / 2, cz = z - fz * D / 2;
      // متعديش على شارع تاني أو معلم
      // أركان المبنى (الواجهة على الرصيف والضهر لجوه)
      const corners = [[-w / 2, 0], [w / 2, 0], [-w / 2, D], [w / 2, D], [0, D / 2]].map(([lx, ld]) => [x - fz * lx - fx * ld, z + fx * lx - fz * ld]);
      const bad = isReserved(cx, cz, 4) || onOtherCarriageway(x, z, road, SIDEWALK_W + 2) || corners.some(([qx, qz]) => onOtherCarriageway(qx, qz, road, SIDEWALK_W + 1.5) || isReserved(qx, qz, 1));
      if (!bad) {
        buildOne(B(x, z), {
          seed: seed++ * 7919, x, y: p.y + 0.03 + SIDEWALK_H, z, rotY, width: w * 0.97, depth: D,
          floors: opts.fMin + Math.floor(R() * (opts.fMax - opts.fMin + 1)), style: R() < opts.brick ? 'brick' : 'plaster',
          facades: {}, shops: R() < opts.shops, detail: world.low ? 'low' : 'low',
        });
        box(cx, cz, w / 2, D / 2, rotY);
      }
      s += w + (opts.gap ? R() * opts.gap : 0);
    }
  };
  for (const side of [-1, 1]) {
    row(byId('S1'), side, { wMin: 10, wMax: 15, depth: 13, fMin: 4, fMax: 9, brick: 0.25, shops: 1 });
    row(byId('S2'), side, { wMin: 12, wMax: 18, depth: 14, fMin: 4, fMax: 8, brick: 0.2, shops: 0.6, gap: 3 });
    row(byId('S4'), side, { wMin: 9, wMax: 13, depth: 11, fMin: 3, fMax: 6, brick: 0.4, shops: 0.8 });
  }
  row(byId('S3'), 1, { wMin: 11, wMax: 16, depth: 13, fMin: 5, fMax: 10, brick: 0.15, shops: 0.5 });

  // ===== بحر شبين: مية + سور الكورنيش + نخل =====
  {
    const w = new GeoBuilder();
    w.quad([C.x - C.half - 1, -1.65, C.z1], [C.x + C.half + 1, -1.65, C.z1], [C.x + C.half + 1, -1.65, C.z0], [C.x - C.half - 1, -1.65, C.z0], [[0, 0], [1, 0], [1, 30], [0, 30]]);
    const water = new THREE.Mesh(w.build(), M.water);
    const g = new THREE.Group(); g.add(water);
    world._addChunk(g, C.x, (C.z0 + C.z1) / 2, 200);
    const rail = new GeoBuilder();
    for (const sx of [-1, 1]) {
      const x = C.x + sx * (C.half + 1.4);
      let z = C.z0 + 2;
      while (z < C.z1 - 2) {
        const z1 = z + 3;
        const nearRoad = (() => { const n = nearestSide(x, z + 1.5); return n && n.dist < n.half + 1.5; })();
        if (!nearRoad && Math.abs(z + 1.5 - RL.z) > 4) {
          const y = terrainHeight(x, z + 1.5);
          rail.setColor([0.25, 0.42, 0.32]);
          rail.box(x - 0.04, y + 0.95, z, x + 0.04, y + 1.02, z1);
          rail.box(x - 0.025, y + 0.5, z, x + 0.025, y + 0.55, z1);
          rail.box(x - 0.04, y, z, x + 0.04, y + 1.02, z + 0.08);
          box(x, z + 1.5, 0.12, 1.5, 0, 'rail');
        }
        z = z1;
      }
    }
    const rm = new THREE.Mesh(rail.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.6 }));
    rm.castShadow = true;
    const g2 = new THREE.Group(); g2.add(rm);
    world._addChunk(g2, C.x, (C.z0 + C.z1) / 2, 200);
    const palms = [];
    for (let z = C.z0 + 10; z < C.z1 - 10; z += 16) for (const sx of [-1, 1]) {
      const x = C.x + sx * (C.half + 3.2);
      const n = nearestSide(x, z);
      if (n && n.dist < n.half + 1) continue;
      if (Math.abs(z - RL.z) < 8) continue;
      palms.push([x, terrainHeight(x, z), z, 0.85 + R() * 0.3]);
      box(x, z, 0.25, 0.25, 0, 'pole');
    }
    world._instancedPalms(palms);
  }

  // ===== السكة الحديد: قضبان + فلنكات + حصى، ومزلقانات =====
  {
    const g = new GeoBuilder();
    const y = -0.45;
    g.setColor([0.38, 0.35, 0.32]);
    g.box(RL.x0, y - 0.02, RL.z - 1.9, RL.x1, y + 0.06, RL.z + 1.9);
    g.setColor([0.32, 0.24, 0.18]);
    for (let x = RL.x0; x < RL.x1; x += 0.65) g.box(x, y + 0.06, RL.z - 1.25, x + 0.24, y + 0.13, RL.z + 1.25);
    g.setColor([0.55, 0.53, 0.5]);
    for (const dz of [-0.72, 0.72]) g.box(RL.x0, y + 0.13, RL.z + dz - 0.035, RL.x1, y + 0.21, RL.z + dz + 0.035);
    const m = new THREE.Mesh(g.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.25 }));
    m.receiveShadow = true;
    const grp = new THREE.Group(); grp.add(m);
    world._addChunk(grp, (RL.x0 + RL.x1) / 2, RL.z, 140);
    // مزلقان عند كل شارع بيعدّي السكة
    for (const road of [byId('S2'), byId('S3')]) {
      const hit = road.samples.reduce((best, p) => (Math.abs(p.z - RL.z) < Math.abs(best.z - RL.z) ? p : best));
      const gate = new GeoBuilder();
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const px = hit.x + hit.rx * sx * (hit.half + 1.2) + hit.dx * sz * 4.5, pz = hit.z + hit.rz * sx * (hit.half + 1.2) + hit.dz * sz * 4.5;
        const py = terrainHeight(px, pz) + 0.15;
        gate.setColor([0.85, 0.85, 0.82]); gate.box(px - 0.12, py, pz - 0.12, px + 0.12, py + 1.3, pz + 0.12);
        // الدراع مرفوع (مخطط أحمر وأبيض)
        for (let k = 0; k < 6; k++) { gate.setColor(k % 2 ? [0.9, 0.9, 0.9] : [0.8, 0.08, 0.08]); gate.box(px - 0.05, py + 1.3 + k * 0.6, pz - 0.05, px + 0.05, py + 1.9 + k * 0.6, pz + 0.05); }
        gate.setColor([0.1, 0.1, 0.1]); gate.box(px - 0.2, py + 2.1, pz - 0.05, px + 0.2, py + 2.4, pz + 0.05);
        box(px, pz, 0.15, 0.15, 0, 'pole');
      }
      const gm = new THREE.Mesh(gate.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }));
      gm.castShadow = true;
      const gg = new THREE.Group(); gg.add(gm);
      // يافطة مزلقان
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.5), new THREE.MeshStandardMaterial({ map: textPlate(['مزلقان — حاسب القطر'], { w: 512, h: 160, bg: '#c81e1e' }), side: THREE.DoubleSide }));
      const sp = { x: hit.x + hit.rx * (hit.half + 1.2) - hit.dx * 9, z: hit.z + hit.rz * (hit.half + 1.2) - hit.dz * 9 };
      sign.position.set(sp.x, terrainHeight(sp.x, sp.z) + 2.4, sp.z); sign.rotation.y = Math.atan2(-hit.dx, -hit.dz);
      gg.add(sign);
      world._addChunk(gg, hit.x, hit.z, 40);
    }
  }

  // ===== محطة قطر شبين الكوم =====
  {
    const g = new GeoBuilder(), y = Y0;
    const bx = 252, bz = 228; // نص المبنى
    // رصيف
    g.setColor([0.72, 0.7, 0.66]); g.box(212, y, RL.z + 2.2, 300, y + 0.75, RL.z + 8.5);
    g.setColor([0.9, 0.8, 0.2]); g.box(212, y + 0.75, RL.z + 2.2, 300, y + 0.77, RL.z + 2.5);
    box(256, RL.z + 5.35, 44, 3.15, 0, 'wall');
    // المبنى (أصفر سكة حديد بأقواس)
    g.setColor([0.86, 0.72, 0.42]); g.box(bx - 20, y, bz - 3.5, bx + 20, y + 9, bz + 4.5);
    g.setColor([0.8, 0.66, 0.38]); g.box(bx - 6, y, bz - 3.5, bx + 6, y + 13, bz + 5);
    g.setColor([0.95, 0.92, 0.85]); g.box(bx - 20.3, y + 9, bz - 3.8, bx + 20.3, y + 9.6, bz + 4.8); g.box(bx - 6.3, y + 13, bz - 3.8, bx + 6.3, y + 13.6, bz + 5.3);
    for (let i = -4; i <= 4; i++) { if (Math.abs(i) <= 1) continue; const x = bx + i * 4; g.setColor([0.25, 0.22, 0.2]); g.box(x - 1.1, y + 0.6, bz + 4.52, x + 1.1, y + 3.6, bz + 4.56); g.setColor([0.3, 0.42, 0.5]); g.box(x - 0.9, y + 5, bz + 4.52, x + 0.9, y + 7.5, bz + 4.56); }
    g.setColor([0.2, 0.17, 0.15]); g.box(bx - 3.5, y, bz + 5.02, bx + 3.5, y + 4.8, bz + 5.06); // البوابة الرئيسية
    // مظلة الرصيف
    g.setColor([0.35, 0.36, 0.38]);
    for (let x = 216; x <= 296; x += 8) g.box(x - 0.12, y + 0.75, RL.z + 6.3, x + 0.12, y + 4.5, RL.z + 6.6);
    g.setColor([0.55, 0.2, 0.15]); g.box(212, y + 4.5, RL.z + 3.5, 300, y + 4.7, RL.z + 8.5);
    box(bx, bz + 0.5, 20.5, 4.2, 0, 'building');
    const m = new THREE.Mesh(g.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, map: M.concrete.map }));
    m.castShadow = true; m.receiveShadow = true;
    const grp = new THREE.Group(); grp.add(m);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(10, 1.6), new THREE.MeshStandardMaterial({ map: textPlate(['محطة شبين الكوم', 'السكك الحديدية المصرية'], { bg: '#1b3f7a' }) }));
    sign.position.set(bx, y + 10.8, bz + 5.08); grp.add(sign);
    // ساعة
    const clock = new THREE.Mesh(new THREE.CircleGeometry(1.1, 32), new THREE.MeshStandardMaterial({ map: (() => { const c = canvas(128, 128), x = c.getContext('2d'); x.fillStyle = '#f4f0e6'; x.beginPath(); x.arc(64, 64, 62, 0, 7); x.fill(); x.strokeStyle = '#222'; x.lineWidth = 6; x.stroke(); x.lineWidth = 5; x.beginPath(); x.moveTo(64, 64); x.lineTo(64, 24); x.moveTo(64, 64); x.lineTo(92, 74); x.stroke(); return tex(c, { repeat: false }); })() }));
    clock.position.set(bx, y + 7.2, bz + 5.08); grp.add(clock);
    world._addChunk(grp, bx, bz, 90);
    // القطر واقف على الرصيف: جرّار + 3 عربيات (أزرق ورمادي)
    const t = new GeoBuilder(), ty = y + 0.21;
    const car = (x0, x1, loco) => {
      t.setColor(loco ? [0.12, 0.25, 0.55] : [0.55, 0.57, 0.6]);
      t.box(x0, ty + 0.9, RL.z - 1.45, x1, ty + 4.0, RL.z + 1.45);
      t.setColor([0.15, 0.15, 0.16]); t.box(x0 + 0.5, ty + 0.25, RL.z - 1.2, x1 - 0.5, ty + 0.9, RL.z + 1.2);
      t.setColor(loco ? [0.95, 0.75, 0.1] : [0.12, 0.25, 0.55]); t.box(x0, ty + 1.6, RL.z - 1.47, x1, ty + 1.9, RL.z + 1.47);
      if (!loco) { t.setColor([0.12, 0.14, 0.16]); for (let x = x0 + 1.5; x < x1 - 1.5; x += 2.2) for (const sz of [-1, 1]) t.box(x, ty + 2.3, RL.z + sz * 1.46 - 0.01, x + 1.4, ty + 3.3, RL.z + sz * 1.46 + 0.01); }
      else { t.setColor([0.1, 0.12, 0.14]); t.box(x0 - 0.01, ty + 2.5, RL.z - 1.2, x0 + 0.01, ty + 3.4, RL.z + 1.2); }
      box((x0 + x1) / 2, RL.z, (x1 - x0) / 2, 1.5, 0, 'wall');
    };
    car(214, 231, true); car(232, 255); car(256, 279); car(280, 303);
    const tm = new THREE.Mesh(t.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.3 }));
    tm.castShadow = true;
    const tg = new THREE.Group(); tg.add(tm);
    world._addChunk(tg, 258, RL.z, 70);
  }

  // ===== موقف ميكروباص شبين الكوم (جنب المحطة على شارع المحطة) =====
  {
    const T = TERMINAL, y = Y0 + 0.03;
    const g = new GeoBuilder();
    g.setColor([0.42, 0.41, 0.4]); g.box(T.x0, y - 0.03, T.z0, T.x1, y + 0.01, T.z1); // أرضية أسفلت قديم
    g.setColor([0.95, 0.95, 0.9]);
    for (let z = T.z0 + 4; z < T.z1 - 3; z += 5) g.box(T.x0 + 3, y + 0.012, z, T.x1 - 10, y + 0.016, z + 0.12); // خطوط الركنة
    // مظلة على عمدان
    g.setColor([0.35, 0.36, 0.38]);
    for (let z = T.z0 + 3; z <= T.z1 - 3; z += 8) for (const x of [T.x1 - 9, T.x1 - 2]) g.box(x - 0.1, y, z - 0.1, x + 0.1, y + 3.6, z + 0.1);
    g.setColor([0.15, 0.45, 0.35]); g.box(T.x1 - 10, y + 3.6, T.z0 + 2, T.x1 - 1, y + 3.75, T.z1 - 2);
    // دكك خرسانة للركاب
    g.setColor([0.7, 0.68, 0.64]);
    for (let z = T.z0 + 6; z < T.z1 - 6; z += 9) g.box(T.x1 - 7, y, z, T.x1 - 4, y + 0.45, z + 2.4);
    // كشك التذاكر/المنادي
    g.setColor([0.85, 0.82, 0.74]); g.box(T.x0 + 1, y, T.z1 - 6, T.x0 + 4, y + 2.6, T.z1 - 2);
    g.setColor([0.2, 0.3, 0.38]); g.box(T.x0 + 0.98, y + 1.2, T.z1 - 5.5, T.x0 + 1.0, y + 2.1, T.z1 - 2.5);
    box(T.x0 + 2.5, T.z1 - 4, 1.5, 2, 0, 'building');
    for (let z = T.z0 + 6; z < T.z1 - 6; z += 9) box(T.x1 - 5.5, z + 1.2, 1.5, 1.2, 0, 'prop');
    for (let z = T.z0 + 3; z <= T.z1 - 3; z += 8) for (const x of [T.x1 - 9, T.x1 - 2]) box(x, z, 0.15, 0.15, 0, 'pole');
    const m = new THREE.Mesh(g.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, map: M.concrete.map }));
    m.castShadow = true; m.receiveShadow = true;
    const grp = new THREE.Group(); grp.add(m);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(8.5, 1.4), new THREE.MeshStandardMaterial({ map: textPlate(['موقف ميكروباص شبين الكوم', 'طنطا · قويسنا · منوف · الباجور · السادات'], { bg: '#c8a020', fg: '#1a1408' }), side: THREE.DoubleSide }));
    sign.position.set(T.x0 + 0.2, y + 4.4, (T.z0 + T.z1) / 2); sign.rotation.y = -Math.PI / 2;
    grp.add(sign);
    const pole2 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 4.4, 0.2), M.paintedMetal); pole2.position.set(T.x0 + 0.2, y + 2.2, (T.z0 + T.z1) / 2 - 4.4); grp.add(pole2);
    const pole3 = pole2.clone(); pole3.position.z = (T.z0 + T.z1) / 2 + 4.4; grp.add(pole3);
    world._addChunk(grp, (T.x0 + T.x1) / 2, (T.z0 + T.z1) / 2, 60);
  }

  // ===== قصر ثقافة شبين الكوم (على شارع باريس) =====
  {
    const g = new GeoBuilder(), y = Y0 + 0.18;
    const cx = 173, front = 300 + 4.4 + SIDEWALK_W + 6, D = 16, W = 34;
    g.setColor([0.86, 0.84, 0.8]); g.box(cx - W / 2, y, front, cx + W / 2, y + 11, front + D);
    g.setColor([0.75, 0.72, 0.68]); g.box(cx - W / 2 - 0.4, y + 11, front - 0.4, cx + W / 2 + 0.4, y + 11.8, front + D + 0.4);
    // أعمدة + درج
    for (let i = 0; i < 8; i++) { const x = cx - 14 + i * 4; g.setColor([0.95, 0.94, 0.9]); g.box(x - 0.45, y, front - 3.2, x + 0.45, y + 9, front - 2.3); }
    g.setColor([0.93, 0.92, 0.88]); g.box(cx - 16, y + 9, front - 3.6, cx + 16, y + 10, front);
    for (let k = 0; k < 3; k++) { g.setColor([0.8, 0.79, 0.76]); g.box(cx - 15, y - 0.2, front - 6 + k, cx + 15, y + 0.2 + k * 0.2, front - 3 + k * 0.3); }
    g.setColor([0.3, 0.4, 0.46]); for (let i = 0; i < 6; i++) g.box(cx - 13 + i * 5, y + 1, front - 0.02, cx - 10 + i * 5, y + 7.5, front);
    box(cx, front + D / 2, W / 2, D / 2, 0, 'building');
    const m = new THREE.Mesh(g.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 }));
    m.castShadow = true; m.receiveShadow = true;
    const grp = new THREE.Group(); grp.add(m);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(14, 1.8), new THREE.MeshStandardMaterial({ map: textPlate(['قصر ثقافة شبين الكوم', 'الهيئة العامة لقصور الثقافة'], { bg: '#7a1f1f' }), side: THREE.DoubleSide }));
    // اليافطة على الواجهة ناحية الشارع (-z)
    s.position.set(cx, y + 10.4, front - 3.65); s.rotation.y = Math.PI;
    grp.add(s);
    world._addChunk(grp, cx, front + D / 2, 60);
  }

  // ===== جامعة المنوفية: البوابة + السور + الكليات =====
  {
    const g = new GeoBuilder(), y = Y0;
    const gx = 200, gz = 482;
    // البوابة
    g.setColor([0.82, 0.78, 0.7]);
    for (const sx of [-1, 1]) { g.box(gx + sx * 8 - 1, y, gz - 1, gx + sx * 8 + 1, y + 8.5, gz + 1); box(gx + sx * 8, gz, 1, 1, 0, 'wall'); }
    g.setColor([0.75, 0.7, 0.62]); g.box(gx - 9, y + 7, gz - 1.1, gx + 9, y + 9, gz + 1.1);
    // السور
    for (const [x0, x1] of [[104, gx - 9], [gx + 9, 234]]) {
      g.setColor([0.8, 0.76, 0.68]); g.box(x0, y, gz - 0.25, x1, y + 0.9, gz + 0.25);
      g.setColor([0.15, 0.3, 0.22]); for (let x = x0; x < x1; x += 0.35) g.box(x, y + 0.9, gz - 0.03, x + 0.04, y + 2.4, gz + 0.03);
      g.setColor([0.15, 0.3, 0.22]); g.box(x0, y + 2.35, gz - 0.04, x1, y + 2.45, gz + 0.04);
      box((x0 + x1) / 2, gz, (x1 - x0) / 2, 0.3, 0, 'wall');
    }
    // أرضية الحرم: نجيلة + ممشى
    g.setColor([0.32, 0.55, 0.25]); g.box(104, y - 0.03, gz + 0.3, 234, y + 0.02, 548);
    g.setColor([0.78, 0.74, 0.66]); g.box(gx - 6, y + 0.02, gz + 0.3, gx + 6, y + 0.05, 530); g.box(120, y + 0.02, 506, 220, y + 0.05, 514);
    const m = new THREE.Mesh(g.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
    m.castShadow = true; m.receiveShadow = true;
    const grp = new THREE.Group(); grp.add(m);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(17, 1.9), new THREE.MeshStandardMaterial({ map: textPlate(['جامعة المنوفية', 'Menoufia University'], { bg: '#0f3d6e' }), side: THREE.DoubleSide }));
    s.position.set(gx, y + 8, gz - 1.12); s.rotation.y = Math.PI; grp.add(s);
    world._addChunk(grp, 170, 510, 90);
    // الكليات
    const fac = [
      { name: 'كلية الهندسة', x: 132, z: 520, rot: Math.PI / 2, w: 26, d: 14, f: 4 },
      { name: 'كلية الطب', x: 214, z: 528, rot: -Math.PI / 2, w: 22, d: 13, f: 5 },
      { name: 'إدارة الجامعة', x: 172, z: 540, rot: Math.PI, w: 30, d: 12, f: 3 },
      { name: 'كلية التجارة', x: 132, z: 494, rot: Math.PI / 2, w: 18, d: 12, f: 3 },
      { name: 'كلية الآداب', x: 214, z: 498, rot: -Math.PI / 2, w: 18, d: 12, f: 3 },
    ];
    const fb = new Buckets();
    for (const f of fac) {
      const fx = Math.sin(f.rot), fz = Math.cos(f.rot);
      buildOne(fb, { seed: seed++ * 31, x: f.x, y: Y0, z: f.z, rotY: f.rot, width: f.w, depth: f.d, floors: f.f, style: 'plaster', facades: {}, shops: false, detail: 'low' });
      box(f.x - fx * f.d / 2, f.z - fz * f.d / 2, f.w / 2, f.d / 2, f.rot);
      const H = 4.2 + f.f * 3;
      const p = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(12, f.w * 0.6), 1.3), new THREE.MeshStandardMaterial({ map: textPlate([f.name, 'جامعة المنوفية'], { bg: '#0f3d6e', w: 768, h: 192 }) }));
      p.position.set(f.x + fx * 0.06, Y0 + H - 1.2, f.z + fz * 0.06); p.rotation.y = f.rot;
      grp.add(p);
    }
    const fg = new THREE.Group();
    fb.toMeshes({ ...M, winGlass: M.glass }, fg);
    world._addChunk(fg, 172, 515, 90);
    const palms = [];
    for (let z = gz + 6; z < 545; z += 9) for (const sx of [-1, 1]) palms.push([gx + sx * 8, Y0, z, 0.9 + R() * 0.2]);
    world._instancedPalms(palms);
    for (const p of palms) box(p[0], p[2], 0.25, 0.25, 0, 'pole');
  }

  // ===== يافطات أسامي الشوارع عند التقاطعات =====
  {
    const names = [['S1', 'S2'], ['S1', 'S3'], ['S1', 'S4'], ['S2', 'S3']];
    for (const [a, b] of names) {
      const A = byId(a), Bq = byId(b);
      let best = null, bd = Infinity;
      for (const p of A.samples) for (let i = 0; i < Bq.samples.length; i += 2) { const q = Bq.samples[i]; const d = (p.x - q.x) ** 2 + (p.z - q.z) ** 2; if (d < bd) { bd = d; best = p; } }
      if (!best) continue;
      const off = best.half + SIDEWALK_W - 0.5;
      const x = best.x + best.rx * off + best.dx * (Bq.half + 2.5), z = best.z + best.rz * off + best.dz * (Bq.half + 2.5);
      const grp = new THREE.Group();
      const y = terrainHeight(x, z) + 0.18;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.8, 6), M.paintedMetal); pole.position.set(x, y + 1.4, z); grp.add(pole);
      const p1 = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.38), new THREE.MeshStandardMaterial({ map: textPlate([A.name], { w: 512, h: 128, bg: '#1b4f9c' }), side: THREE.DoubleSide }));
      p1.position.set(x, y + 2.7, z); p1.rotation.y = Math.atan2(best.rx, best.rz); grp.add(p1);
      const p2 = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.38), new THREE.MeshStandardMaterial({ map: textPlate([Bq.name], { w: 512, h: 128, bg: '#1b4f9c' }), side: THREE.DoubleSide }));
      p2.position.set(x, y + 2.25, z); p2.rotation.y = Math.atan2(best.dx, best.dz); grp.add(p2);
      world._addChunk(grp, x, z, 30);
      box(x, z, 0.1, 0.1, 0, 'pole');
    }
  }

  // ===== ناس على الرصيف (المحطة + الجامعة + شارع باريس) =====
  {
    const ppl = new THREE.Group();
    const spots = [];
    for (let i = 0; i < 6; i++) spots.push([218 + R() * 76, RL.z + 4.5 + R() * 3, Y0 + 0.75, R() * 6]);
    for (let i = 0; i < 5; i++) spots.push([192 + R() * 16, 486 + R() * 14, Y0, R() * 6]);
    const S1 = byId('S1');
    for (let i = 0; i < 6; i++) { const p = S1.samples[10 + Math.floor(R() * (S1.samples.length - 20))]; const sd = (R() < 0.5 ? -1 : 1) * (p.half + 1.4); spots.push([p.x + p.rx * sd, p.z + p.rz * sd, p.y + 0.18, R() * 6]); }
    for (const [x, z, y, r] of spots) {
      const pp = person(R);
      pp.root.position.set(x, y, z); pp.root.rotation.y = r;
      pp.arms.forEach((a, i) => { a.rotation.x = i ? -0.15 : 0.1; });
      ppl.add(pp.root);
    }
    world._addChunk(ppl, 220, 330, 260);
  }

  // تجميع العمارات والأرصفة في chunks
  for (const { b, x, z } of chunks.values()) {
    const g = new THREE.Group();
    b.toMeshes({ ...M, winGlass: M.glass }, g);
    world._addChunk(g, x, z, 75);
  }
}
