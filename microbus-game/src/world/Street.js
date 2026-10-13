import * as THREE from 'three';
import { Buckets } from '../render/GeoBuilder.js';
import { rng } from '../render/textures.js';
import { ROAD, CROSSINGS, BUMPS, MANHOLES, POTHOLES, mainSegments } from './layout.js';

// بناء سطح الطريق والأرصفة والخطوط والتفاصيل الصغيرة
export function buildStreet(M) {
  const group = new THREE.Group();
  group.name = 'street';
  const B = new Buckets();
  const R = rng(3);
  const UV = 7; // متر لكل تكرار للأسفلت

  // ===== الأسفلت =====
  const asphalt = B.get('asphalt');
  const roadQuad = (x0, x1, z0, z1, y = 0) => {
    // مقسم لقطع عشان الـ fog والدقة
    const step = 30;
    for (let z = z0; z < z1; z += step) {
      const ze = Math.min(z1, z + step);
      asphalt.setColor([0.96 + R() * 0.08, 0.96 + R() * 0.08, 0.96 + R() * 0.08]);
      asphalt.quad([x0, y, ze], [x1, y, ze], [x1, y, z], [x0, y, z], [[x0 / UV, ze / UV], [x1 / UV, ze / UV], [x1 / UV, z / UV], [x0 / UV, z / UV]]);
    }
  };
  roadQuad(-ROAD.curb, ROAD.curb, ROAD.zMin - 4, ROAD.zMax + 4);
  for (const c of CROSSINGS) {
    for (const [a, b] of [[c.xMin - 4, -ROAD.curb], [ROAD.curb, c.xMax + 4]]) {
      asphalt.setColor([0.93, 0.93, 0.93]);
      asphalt.quad([a, 0, c.z + c.half], [b, 0, c.z + c.half], [b, 0, c.z - c.half], [a, 0, c.z - c.half],
        [[a / UV, (c.z + c.half) / UV], [b / UV, (c.z + c.half) / UV], [b / UV, (c.z - c.half) / UV], [a / UV, (c.z - c.half) / UV]]);
    }
  }

  // ===== المطبات (نفس بروفايل الفيزياء بالظبط) =====
  for (const b of BUMPS) {
    const n = 10;
    asphalt.setColor([1.08, 1.06, 1.02]);
    for (let i = 0; i < n; i++) {
      const d0 = -b.half + (2 * b.half * i) / n, d1 = -b.half + (2 * b.half * (i + 1)) / n;
      const h0 = b.height * 0.5 * (1 + Math.cos((Math.PI * d0) / b.half)) + 0.003;
      const h1 = b.height * 0.5 * (1 + Math.cos((Math.PI * d1) / b.half)) + 0.003;
      const z0 = b.z + d0, z1 = b.z + d1;
      asphalt.quad([b.xMin, h1, z1], [b.xMax, h1, z1], [b.xMax, h0, z0], [b.xMin, h0, z0],
        [[b.xMin / UV, z1 / UV], [b.xMax / UV, z1 / UV], [b.xMax / UV, z0 / UV], [b.xMin / UV, z0 / UV]]);
    }
    // خطوط دهان على المطب (باهتة)
    const paint = B.get('paintYellow');
    for (let x = b.xMin + 0.3; x < b.xMax - 0.6; x += 1.2) {
      paint.quad([x, b.height + 0.006, b.z + 0.12], [x + 0.6, b.height + 0.006, b.z + 0.12], [x + 0.6, b.height + 0.006, b.z - 0.12], [x, b.height + 0.006, b.z - 0.12]);
    }
  }

  // ===== خطوط الطريق =====
  const paint = B.get('paint');
  const y = 0.006;
  const strip = (x0, x1, z0, z1, b = paint) => b.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0],
    [[x0 * 0.3, z1 * 0.05], [x1 * 0.3, z1 * 0.05], [x1 * 0.3, z0 * 0.05], [x0 * 0.3, z0 * 0.05]]);
  for (const [zs, ze] of mainSegments(5)) {
    for (const s of [-1, 1]) {
      // خط متقطع بين الحارتين
      for (let z = ze; z < zs - 3; z += 9) strip(s * 4.2 - 0.06, s * 4.2 + 0.06, z, z + 3);
      // خط حارة الركن
      for (let z = ze; z < zs - 1; z += 4) strip(s * ROAD.parkLine - 0.05, s * ROAD.parkLine + 0.05, z, z + 1.2);
    }
  }
  for (const c of CROSSINGS) {
    // زيبرا (عبور مشاة) + خط الوقوف
    for (const s of [-1, 1]) {
      const zc = c.z + s * (c.half + 2.2);
      for (let x = -ROAD.curb + 0.5; x < ROAD.curb - 0.5; x += 1.0) {
        if (Math.abs(x + 0.25) < ROAD.medianHalf + 0.2) continue;
        strip(x, x + 0.5, zc - 1.5, zc + 1.5);
      }
      const zs = c.z + s * (c.half + 4.4);
      if (s > 0) strip(0.7, ROAD.curb - 0.3, zs - 0.2, zs + 0.2); else strip(-ROAD.curb + 0.3, -0.7, zs - 0.2, zs + 0.2);
    }
    // زيبرا على الشارع الجانبي
    for (const s of [-1, 1]) {
      const xc = s * (ROAD.curb + 2.4);
      for (let z = c.z - c.half + 0.5; z < c.z + c.half - 0.5; z += 1.0) paint.quad([xc - 1.4, y, z + 0.5], [xc + 1.4, y, z + 0.5], [xc + 1.4, y, z], [xc - 1.4, y, z]);
      for (let x = ROAD.curb + 6; x < c.xMax - 3; x += 9) {
        strip(s * x, s * x + s * 3, c.z - 0.06, c.z + 0.06);
      }
    }
  }

  // ===== رقع أسفلت وبقع زيت وآثار عجل =====
  const stains = B.get('stain');
  for (let i = 0; i < 160; i++) {
    const z = ROAD.zMin + R() * (ROAD.zMax - ROAD.zMin);
    const lane = ROAD.lanes[R() < 0.5 ? 0 : 1] * (R() < 0.5 ? -1 : 1);
    const x = lane + (R() - 0.5) * 2.4;
    const s = 0.4 + R() * 1.4, a = R() * Math.PI;
    const dark = 0.2 + R() * 0.5;
    stains.setColor([dark, dark, dark]);
    const c = Math.cos(a) * s, sn = Math.sin(a) * s;
    stains.quad([x - c + sn, 0.004, z - sn - c], [x - c - sn, 0.004, z - sn + c], [x + c - sn, 0.004, z + sn + c], [x + c + sn, 0.004, z + sn - c]);
  }
  // آثار العجل الغامقة في نص كل حارة
  for (const s of [-1, 1]) for (const lane of ROAD.lanes) for (const off of [-0.8, 0.8]) {
    const x = s * lane + off;
    for (const [zs, ze] of mainSegments(0)) {
      stains.setColor([0.75, 0.75, 0.75]);
      for (let z = ze; z < zs; z += 6) stains.quad([x - 0.35, 0.003, z + 6.5], [x + 0.35, 0.003, z + 6.5], [x + 0.35, 0.003, z], [x - 0.35, 0.003, z], [[0.15, 0.5], [0.85, 0.5], [0.85, 0.5], [0.15, 0.5]]);
    }
  }
  const patch = B.get('patch');
  for (let i = 0; i < 18; i++) {
    const z = ROAD.zMin + 10 + R() * (ROAD.zMax - ROAD.zMin - 20);
    const x = (R() - 0.5) * 16;
    if (Math.abs(x) < 1) continue;
    const w = 1 + R() * 3, l = 1 + R() * 4;
    patch.quad([x, 0.003, z + l], [x + w, 0.003, z + l], [x + w, 0.003, z], [x, 0.003, z], [[x / 7, (z + l) / 7], [(x + w) / 7, (z + l) / 7], [(x + w) / 7, z / 7], [x / 7, z / 7]]);
  }

  // ===== أرصفة =====
  const top = B.get('sidewalkTop');
  const curb = B.get('curb');
  const h = ROAD.sidewalkHeight;
  const sidewalk = (x0, x1, z0, z1, curbSides) => {
    top.setColor([0.95 + R() * 0.1, 0.95 + R() * 0.1, 0.95 + R() * 0.1]);
    top.quad([x0, h, z1], [x1, h, z1], [x1, h, z0], [x0, h, z0], [[x0 / 2, z1 / 2], [x1 / 2, z1 / 2], [x1 / 2, z0 / 2], [x0 / 2, z0 / 2]]);
    // جوانب الحرف (الأبيض والأسود)
    const L = (a, b) => [[a, 0], [b, 0], [b, 1], [a, 1]];
    if (curbSides.includes('px')) curb.quad([x1, 0, z1], [x1, 0, z0], [x1, h, z0], [x1, h, z1], L(z1, z0));
    if (curbSides.includes('nx')) curb.quad([x0, 0, z0], [x0, 0, z1], [x0, h, z1], [x0, h, z0], L(z0, z1));
    if (curbSides.includes('pz')) curb.quad([x0, 0, z1], [x1, 0, z1], [x1, h, z1], [x0, h, z1], L(x0, x1));
    if (curbSides.includes('nz')) curb.quad([x1, 0, z0], [x0, 0, z0], [x0, h, z0], [x1, h, z0], L(x1, x0));
  };
  for (const [zs, ze] of mainSegments(0)) {
    sidewalk(ROAD.curb, ROAD.sidewalkOuter + 0.4, ze, zs, ['nx', 'pz', 'nz']);
    sidewalk(-ROAD.sidewalkOuter - 0.4, -ROAD.curb, ze, zs, ['px', 'pz', 'nz']);
  }
  for (const c of CROSSINGS) {
    for (const s of [-1, 1]) {
      const z0 = s > 0 ? c.z + c.half : c.z - c.half - c.sidewalk;
      const z1 = s > 0 ? c.z + c.half + c.sidewalk : c.z - c.half;
      const side = s > 0 ? ['nz'] : ['pz'];
      sidewalk(ROAD.sidewalkOuter + 0.4, c.xMax + 4, z0, z1, side);
      sidewalk(c.xMin - 4, -ROAD.sidewalkOuter - 0.4, z0, z1, side);
    }
  }
  // نهايات الشوارع: رصيف عرضي
  sidewalk(-ROAD.sidewalkOuter, ROAD.sidewalkOuter, ROAD.zMax + 4, ROAD.zMax + 9, ['nz']);
  sidewalk(-ROAD.sidewalkOuter, ROAD.sidewalkOuter, ROAD.zMin - 9, ROAD.zMin - 4, ['pz']);

  // ===== الجزيرة الوسطى =====
  const dirt = B.get('dirt');
  for (const [zs, ze] of mainSegments(4.5)) {
    const x0 = -ROAD.medianHalf, x1 = ROAD.medianHalf, mh = 0.24;
    dirt.quad([x0, mh, zs], [x1, mh, zs], [x1, mh, ze], [x0, mh, ze], [[0, zs / 2], [1, zs / 2], [1, ze / 2], [0, ze / 2]]);
    const cy = B.get('curbYellow');
    const L = (a, b) => [[a, 0], [b, 0], [b, 1], [a, 1]];
    cy.quad([x1, 0, zs], [x1, 0, ze], [x1, mh, ze], [x1, mh, zs], L(zs, ze));
    cy.quad([x0, 0, ze], [x0, 0, zs], [x0, mh, zs], [x0, mh, ze], L(ze, zs));
    cy.quad([x0, 0, zs], [x1, 0, zs], [x1, mh, zs], [x0, mh, zs], L(0, 1.4));
    cy.quad([x1, 0, ze], [x0, 0, ze], [x0, mh, ze], [x1, mh, ze], L(0, 1.4));
  }

  // ===== أرضية بعيدة تحت كل حاجة =====
  const ground = B.get('concrete');
  ground.setColor([0.55, 0.52, 0.48]);
  ground.quad([-400, -0.05, 400], [400, -0.05, 400], [400, -0.05, -500], [-400, -0.05, -500], [[0, 0], [100, 0], [100, 100], [0, 100]]);

  B.toMeshes(M, group, { castShadow: false });

  // ===== غطيان البلاعات (Mesh منفصل) =====
  const mhGeo = new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2);
  const inst = new THREE.InstancedMesh(mhGeo, M.manhole, MANHOLES.length);
  const m4 = new THREE.Matrix4();
  MANHOLES.forEach((m, i) => { m4.compose(new THREE.Vector3(m.x, -0.004, m.z), new THREE.Quaternion(), new THREE.Vector3(m.r, 1, m.r)); inst.setMatrixAt(i, m4); });
  inst.receiveShadow = true;
  group.add(inst);
  // الحفر: دائرة غامقة
  const phGeo = new THREE.CircleGeometry(1, 16).rotateX(-Math.PI / 2);
  const phMat = new THREE.MeshStandardMaterial({ color: 0x2a2826, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const ph = new THREE.InstancedMesh(phGeo, phMat, POTHOLES.length);
  POTHOLES.forEach((p, i) => { m4.compose(new THREE.Vector3(p.x, -p.depth * 0.4, p.z), new THREE.Quaternion(), new THREE.Vector3(p.r, 1, p.r * (0.7 + (i % 3) * 0.15))); ph.setMatrixAt(i, m4); });
  ph.receiveShadow = true;
  group.add(ph);

  return group;
}
