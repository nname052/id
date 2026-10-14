import * as THREE from 'three';
import { Buckets } from '../render/GeoBuilder.js';
import { rng, atlasUV, signUV } from '../render/textures.js';
import { ROAD, CROSSINGS, mainSegments } from './layout.js';

// عمارات مصرية إجرائية: واجهات بلاستر ملونة أو طوب أحمر بهيكل خرساني،
// بلكونات، تكييفات، محلات بلافتات عربي، خزانات مية ودشات على السطح، غسيل منشور.

const PLASTER_TINTS = [
  [0.95, 0.86, 0.70], [0.93, 0.79, 0.57], [0.96, 0.84, 0.78], [0.86, 0.86, 0.84],
  [0.99, 0.95, 0.87], [0.98, 0.90, 0.66], [0.93, 0.74, 0.62], [0.82, 0.80, 0.70], [0.90, 0.84, 0.76],
];
const CLOTH = [[0.85, 0.15, 0.15], [0.15, 0.35, 0.8], [0.95, 0.95, 0.95], [0.9, 0.75, 0.1], [0.2, 0.6, 0.3], [0.9, 0.45, 0.6], [0.3, 0.3, 0.3]];
const AWNING = [[0.75, 0.12, 0.1], [0.1, 0.45, 0.25], [0.15, 0.3, 0.65], [0.9, 0.6, 0.1]];

let signCounter = 0;
let clinicCounter = 0;

export const BUILDING_INFO = []; // لأماكن المحلات (للمشاة والكراسي)

export function buildOne(B, opts) {
  const R = rng(opts.seed);
  const { width: W, depth: D, floors } = opts;
  const brick = opts.style === 'brick';
  const GF = 4.2, FH = 3.0;
  const H = GF + floors * FH;
  const tint = brick ? [1, 0.97, 0.95] : PLASTER_TINTS[Math.floor(R() * PLASTER_TINTS.length)];
  const dirt = 0.86 + R() * 0.14;
  const col = tint.map((c) => c * dirt);
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(opts.x, 0, opts.z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), opts.rotY),
    new THREE.Vector3(1, 1, 1),
  );
  const get = (name) => B.get(name).setTransform(m);

  const facade = get(brick ? 'facadeBrick' : 'facadePlaster').setColor(col);
  const wall = get(brick ? 'wallBrick' : 'wallPlaster').setColor(col);
  const conc = get('concrete').setColor(brick ? [0.78, 0.77, 0.74] : col.map((c) => c * 0.95));

  // ===== الكتلة الرئيسية (جوانب + سطح) =====
  wall.box(-W / 2, 0, -D, W / 2, H, -0.03, { uvScale: 3, skip: 'pzny' + (opts.facades.left ? 'nx' : '') + (opts.facades.right ? 'px' : '') });
  conc.box(-W / 2, H, -D, W / 2, H + 0.05, 0, { uvScale: 4, skip: 'ny' });
  // سور السطح
  if (!brick || R() < 0.5) {
    conc.box(-W / 2, H, -0.2, W / 2, H + 1.0, 0.05, { uvScale: 4 });
    conc.box(-W / 2, H, -D, -W / 2 + 0.2, H + 1.0, -0.2, { uvScale: 4 });
    conc.box(W / 2 - 0.2, H, -D, W / 2, H + 1.0, -0.2, { uvScale: 4 });
  }

  // ===== واجهة (أمامية أو جانبية) =====
  const primary = [0, 1, 2, 3, 6][Math.floor(R() * 5)];
  const drawFacade = (faceLen, toLocal, isFront) => {
    const bays = Math.max(1, Math.round(faceLen / 3.3));
    const bw = faceLen / bays;
    const balconyCols = [];
    for (let j = 0; j < bays; j++) balconyCols.push(R() < (isFront ? 0.45 : 0.25));
    const acSide = R() < 0.5 ? -1 : 1;

    for (let i = 0; i < floors; i++) {
      const y0 = GF + i * FH, y1 = y0 + FH;
      for (let j = 0; j < bays; j++) {
        const u0 = -faceLen / 2 + j * bw, u1 = u0 + bw;
        let cell;
        if (balconyCols[j]) cell = R() < 0.6 ? 4 : 7;
        else cell = R() < 0.62 ? primary : [0, 1, 3, 5, 6][Math.floor(R() * 5)];
        const p = (u, y, z = 0) => toLocal(u, y, z);
        facade.quad(p(u0, y0), p(u1, y0), p(u1, y1), p(u0, y1), atlasUV(cell));

        // بلكونة
        if (balconyCols[j]) {
          const bd = 1.05, bx0 = u0 + 0.25, bx1 = u1 - 0.25;
          slabBox(conc, toLocal, bx0, y0 - 0.02, 0, bx1, y0 + 0.16, bd);
          const enclosed = R() < 0.18;
          const solid = R() < 0.45 || enclosed || opts.detail === 'low';
          if (solid) {
            slabBox(conc, toLocal, bx0, y0 + 0.16, bd - 0.1, bx1, y0 + 1.05, bd);
            slabBox(conc, toLocal, bx0, y0 + 0.16, 0, bx0 + 0.1, y0 + 1.05, bd - 0.1);
            slabBox(conc, toLocal, bx1 - 0.1, y0 + 0.16, 0, bx1, y0 + 1.05, bd - 0.1);
          } else {
            const met = get('metal').setColor([0.5 + R() * 0.3, 0.5, 0.45]);
            slabBox(met, toLocal, bx0, y0 + 1.0, bd - 0.05, bx1, y0 + 1.06, bd);
            for (let u = bx0; u <= bx1 + 0.001; u += 0.14) slabBox(met, toLocal, u, y0 + 0.16, bd - 0.04, u + 0.025, y0 + 1.0, bd - 0.01);
            slabBox(met, toLocal, bx0, y0 + 0.16, 0, bx0 + 0.04, y0 + 1.06, bd);
            slabBox(met, toLocal, bx1 - 0.04, y0 + 0.16, 0, bx1, y0 + 1.06, bd);
          }
          if (enclosed) {
            const g = get('winGlass');
            g.quad(p(bx0, y0 + 1.05, bd), p(bx1, y0 + 1.05, bd), p(bx1, y1 - 0.15, bd), p(bx0, y1 - 0.15, bd));
            const al = get('metal').setColor([0.75, 0.75, 0.72]);
            slabBox(al, toLocal, bx0, y1 - 0.2, 0, bx1, y1 - 0.1, bd + 0.02);
            for (let u = bx0; u < bx1; u += (bx1 - bx0) / 3) slabBox(al, toLocal, u, y0 + 1.05, bd - 0.02, u + 0.05, y1 - 0.15, bd + 0.02);
          }
          // غسيل منشور
          if (!enclosed && opts.detail !== 'low' && R() < 0.35) {
            const cl = get('cloth');
            for (let u = bx0 + 0.15; u < bx1 - 0.4; u += 0.45 + R() * 0.2) {
              cl.setColor(CLOTH[Math.floor(R() * CLOTH.length)]);
              const hgt = 0.5 + R() * 0.5, wd = 0.3 + R() * 0.2;
              cl.quad(p(u, y0 + 1.05 - hgt, bd + 0.08), p(u + wd, y0 + 1.05 - hgt, bd + 0.08), p(u + wd, y0 + 1.08, bd + 0.08), p(u, y0 + 1.08, bd + 0.08));
            }
          }
          // يافطة عيادة على سور البلكونة
          if (i === 0 && isFront && R() < 0.4) {
            const k = clinicCounter++ % 8;
            const c0 = (bx0 + bx1) / 2 - 0.6;
            get('clinic').quad(p(c0, y0 + 0.1, bd + 0.03), p(c0 + 1.2, y0 + 0.1, bd + 0.03), p(c0 + 1.2, y0 + 1.3, bd + 0.03), p(c0, y0 + 1.3, bd + 0.03), atlasUV(k, 4, 2, 0));
          }
        } else if (R() < 0.45) {
          // تكييف جنب الشباك
          const cx = (u0 + u1) / 2 + acSide * bw * 0.36;
          acUnit(get('ac'), toLocal, cx, y0 + 0.75, 0);
        }
      }
      // كرنيشة بين الأدوار
      slabBox(conc, toLocal, -faceLen / 2, y0 - 0.12, 0, faceLen / 2, y0 + 0.02, 0.1);
    }
  };

  // الأمامية: local (u,y,z) = (u, y, z)
  drawFacade(W, (u, y, z) => [u, y, z], true);
  if (opts.facades.left) drawFacade(D, (u, y, z) => [-W / 2 - z, y, -D / 2 + u], false);
  if (opts.facades.right) drawFacade(D, (u, y, z) => [W / 2 + z, y, -D / 2 - u], false);

  // ===== الدور الأرضي: محلات =====
  if (opts.shops === false) {
    // دور أرضي سكني: باب + شبابيك بحديد
    const bays = Math.max(1, Math.round(W / 3.3)), bw = W / bays;
    const door = Math.floor(R() * bays);
    for (let j = 0; j < bays; j++) {
      const u0 = -W / 2 + j * bw;
      if (j === door) get('shop').quad([u0, 0, 0], [u0 + bw, 0, 0], [u0 + bw, 3.6, 0], [u0, 3.6, 0], atlasUV(7));
      else facade.quad([u0, 0, 0], [u0 + bw, 0, 0], [u0 + bw, GF, 0], [u0, GF, 0], atlasUV(6));
    }
    if (door >= 0) facade.quad([-W / 2 + door * bw, 3.6, 0], [-W / 2 + (door + 1) * bw, 3.6, 0], [-W / 2 + (door + 1) * bw, GF, 0], [-W / 2 + door * bw, GF, 0], [[0.02, 0.98], [0.23, 0.98], [0.23, 0.99], [0.02, 0.99]]);
  }
  const shopCount = opts.shops === false ? 0 : Math.max(1, Math.round(W / 3.6));
  const sw = W / shopCount;
  const entrance = Math.floor(R() * shopCount);
  const shop = get('shop');
  const signs = get('signs');
  for (let j = 0; j < shopCount; j++) {
    const u0 = -W / 2 + j * sw, u1 = u0 + sw;
    const isEntrance = j === entrance;
    const cell = isEntrance ? 7 : [1, 2, 3, 4, 6, 0, 5][Math.floor(R() * 7)];
    shop.quad([u0, 0, 0], [u1, 0, 0], [u1, 3.6, 0], [u0, 3.6, 0], atlasUV(cell));
    if (!isEntrance && cell !== 0 && cell !== 5) {
      BUILDING_INFO.push({ local: [(u0 + u1) / 2, 0, 1.2], matrix: m.clone() });
    }
    // اللافتة
    if (!isEntrance) {
      const k = signCounter++ % 64;
      const s0 = u0 + 0.1, s1 = u1 - 0.1;
      slabBox(conc, (u, y, z) => [u, y, z], s0, 3.6, 0, s1, 4.25, 0.22);
      signs.quad([s0, 3.62, 0.235], [s1, 3.62, 0.235], [s1, 4.23, 0.235], [s0, 4.23, 0.235], signUV(k));
      // تندة قماش
      if (R() < 0.35) {
        const aw = get('awning');
        const c = AWNING[Math.floor(R() * AWNING.length)];
        const n = 8;
        for (let s = 0; s < n; s++) {
          aw.setColor(s % 2 ? [0.95, 0.93, 0.88] : c);
          const a = u0 + 0.15 + ((u1 - u0 - 0.3) * s) / n, b = u0 + 0.15 + ((u1 - u0 - 0.3) * (s + 1)) / n;
          aw.quad([a, 2.9, 1.3], [b, 2.9, 1.3], [b, 3.55, 0.02], [a, 3.55, 0.02]);
        }
      }
    }
  }
  // جوانب الدور الأرضي لو الواجهة الجانبية ظاهرة
  if (opts.facades.left) wall.quad([-W / 2, 0, -D], [-W / 2, 0, 0], [-W / 2, GF, 0], [-W / 2, GF, -D], [[0, 0], [D / 3, 0], [D / 3, GF / 3], [0, GF / 3]]);
  if (opts.facades.right) wall.quad([W / 2, 0, 0], [W / 2, 0, -D], [W / 2, GF, -D], [W / 2, GF, 0], [[0, 0], [D / 3, 0], [D / 3, GF / 3], [0, GF / 3]]);

  // ===== السطح: خزانات، دشات، حديد مسلح، أوضة =====
  const tankGeo = new THREE.CylinderGeometry(0.55, 0.55, 1.15, 12);
  const tanks = 1 + Math.floor(R() * 3);
  const tm = get('tank');
  for (let t = 0; t < tanks; t++) {
    const lx = -W / 2 + 1 + R() * (W - 2), lz = -D + 1 + R() * (D - 3);
    tm.addGeometry(tankGeo, new THREE.Matrix4().makeTranslation(lx, H + 0.6, lz));
  }
  const dishGeo = new THREE.SphereGeometry(0.42, 12, 5, 0, Math.PI * 2, 0, 0.75);
  const dm = get('dish');
  const dishes = 1 + Math.floor(R() * 5);
  for (let t = 0; t < dishes; t++) {
    const lx = -W / 2 + 0.6 + R() * (W - 1.2), lz = -0.6 - R() * (D * 0.6);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.0 - R() * 0.2, R() * 0.6 - opts.rotY + 2.4, 0, 'YXZ'));
    dm.addGeometry(dishGeo, new THREE.Matrix4().compose(new THREE.Vector3(lx, H + 1.1, lz), q, new THREE.Vector3(1, 1, 1)));
    get('metal').setColor([0.6, 0.6, 0.6]).box(lx - 0.025, H, lz - 0.025, lx + 0.025, H + 1.0, lz + 0.025);
  }
  if (brick) {
    const rb = get('metal').setColor([0.45, 0.25, 0.15]);
    const cols = Math.round(W / 3.3);
    for (let c = 0; c <= cols; c++) {
      const lx = -W / 2 + 0.15 + (c * (W - 0.3)) / cols;
      for (const lz of [-0.15, -D + 0.15]) for (let k = 0; k < 4; k++) {
        const ox = (k % 2) * 0.12 - 0.06, oz = Math.floor(k / 2) * 0.12 - 0.06;
        rb.box(lx + ox - 0.01, H, lz + oz - 0.01, lx + ox + 0.01, H + 0.8 + R() * 0.5, lz + oz + 0.01);
      }
    }
  }
  if (R() < 0.4) {
    const rw = 3 + R() * 2, rd = 3;
    const lx = -W / 2 + 1 + R() * (W - rw - 2);
    wall.box(lx, H, -D + 1, lx + rw, H + 2.6, -D + 1 + rd, { uvScale: 3, skip: 'ny' });
  }
  return { H };
}

function slabBox(b, toLocal, u0, y0, z0, u1, y1, z1) {
  // صندوق محدد بإحداثيات الواجهة (u,y,z) → نحوله بنقاط
  const P = (u, y, z) => toLocal(u, y, z);
  const q = (a, bb, c, d) => b.quad(a, bb, c, d, [[0, 0], [0.3, 0], [0.3, 0.3], [0, 0.3]]);
  q(P(u0, y0, z1), P(u1, y0, z1), P(u1, y1, z1), P(u0, y1, z1)); // أمام
  q(P(u0, y1, z1), P(u1, y1, z1), P(u1, y1, z0), P(u0, y1, z0)); // فوق
  q(P(u0, y0, z0), P(u1, y0, z0), P(u1, y0, z1), P(u0, y0, z1)); // تحت
  q(P(u1, y0, z1), P(u1, y0, z0), P(u1, y1, z0), P(u1, y1, z1)); // يمين
  q(P(u0, y0, z0), P(u0, y0, z1), P(u0, y1, z1), P(u0, y1, z0)); // شمال
}

function acUnit(b, toLocal, cx, y, z) {
  const w = 0.82, h = 0.56, d = 0.3;
  const P = (u, yy, zz) => toLocal(u, yy, zz);
  const u0 = cx - w / 2, u1 = cx + w / 2, y0 = y, y1 = y + h, z0 = z, z1 = z + d;
  const side = [[0.02, 0.9], [0.05, 0.9], [0.05, 0.95], [0.02, 0.95]];
  b.quad(P(u0, y0, z1), P(u1, y0, z1), P(u1, y1, z1), P(u0, y1, z1), [[0, 0], [1, 0], [1, 1], [0, 1]]);
  b.quad(P(u0, y1, z1), P(u1, y1, z1), P(u1, y1, z0), P(u0, y1, z0), side);
  b.quad(P(u0, y0, z0), P(u1, y0, z0), P(u1, y0, z1), P(u0, y0, z1), side);
  b.quad(P(u1, y0, z1), P(u1, y0, z0), P(u1, y1, z0), P(u1, y1, z1), side);
  b.quad(P(u0, y0, z0), P(u0, y0, z1), P(u0, y1, z1), P(u0, y1, z0), side);
  // حامل حديد
  b.quad(P(u0, y0 - 0.04, z1 + 0.02), P(u1, y0 - 0.04, z1 + 0.02), P(u1, y0, z1 + 0.02), P(u0, y0, z1 + 0.02), side);
}

/** بناء كل عمارات الشارع */
export function buildBuildings(M, { low = false } = {}) {
  const group = new THREE.Group();
  group.name = 'buildings';
  const B = new Buckets();
  const R = rng(4242);
  let seed = 1;
  const SW = ROAD.sidewalkOuter;
  const sideMargin = Math.max(...CROSSINGS.map((c) => c.sidewalk));

  const place = (opts) => buildOne(B, { seed: seed++ * 7919, floors: 4 + Math.floor(R() * 7), style: R() < 0.32 ? 'brick' : 'plaster', facades: {}, detail: low ? 'low' : 'high', ...opts });

  // ===== الشارع الرئيسي =====
  for (const s of [-1, 1]) {
    for (const [zs0, ze0] of mainSegments(sideMargin)) {
      const zs = zs0;
      const ze = ze0;
      const lengths = [];
      let rest = zs - ze;
      while (rest > 0) {
        let w = 9 + R() * 8;
        if (rest - w < 7) w = rest;
        lengths.push(w); rest -= w;
      }
      let z = zs;
      lengths.forEach((w, idx) => {
        const cz = z - w / 2;
        z -= w;
        // الجنب اللي ناحية التقاطع ياخد واجهة
        const atStart = idx === 0 && zs0 !== ROAD.zMax;
        const atEnd = idx === lengths.length - 1 && ze0 !== ROAD.zMin;
        // يمين: rotY=-PI/2 → local +X = world +Z ؛ شمال: rotY=+PI/2 → local +X = world -Z
        const facades = {};
        if (atStart) facades[s > 0 ? 'right' : 'left'] = true;
        if (atEnd) facades[s > 0 ? 'left' : 'right'] = true;
        place({ x: s * SW, z: cz, rotY: s > 0 ? -Math.PI / 2 : Math.PI / 2, width: w, depth: 16, facades });
      });
    }
  }

  // ===== الشوارع الجانبية =====
  for (const c of CROSSINGS) {
    for (const sz of [-1, 1]) {
      const front = c.z + sz * (c.half + c.sidewalk);
      for (const sx of [-1, 1]) {
        let x = SW + 16;
        const end = (sx > 0 ? c.xMax : -c.xMin) + 4;
        while (x < end - 1) {
          let w = 9 + R() * 7;
          if (end - (x + w) < 7) w = end - x;
          const cx = sx * (x + w / 2);
          x += w;
          place({ x: cx, z: front, rotY: sz > 0 ? Math.PI : 0, width: w, depth: 14 });
        }
      }
      // عمارة قافلة نهاية الشارع الجانبي
    }
    for (const sx of [-1, 1]) {
      const xe = sx > 0 ? c.xMax + 4 : c.xMin - 4;
      place({ x: xe, z: c.z, rotY: sx > 0 ? -Math.PI / 2 : Math.PI / 2, width: 2 * (c.half + c.sidewalk) + 2, depth: 14 });
    }
  }

  B.toMeshes({ ...M, winGlass: M.glass }, group);
  group.traverse((o) => { if (o.name === 'winGlass' || o.name === 'clinic') o.castShadow = false; });
  return group;
}
