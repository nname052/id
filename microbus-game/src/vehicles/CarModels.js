import * as THREE from 'three';
import { GeoBuilder } from '../render/GeoBuilder.js';
import { vehicleMaterials } from '../render/materials.js';
import { canvas, tex, makePlate } from '../render/textures.js';
import { buildWheel } from './wheel.js';
import { buildMicrobus } from './MicrobusModel.js';

// عربيات المرور والعربيات المركونة (إجرائية، بدون ماركات)
// sedan = عربية حديثة، boxy = عربية قديمة مربعة (زي العربيات الكلاسيك في مصر)، taxi = تاكسي أبيض بشريط شطرنج

export const CAR_COLORS = [0xe8e8e4, 0xb8bcc0, 0x7a1414, 0x1d2b4a, 0x151515, 0xcfc2a0, 0x2c4a32, 0x8a8f94, 0xdedcd2, 0x5a3a22];

const PROFILES = {
  sedan: {
    R: 0.3, axleF: 1.32, axleR: -1.32, width: 1.76, length: 4.45,
    lower: [[2.15, 0.32], [2.23, 0.5], [2.2, 0.7], [1.95, 0.8], [0.85, 0.93], [-1.5, 0.97], [-2.05, 0.94], [-2.2, 0.82], [-2.22, 0.5], [-2.1, 0.32]],
    cabin: [[0.9, 0.92], [0.22, 1.40], [-0.95, 1.43], [-1.55, 0.96]],
    roof: [[0.2, 1.37], [-0.95, 1.40]],
  },
  boxy: {
    R: 0.28, axleF: 1.2, axleR: -1.22, width: 1.6, length: 4.0,
    lower: [[1.98, 0.33], [2.03, 0.55], [2.02, 0.76], [1.1, 0.83], [-1.55, 0.85], [-1.98, 0.82], [-2.0, 0.55], [-1.96, 0.33]],
    cabin: [[1.1, 0.82], [0.55, 1.33], [-0.78, 1.34], [-1.35, 0.85]],
    roof: [[0.5, 1.30], [-0.8, 1.31]],
  },
};

function profileShape(pts, R, axleF, axleR, withArches) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  if (withArches) {
    const arch = R + 0.08, cy = R, y0 = pts[pts.length - 1][1], dy = y0 - cy;
    const dx = Math.sqrt(arch * arch - dy * dy);
    const a0 = Math.atan2(dy, -dx), a1 = Math.atan2(dy, dx);
    s.lineTo(axleR - dx, y0);
    s.absarc(axleR, cy, arch, a0, a1, true);
    s.lineTo(axleF - dx, y0);
    s.absarc(axleF, cy, arch, a0, a1, true);
  }
  s.lineTo(pts[0][0], pts[0][1]);
  return s;
}

function extrudeSide(shape, width, bevel = 0.04) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: width - 2 * bevel, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3, curveSegments: 10 });
  g.rotateY(Math.PI / 2);
  g.translate(-(width / 2 - bevel), 0, 0);
  return g;
}

let checkerTex = null;
function checker() {
  if (checkerTex) return checkerTex;
  const c = canvas(256, 32);
  const ctx = c.getContext('2d');
  for (let i = 0; i < 16; i++) for (let j = 0; j < 2; j++) { ctx.fillStyle = (i + j) % 2 ? '#111' : '#f4f4f0'; ctx.fillRect(i * 16, j * 16, 16, 16); }
  checkerTex = tex(c);
  return checkerTex;
}
let taxiSignTex = null;
function taxiSign() {
  if (taxiSignTex) return taxiSignTex;
  const c = canvas(256, 64);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f2f2ea'; ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = '#111'; ctx.font = 'bold 40px "Cairo", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.direction = 'rtl';
  ctx.fillText('تاكسي', 128, 34);
  taxiSignTex = tex(c, { repeat: false });
  return taxiSignTex;
}

export function buildCar(type = 'sedan', color = 0xe8e8e4, { plate } = {}) {
  if (type === 'microbus') {
    const rig = buildMicrobus({ interior: false, color, stripe: [0x2a6fb8, 0xb02a2a, 0x2a8a4a][Math.floor(Math.random() * 3)] });
    rig.length = 4.95; rig.width = 1.9; rig.brake = rig.mats.taillight; rig.wheelRadius = 0.33;
    rig.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return rig;
  }
  const isTaxi = type === 'taxi';
  const P = PROFILES[isTaxi ? (Math.random() < 0.5 ? 'sedan' : 'boxy') : type];
  const mats = vehicleMaterials(isTaxi ? 0xf2f2ee : color);
  mats.paint.roughness = 0.35 + Math.random() * 0.25; // تراب
  mats.taillight = mats.taillight.clone();
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const z = (f) => -f;

  const lower = extrudeSide(profileShape(P.lower, P.R, P.axleF, P.axleR, true), P.width);
  const cab = extrudeSide(profileShape(P.cabin, P.R, 0, 0, false), P.width - 0.16, 0.03);
  const parts = new Map();
  const add = (key, g, m) => { if (!parts.has(key)) parts.set(key, new GeoBuilder()); parts.get(key).addGeometry(g, m); };
  const box = (key, x0, y0, z0, x1, y1, z1) => { if (!parts.has(key)) parts.set(key, new GeoBuilder()); parts.get(key).box(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1), Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)); };
  add('paint', lower);
  add('glass', cab);
  // السقف والأعمدة
  const [r0, r1] = P.roof;
  box('paint', -(P.width / 2 - 0.1), r0[1], z(r0[0]), P.width / 2 - 0.1, r1[1] + 0.04, z(r1[0]));
  const cabMid = (P.cabin[1][0] + P.cabin[2][0]) / 2;
  for (const sx of [-1, 1]) {
    box('paint', sx * (P.width / 2 - 0.1), P.lower[4][1], z(cabMid + 0.05), sx * (P.width / 2 - 0.075), r0[1], z(cabMid - 0.05));
  }
  // صدامات وفوانيس
  const fF = P.lower[1][0], fR = P.lower[P.lower.length - 2][0];
  box(type === 'boxy' ? 'chrome' : 'plasticBlack', -P.width / 2, 0.32, z(fF - 0.08), P.width / 2, 0.48, z(fF + 0.05));
  box(type === 'boxy' ? 'chrome' : 'plasticBlack', -P.width / 2, 0.32, z(fR + 0.08), P.width / 2, 0.48, z(fR - 0.05));
  for (const sx of [-1, 1]) {
    box('headlight', sx * (P.width / 2 - 0.42), 0.58, z(fF - 0.02), sx * (P.width / 2 - 0.1), 0.70, z(fF + 0.01));
    box('taillight', sx * (P.width / 2 - 0.4), 0.62, z(fR + 0.02), sx * (P.width / 2 - 0.08), 0.74, z(fR - 0.01));
    box('plasticBlack', sx * (P.width / 2 + 0.06), 0.95, z(P.cabin[0][0] - 0.12), sx * (P.width / 2 - 0.02), 1.05, z(P.cabin[0][0] - 0.22));
  }
  box('plasticBlack', -0.45, 0.5, z(fF + 0.005), 0.45, 0.66, z(fF + 0.02));
  box('underbody', -P.width / 2 + 0.1, 0.25, z(fF - 0.1), P.width / 2 - 0.1, 0.33, z(fR + 0.1));

  if (isTaxi) {
    mats.checker = new THREE.MeshStandardMaterial({ map: checker(), roughness: 0.4 });
    for (const sx of [-1, 1]) {
      const x = sx * (P.width / 2 + 0.003);
      const g = new THREE.PlaneGeometry(fF - fR - 0.3, 0.1);
      g.rotateY(sx * Math.PI / 2);
      const pos = g.attributes.uv;
      for (let i = 0; i < pos.count; i++) pos.setX(i, pos.getX(i) * (fF - fR) / 1.6);
      add('checker', g, new THREE.Matrix4().makeTranslation(x, 0.72, z((fF + fR) / 2)));
    }
    mats.checker.map.wrapS = THREE.RepeatWrapping;
    mats.sign = new THREE.MeshStandardMaterial({ map: taxiSign(), emissive: 0xffffff, emissiveMap: taxiSign(), emissiveIntensity: 0.2 });
    const sg = new THREE.BoxGeometry(0.55, 0.16, 0.18);
    add('sign', sg, new THREE.Matrix4().makeTranslation(0, r1[1] + 0.12, z((r0[0] + r1[0]) / 2)));
  }

  // لوحة
  mats.plate = new THREE.MeshStandardMaterial({ map: makePlate(plate || randomPlate(isTaxi)), roughness: 0.4 });
  add('plate', new THREE.PlaneGeometry(0.36, 0.15).rotateY(Math.PI), new THREE.Matrix4().makeTranslation(0, 0.42, z(fF + 0.06)));
  add('plate', new THREE.PlaneGeometry(0.36, 0.15), new THREE.Matrix4().makeTranslation(0, 0.42, z(fR - 0.06)));

  for (const [key, gb] of parts) {
    const mesh = new THREE.Mesh(gb.build(), mats[key]);
    mesh.userData.role = key;
    mesh.castShadow = key !== 'glass';
    mesh.receiveShadow = true;
    body.add(mesh);
  }

  const wheels = [];
  const t = P.width / 2 - 0.16;
  for (const [x, f, front] of [[-t, P.axleF, true], [t, P.axleF, true], [-t, P.axleR, false], [t, P.axleR, false]]) {
    const w = buildWheel({ radius: P.R, width: 0.19, rimRadius: P.R * 0.55, mats, style: type === 'boxy' ? 'steel' : 'alloy', side: Math.sign(x) });
    w.group.position.set(x, P.R, z(f));
    root.add(w.group);
    wheels.push({ ...w, front });
  }
  // ضل ناعم تحت العربية (Fake AO)
  root.add(contactShadow(P.width + 0.3, P.length + 0.3));
  return { root, body, wheels, mats, length: P.length, width: P.width, brake: mats.taillight, wheelRadius: P.R };
}

function randomPlate(taxi) {
  const L = 'أبجدهوزحطيكلمنسعفصقرشتثخذضظغ';
  const l = () => L[Math.floor(Math.random() * L.length)];
  const d = () => '٠١٢٣٤٥٦٧٨٩'[Math.floor(Math.random() * 10)];
  return `${l()} ${l()} ${taxi ? '' : l()} ${d()}${d()}${d()}${d()}`;
}

let shadowTex = null;
export function contactShadow(w, l) {
  if (!shadowTex) {
    const c = canvas(128, 128);
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 10, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,0.75)'); g.addColorStop(0.6, 'rgba(255,255,255,0.4)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
    shadowTex = tex(c, { srgb: false, repeat: false });
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ alphaMap: shadowTex, transparent: true, depthWrite: false, color: 0x000000, opacity: 0.8, polygonOffset: true, polygonOffsetFactor: -4 }));
  m.position.y = 0.012;
  m.renderOrder = 1;
  m.userData.role = 'shadow';
  return m;
}
