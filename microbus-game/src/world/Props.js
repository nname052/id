import * as THREE from 'three';
import { Buckets } from '../render/GeoBuilder.js';
import { rng } from '../render/textures.js';
import { ROAD, CROSSINGS, mainSegments } from './layout.js';

// أعمدة إنارة، شجر (بجذوع مدهونة أبيض زي مصر)، نخل على الجزيرة، كشك، قهوة، عربية فول،
// سلوك كهربا، زينة رمضان. كله متجمع في عدد قليل من الـ Meshes.

export const LAMP_POSITIONS = []; // أماكن لمبات الإنارة (للإضاءة بالليل)
export const PROP_COLLIDERS = [];

const Y = new THREE.Vector3(0, 1, 0);
const mat4 = (x, y, z, ry = 0, s = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(Y, ry), new THREE.Vector3(s, s, s));

function nearCrossing(z, m) { return CROSSINGS.some((c) => Math.abs(z - c.z) < c.half + m); }

export function buildProps(M) {
  const group = new THREE.Group();
  group.name = 'props';
  const B = new Buckets();
  const R = rng(777);
  const h = ROAD.sidewalkHeight;

  // ===== أعمدة الإنارة =====
  const pole = new THREE.CylinderGeometry(0.07, 0.12, 8.5, 8).translate(0, 4.25, 0);
  const base = new THREE.CylinderGeometry(0.2, 0.24, 0.6, 8).translate(0, 0.3, 0);
  const arm = new THREE.CylinderGeometry(0.045, 0.05, 2.4, 6).rotateZ(Math.PI / 2).translate(1.1, 8.3, 0);
  const head = new THREE.BoxGeometry(0.75, 0.16, 0.32).translate(2.25, 8.25, 0);
  const glass = new THREE.BoxGeometry(0.6, 0.05, 0.24).translate(2.25, 8.15, 0);
  const lamp = (x, z, ry, double = false) => {
    const m = mat4(x, h, z, ry);
    const met = B.get('paintedMetal').setColor([0.42, 0.44, 0.45]);
    for (const g of [pole, base, arm, head]) met.addGeometry(g, m);
    B.get('lampGlass').addGeometry(glass, m);
    LAMP_POSITIONS.push(new THREE.Vector3(2.25, 8.0, 0).applyMatrix4(m));
    if (double) {
      const m2 = mat4(x, h, z, ry + Math.PI);
      met.addGeometry(arm, m2); met.addGeometry(head, m2);
      B.get('lampGlass').addGeometry(glass, m2);
      LAMP_POSITIONS.push(new THREE.Vector3(2.25, 8.0, 0).applyMatrix4(m2));
    }
  };
  for (const [zs, ze] of mainSegments(3)) {
    for (let z = zs - 8; z > ze + 4; z -= 34) {
      lamp(ROAD.curb + 0.5, z, Math.PI, false);       // يمين: الدراع ناحية -X
      lamp(-ROAD.curb - 0.5, z - 17, 0, false);
    }
  }
  for (const [zs, ze] of mainSegments(6)) {
    for (let z = zs - 12; z > ze + 6; z -= 40) lamp(0, z, 0, true);
  }

  // ===== شجر فيكس =====
  const trunkLow = new THREE.CylinderGeometry(0.17, 0.22, 1.3, 8).translate(0, 0.65, 0);
  const trunkHigh = new THREE.CylinderGeometry(0.12, 0.17, 2.6, 7).translate(0, 2.6, 0);
  const card = new THREE.PlaneGeometry(2.4, 2.4);
  const tree = (x, z, scale = 1) => {
    const m = mat4(x, h, z, R() * 6, scale);
    B.get('trunk').setColor([0.92, 0.92, 0.88]).addGeometry(trunkLow, m);
    B.get('trunk').setColor([0.33, 0.27, 0.2]).addGeometry(trunkHigh, m);
    // حوض الشجرة
    B.get('curb').setTransform(new THREE.Matrix4()).box(x - 0.6, 0, z - 0.6, x + 0.6, h + 0.1, z + 0.6, { uvScale: 1.2, skip: 'ny' });
    const leaves = B.get('leaves');
    for (let i = 0; i < 16; i++) {
      const a = R() * Math.PI * 2, r = R() * 1.5, y = 3.8 + R() * 2.4;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((R() - 0.5) * 1.2, R() * Math.PI, (R() - 0.5) * 0.8));
      const lm = new THREE.Matrix4().compose(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r), q, new THREE.Vector3(1, 1, 1));
      leaves.addGeometry(card, new THREE.Matrix4().multiplyMatrices(m, lm));
    }
    PROP_COLLIDERS.push({ x, z, r: 0.3 });
  };
  for (const s of [-1, 1]) {
    for (const [zs, ze] of mainSegments(5)) {
      for (let z = zs - 4 - R() * 6; z > ze + 3; z -= 12 + R() * 10) {
        if (R() < 0.25) continue;
        tree(s * (ROAD.curb + 1.2), z, 0.85 + R() * 0.4);
      }
    }
  }
  for (const c of CROSSINGS) for (const sz of [-1, 1]) for (let x = 20; x < c.xMax - 5; x += 14 + R() * 8) {
    if (R() < 0.4) continue;
    tree((R() < 0.5 ? -1 : 1) * x, c.z + sz * (c.half + 1.1), 0.8 + R() * 0.3);
  }

  // ===== نخل على الجزيرة =====
  const palmTrunk = new THREE.CylinderGeometry(0.16, 0.24, 7.5, 8, 6).translate(0, 3.75, 0);
  const frond = new THREE.PlaneGeometry(0.9, 3.4, 1, 4).translate(0, 1.7, 0);
  {
    // انحناء السعف
    const p = frond.attributes.position;
    for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setZ(i, (y * y) * 0.14); }
    frond.computeVertexNormals();
  }
  const palm = (x, z) => {
    const m = mat4(x, 0.24, z, R() * 6, 0.9 + R() * 0.25);
    B.get('trunk').setColor([0.45, 0.38, 0.3]).addGeometry(palmTrunk, m);
    for (let i = 0; i < 11; i++) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.0 - R() * 0.5, (i / 11) * Math.PI * 2 + R() * 0.3, 0, 'YXZ'));
      const fm = new THREE.Matrix4().compose(new THREE.Vector3(0, 7.4, 0), q, new THREE.Vector3(1, 1, 1));
      B.get('palm').addGeometry(frond, new THREE.Matrix4().multiplyMatrices(m, fm));
    }
  };
  for (const [zs, ze] of mainSegments(8)) for (let z = zs - 25; z > ze + 5; z -= 40) palm(0, z);

  // ===== كشك =====
  const kiosk = (x, z, ry) => {
    const m = mat4(x, h, z, ry);
    const b = B.get('plastic').setTransform(m);
    b.setColor([0.15, 0.35, 0.6]).box(-1.1, 0, -0.9, 1.1, 2.4, 0.9, { skip: 'ny' });
    b.setColor([0.9, 0.85, 0.2]).box(-1.3, 2.4, -1.1, 1.3, 2.55, 1.6);
    b.setColor([0.85, 0.1, 0.1]).box(-1.0, 0.9, 0.9, 1.0, 1.1, 1.05);
    // بضاعة ملونة متعلقة
    for (let i = 0; i < 18; i++) {
      b.setColor([R(), R(), R() * 0.5 + 0.3]);
      const px = -1 + (i % 9) * 0.22, py = 1.3 + Math.floor(i / 9) * 0.45;
      b.box(px, py, 0.92, px + 0.16, py + 0.3, 1.0);
    }
    // تلاجة حاجة ساقعة قدام الكشك
    b.setColor([0.85, 0.1, 0.1]).box(1.3, 0, 0.2, 2.0, 1.8, 0.9);
    b.setColor([0.6, 0.75, 0.85]).box(1.36, 0.3, 0.9, 1.94, 1.6, 0.92);
    PROP_COLLIDERS.push({ x, z, r: 1.4 });
    b.identity();
  };
  kiosk(ROAD.curb + 2.6, 52, -Math.PI / 2);
  kiosk(-ROAD.curb - 2.6, -95, Math.PI / 2);
  kiosk(ROAD.curb + 2.6, -205, -Math.PI / 2);

  // ===== قهوة بلدي: كراسي وترابيزات =====
  const cafe = (x0, z0, dir) => {
    const b = B.get('plastic');
    for (let i = 0; i < 6; i++) {
      const tx = x0 + dir * (0.6 + (i % 2) * 1.6), tz = z0 + Math.floor(i / 2) * 2.2;
      const m = mat4(tx, h, tz, R() * 6);
      b.setTransform(m).setColor([0.92, 0.92, 0.9]);
      b.box(-0.3, 0.68, -0.3, 0.3, 0.72, 0.3); b.box(-0.03, 0, -0.03, 0.03, 0.7, 0.03);
      for (const [cx, cz] of [[0.55, 0], [-0.55, 0]]) {
        const cm = new THREE.Matrix4().multiplyMatrices(m, mat4(cx, 0, cz, cx > 0 ? -Math.PI / 2 : Math.PI / 2));
        b.setTransform(cm).setColor(R() < 0.5 ? [0.9, 0.9, 0.88] : [0.2, 0.4, 0.75]);
        b.box(-0.22, 0.42, -0.22, 0.22, 0.46, 0.22);
        b.box(-0.22, 0.46, -0.24, 0.22, 0.9, -0.2);
        for (const [lx, lz] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) b.box(lx - 0.02, 0, lz - 0.02, lx + 0.02, 0.42, lz + 0.02);
      }
    }
    b.identity();
  };
  cafe(ROAD.curb + 1.0, 118, 1);
  cafe(-ROAD.curb - 1.0, 30, -1);
  cafe(ROAD.curb + 1.0, -140, 1);

  // ===== عربية فول =====
  const cart = (x, z) => {
    const m = mat4(x, h, z, Math.PI / 2);
    const b = B.get('plastic').setTransform(m);
    b.setColor([0.15, 0.5, 0.3]).box(-1, 0.5, -0.5, 1, 1.0, 0.5);
    b.setColor([0.85, 0.75, 0.2]).box(-1, 1.0, -0.5, 1, 1.05, 0.5);
    b.setColor([0.75, 0.75, 0.78]);
    b.addGeometry(new THREE.CylinderGeometry(0.28, 0.24, 0.5, 14), new THREE.Matrix4().makeTranslation(-0.4, 1.3, 0));
    b.setColor([0.1, 0.1, 0.1]);
    b.addGeometry(new THREE.CylinderGeometry(0.4, 0.4, 0.08, 14).rotateX(Math.PI / 2), new THREE.Matrix4().makeTranslation(0, 0.4, 0.55));
    b.addGeometry(new THREE.CylinderGeometry(0.4, 0.4, 0.08, 14).rotateX(Math.PI / 2), new THREE.Matrix4().makeTranslation(0, 0.4, -0.55));
    b.setColor([0.9, 0.2, 0.2]).box(-1.05, 1.05, -0.55, 1.05, 2.1, -0.5);
    b.identity();
    PROP_COLLIDERS.push({ x, z, r: 1.1 });
  };
  cart(-ROAD.curb - 1.5, 85);
  cart(ROAD.curb + 1.5, -40);

  B.toMeshes(M, group);
  group.traverse((o) => { if (o.name === 'lampGlass') o.castShadow = false; });

  // ===== سلوك كهربا و زينة رمضان =====
  const wirePts = [];
  const sag = (a, b, n, s, out) => {
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n;
      const p0 = a.clone().lerp(b, t0); p0.y -= Math.sin(Math.PI * t0) * s;
      const p1 = a.clone().lerp(b, t1); p1.y -= Math.sin(Math.PI * t1) * s;
      out.push(p0, p1);
    }
  };
  for (let z = ROAD.zMax - 20; z > ROAD.zMin + 20; z -= 25 + R() * 30) {
    if (nearCrossing(z, 8)) continue;
    const y0 = 6 + R() * 6, y1 = 6 + R() * 6;
    sag(new THREE.Vector3(-ROAD.sidewalkOuter - 0.2, y0, z), new THREE.Vector3(ROAD.sidewalkOuter + 0.2, y1, z + (R() - 0.5) * 8), 16, 1 + R(), wirePts);
  }
  const wires = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(wirePts), new THREE.LineBasicMaterial({ color: 0x111111 }));
  group.add(wires);

  // زينة رمضان: مثلثات ملونة
  const flagB = new Buckets();
  const fb = flagB.get('cloth');
  for (const zf of [128, 72, -32, -88, -190]) {
    const a = new THREE.Vector3(-ROAD.sidewalkOuter, 7.5, zf), b = new THREE.Vector3(ROAD.sidewalkOuter, 7.5, zf + 3);
    const n = 46;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const p = a.clone().lerp(b, t); p.y -= Math.sin(Math.PI * t) * 1.6;
      const d = b.clone().sub(a).normalize().multiplyScalar(0.25);
      fb.setColor([[0.9, 0.15, 0.1], [0.1, 0.5, 0.9], [0.95, 0.8, 0.1], [0.1, 0.65, 0.3], [0.9, 0.9, 0.9]][i % 5]);
      fb.quad([p.x - d.x, p.y, p.z - d.z], [p.x + d.x, p.y, p.z + d.z], [p.x, p.y - 0.45, p.z], [p.x, p.y - 0.45, p.z]);
    }
    sag(a, b, 20, 1.6, wirePts);
  }
  flagB.toMeshes(M, group, { castShadow: true });
  wires.geometry.dispose();
  wires.geometry = new THREE.BufferGeometry().setFromPoints(wirePts);

  return group;
}
