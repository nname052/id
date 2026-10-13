import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GeoBuilder } from '../render/GeoBuilder.js';
import { vehicleMaterials } from '../render/materials.js';
import { makeGauge, makeSeatFabric, makePlate, makeTextDecal } from '../render/textures.js';
import { buildWheel } from './wheel.js';
import { canvas, tex } from '../render/textures.js';
import { MICROBUS_SPEC } from '../physics/VehiclePhysics.js';

// ميكروباص مصري أبيض (شكل عام مستوحى من الميكروباصات المنتشرة، بدون أي شعارات).
// الإحداثيات: X يمين، Y فوق، Z لورا (المقدمة ناحية -Z). نقطة الأصل = الأرض تحت مركز الثقل.
// f = المسافة للأمام من مركز الثقل (z = -f)

const S = MICROBUS_SPEC;
const HALF_W = 0.94;
const FRONT_AXLE = S.cgToFront;                 // f = 1.25
const REAR_AXLE = -(S.wheelBase - S.cgToFront); // f = -1.35
const R = S.wheelRadius;

/** يجمع القطع الثابتة حسب الخامة في Mesh واحد لكل خامة (أداء أفضل) */
class Kit {
  constructor() { this.b = new Map(); }
  add(key, geom, matrix = new THREE.Matrix4()) {
    if (!this.b.has(key)) this.b.set(key, new GeoBuilder());
    this.b.get(key).addGeometry(geom, matrix);
  }
  box(key, x0, y0, z0, x1, y1, z1, opts) {
    if (!this.b.has(key)) this.b.set(key, new GeoBuilder());
    this.b.get(key).box(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1), Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1), opts);
  }
  quad(key, a, b, c, d, uv) {
    if (!this.b.has(key)) this.b.set(key, new GeoBuilder());
    this.b.get(key).quad(a, b, c, d, uv);
  }
  build(mats, parent, shadows = true) {
    for (const [key, gb] of this.b) {
      if (gb.empty) continue;
      const mesh = new THREE.Mesh(gb.build(), mats[key]);
      mesh.name = key;
      mesh.userData.role = key;
      mesh.castShadow = shadows && !['glass', 'windshield', 'decal', 'gaugeGlow'].includes(key);
      mesh.receiveShadow = true;
      parent.add(mesh);
    }
  }
}

const M4 = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1) => new THREE.Matrix4().compose(
  new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(s, s, s));

function roundedRectPath(path, f0, y0, f1, y1, r) {
  path.moveTo(f0 + r, y0);
  path.lineTo(f1 - r, y0); path.quadraticCurveTo(f1, y0, f1, y0 + r);
  path.lineTo(f1, y1 - r); path.quadraticCurveTo(f1, y1, f1 - r, y1);
  path.lineTo(f0 + r, y1); path.quadraticCurveTo(f0, y1, f0, y1 - r);
  path.lineTo(f0, y0 + r); path.quadraticCurveTo(f0, y0, f0 + r, y0);
  return path;
}

/** بروفايل جانب الميكروباص (f, y) مع فتحات العجل */
function sideShape(withWindows = true) {
  const s = new THREE.Shape();
  const arch = 0.45, cy = R, dy = 0.40 - cy, dx = Math.sqrt(arch * arch - dy * dy);
  const a0 = Math.atan2(dy, -dx), a1 = Math.atan2(dy, dx);
  s.moveTo(2.25, 0.40);
  s.lineTo(2.32, 0.52);
  s.lineTo(2.335, 0.86);
  s.quadraticCurveTo(2.33, 0.98, 2.24, 1.01);
  s.lineTo(1.86, 1.12);
  s.lineTo(1.34, 2.08);
  s.quadraticCurveTo(1.30, 2.20, 1.18, 2.21);
  s.lineTo(-2.42, 2.22);
  s.quadraticCurveTo(-2.58, 2.22, -2.6, 2.10);
  s.lineTo(-2.62, 0.52);
  s.quadraticCurveTo(-2.62, 0.40, -2.55, 0.40);
  s.lineTo(REAR_AXLE - dx, 0.40);
  s.absarc(REAR_AXLE, cy, arch, a0, a1, true);
  s.lineTo(FRONT_AXLE - dx, 0.40);
  s.absarc(FRONT_AXLE, cy, arch, a0, a1, true);
  s.lineTo(2.25, 0.40);
  if (withWindows) {
    for (const w of WINDOWS) s.holes.push(windowPath(w));
  }
  return s;
}

const WINDOWS = [
  { pts: [[1.72, 1.26], [1.36, 1.96], [0.55, 1.96], [0.55, 1.26]], kind: 'door' },
  { rect: [-0.62, 1.30, 0.42, 1.98] },
  { rect: [-1.72, 1.30, -0.72, 1.98] },
  { rect: [-2.46, 1.30, -1.82, 1.98] },
];

function windowPath(w) {
  const p = new THREE.Path();
  if (w.pts) {
    p.moveTo(w.pts[0][0], w.pts[0][1]);
    for (let i = 1; i < w.pts.length; i++) p.lineTo(w.pts[i][0], w.pts[i][1]);
    p.lineTo(w.pts[0][0], w.pts[0][1]);
  } else {
    roundedRectPath(p, w.rect[0], w.rect[1], w.rect[2], w.rect[3], 0.06);
  }
  return p;
}

/** يحول Shape (f,y) لـ geometry جانبية عند x */
function sidePanel(shape, x0, depth) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 10 });
  g.rotateY(Math.PI / 2); // shape.x(f) → -z ، extrude → +x
  g.translate(x0, 0, 0);
  return g;
}

export function buildMicrobus({ color = 0xf4f4f1, interior = true, plateText = 'ن ق ل ٣٨٥٢', stripe = 0x2a6fb8 } = {}) {
  const mats = vehicleMaterials(color);
  mats.trim = new THREE.MeshStandardMaterial({ color: 0x8c8a86, roughness: 0.85, vertexColors: true });
  mats.dash = new THREE.MeshStandardMaterial({ color: 0x2a2a2c, roughness: 0.7, vertexColors: true });
  mats.floor = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.95 });
  mats.headliner = new THREE.MeshStandardMaterial({ color: 0xc8c4bc, roughness: 0.95 });
  mats.stripe = new THREE.MeshPhysicalMaterial({ color: stripe, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.1 });
  mats.decor = new THREE.MeshStandardMaterial({ roughness: 0.8, vertexColors: true });
  mats.seat = new THREE.MeshStandardMaterial({ map: makeSeatFabric(), roughness: 0.95 });
  mats.seat.map.repeat.set(2, 2);
  mats.underbody.side = THREE.DoubleSide;
  mats.mirrorDark = new THREE.MeshStandardMaterial({ color: 0x3a4550, roughness: 0.08, metalness: 1 });

  const root = new THREE.Group();
  root.name = 'microbus';
  const body = new THREE.Group();     // الجسم المعلق (بيتحرك بالـ pitch/roll)
  const shell = new THREE.Group();    // إزاحة بحيث نقطة الدوران = مركز الثقل
  shell.position.y = -S.cgHeight;
  body.position.y = S.cgHeight;
  body.add(shell);
  root.add(body);

  const kit = new Kit();
  const z = (f) => -f;

  // ===== الهيكل الخارجي =====
  const shape = sideShape(true);
  const thick = 0.035;
  kit.add('paint', sidePanel(shape, -HALF_W, thick));
  kit.add('paint', sidePanel(shape, HALF_W - thick, thick));
  // سقف + الأجزاء الأمامية والخلفية (أرباع بتوصل بين الجانبين)
  const span = (key, f0, y0, f1, y1, xw = HALF_W - 0.001) => kit.quad(key, [xw, y0, z(f0)], [-xw, y0, z(f0)], [-xw, y1, z(f1)], [xw, y1, z(f1)]);
  span('paint', 2.25, 0.40, 2.32, 0.52);
  span('paint', 2.32, 0.52, 2.335, 0.86);
  span('paint', 2.335, 0.86, 2.30, 0.97);
  span('paint', 2.30, 0.97, 2.24, 1.01);
  span('paint', 2.24, 1.01, 1.86, 1.12);   // الكبوت
  span('paint', 1.34, 2.08, 1.30, 2.17);
  span('paint', 1.30, 2.17, 1.18, 2.21);
  span('paint', 1.18, 2.21, -2.42, 2.22);  // السقف
  span('paint', -2.42, 2.22, -2.6, 2.10);
  // الضهر (باب خلفي بشباك)
  {
    const s = new THREE.Shape();
    s.moveTo(-HALF_W, 0.40); s.lineTo(HALF_W, 0.40); s.lineTo(HALF_W, 2.11); s.lineTo(-HALF_W, 2.11); s.lineTo(-HALF_W, 0.40);
    s.holes.push(roundedRectPath(new THREE.Path(), -0.78, 1.32, 0.78, 1.98, 0.06));
    const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false });
    g.translate(0, 0, 2.6 - thick);
    kit.add('paint', g);
  }
  // الأرضية من تحت
  kit.box('underbody', -HALF_W + 0.02, 0.38, z(2.28), HALF_W - 0.02, 0.42, z(-2.58));
  // جوه الرفارف
  for (const f of [FRONT_AXLE, REAR_AXLE]) for (const sx of [-1, 1]) {
    const g = new THREE.CylinderGeometry(0.45, 0.45, 0.3, 16, 1, true, Math.PI / 2 - 1.4, 2.8).rotateZ(Math.PI / 2);
    kit.add('underbody', g, M4(sx * (HALF_W - 0.17), R, z(f)));
  }

  // شريط أزرق على الجانبين
  for (const sx of [-1, 1]) {
    const x = sx * (HALF_W + 0.004);
    kit.box('stripe', x - 0.003 * sx, 0.90, z(2.28), x + 0.003 * sx, 0.99, z(-2.6));
    kit.box('stripe', x - 0.003 * sx, 1.02, z(1.80), x + 0.003 * sx, 1.04, z(-2.6));
  }

  // ===== الزجاج =====
  const glassAt = (w, x) => {
    const sh = new THREE.Shape();
    if (w.pts) { sh.moveTo(w.pts[0][0], w.pts[0][1]); for (const p of w.pts.slice(1)) sh.lineTo(p[0], p[1]); }
    else roundedRectPath(sh, w.rect[0], w.rect[1], w.rect[2], w.rect[3], 0.06);
    const g = new THREE.ShapeGeometry(sh, 6);
    g.rotateY(Math.PI / 2);
    g.translate(x, 0, 0);
    return g;
  };
  for (const w of WINDOWS) for (const sx of [-1, 1]) kit.add('glass', glassAt(w, sx * (HALF_W - thick / 2)));
  // الزجاج الأمامي
  kit.quad('windshield', [-0.9, 1.12, z(1.86)], [0.9, 1.12, z(1.86)], [0.9, 2.08, z(1.34)], [-0.9, 2.08, z(1.34)]);
  // الزجاج الخلفي
  {
    const sh = roundedRectPath(new THREE.Shape(), -0.78, 1.32, 0.78, 1.98, 0.06);
    const g = new THREE.ShapeGeometry(sh, 6);
    g.translate(0, 0, 2.6 - thick / 2);
    kit.add('glass', g);
  }
  // مسّاحات
  for (const sx of [-0.42, 0.2]) {
    kit.add('plasticBlack', new THREE.BoxGeometry(0.62, 0.015, 0.02), M4(sx, 1.15, z(1.80), -1.07, 0, -0.18));
  }

  // ===== الصدام والشبكة والفوانيس =====
  kit.box('plasticBlack', -0.97, 0.40, z(2.27), 0.97, 0.62, z(2.42));
  kit.box('plasticBlack', -0.97, 0.40, z(-2.58), 0.97, 0.60, z(-2.72));
  kit.box('plasticBlack', -0.55, 0.64, z(2.335), 0.55, 0.86, z(2.345));
  for (let i = 0; i < 4; i++) kit.box('chrome', -0.53, 0.67 + i * 0.05, z(2.345), 0.53, 0.685 + i * 0.05, z(2.36));
  for (const sx of [-1, 1]) {
    kit.box('chrome', sx * 0.58, 0.68, z(2.335), sx * 0.90, 0.88, z(2.34));
    kit.box('headlight', sx * 0.60, 0.70, z(2.34), sx * 0.88, 0.86, z(2.352));
    kit.box('indicator', sx * 0.60, 0.62, z(2.33), sx * 0.88, 0.67, z(2.345));
    // فوانيس ورا (رأسية)
    kit.box('taillight', sx * 0.80, 0.70, z(-2.60), sx * 0.93, 1.25, z(-2.625));
    kit.box('indicator', sx * 0.80, 0.62, z(-2.60), sx * 0.93, 0.69, z(-2.625));
    // رفارف طين
    kit.box('plasticBlack', sx * 0.70, 0.12, z(REAR_AXLE - 0.46), sx * 0.90, 0.42, z(REAR_AXLE - 0.47));
    // كوالين الأبواب
    kit.box('chrome', sx * (HALF_W + 0.006), 1.20, z(0.70), sx * (HALF_W + 0.02), 1.23, z(0.86));
  }
  kit.box('plasticBlack', -0.5, 1.21, z(-2.62), 0.5, 1.24, z(-2.64));
  // مجرى الباب الجرار (يمين)
  kit.box('plasticBlack', HALF_W, 1.26, z(0.42), HALF_W + 0.012, 1.28, z(-1.0));
  kit.box('plasticBlack', HALF_W, 0.60, z(0.42), HALF_W + 0.006, 1.98, z(0.40));
  kit.box('plasticBlack', HALF_W, 0.60, z(-0.64), HALF_W + 0.006, 1.98, z(-0.62));
  kit.box('plasticBlack', -HALF_W - 0.006, 0.60, z(0.42), -HALF_W, 1.98, z(0.40));
  // شكمان
  kit.add('chrome', new THREE.CylinderGeometry(0.035, 0.035, 0.3, 10).rotateX(Math.PI / 2), M4(0.55, 0.36, z(-2.6)));

  // لوحات الأرقام
  const plateTex = makePlate(plateText);
  mats.plate = new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.4, metalness: 0.2 });
  kit.quad('plate', [0.2, 0.44, z(2.425)], [-0.2, 0.44, z(2.425)], [-0.2, 0.6, z(2.425)], [0.2, 0.6, z(2.425)], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  kit.quad('plate', [-0.2, 0.42, z(-2.725)], [0.2, 0.42, z(-2.725)], [0.2, 0.58, z(-2.725)], [-0.2, 0.58, z(-2.725)], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  // ملصق "ما شاء الله" على الضهر
  mats.decal = new THREE.MeshStandardMaterial({ map: makeTextDecal('ما شاء الله'), transparent: true, roughness: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  kit.quad('decal', [-0.55, 1.0, z(-2.605)], [0.55, 1.0, z(-2.605)], [0.55, 1.28, z(-2.605)], [-0.55, 1.28, z(-2.605)], [[0, 0], [1, 0], [1, 1], [0, 1]]);

  // ===== المرايات الجانبية =====
  const mirrors = [];
  for (const sx of [-1, 1]) {
    const mx = sx * 1.11, my = 1.55, mf = 1.60;
    kit.add('plasticBlack', new THREE.CylinderGeometry(0.012, 0.012, 0.2, 6).rotateZ(Math.PI / 2), M4(sx * 1.03, 1.38, z(1.62)));
    kit.add('plasticBlack', new THREE.CylinderGeometry(0.012, 0.012, 0.1, 6), M4(sx * 1.12, 1.42, z(1.62)));
    const holder = new THREE.Group();
    holder.position.set(mx, my, z(mf));
    const house = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.28, 0.07, 3, 0.02), mats.plasticBlack);
    house.castShadow = true;
    house.userData.role = 'plasticBlack';
    holder.add(house);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.175, 0.25), mats.mirrorDark);
    face.position.z = 0.037;
    face.userData.role = 'mirrorDark';
    holder.add(face);
    shell.add(holder);
    mirrors.push({ holder, face, side: sx });
  }

  const rig = { root, body, shell, mats, mirrors, wheels: [], interior: null };

  // ===== العجل =====
  const t = S.track / 2;
  for (const [id, x, f, front] of [['FL', -t, FRONT_AXLE, true], ['FR', t, FRONT_AXLE, true], ['RL', -t, REAR_AXLE, false], ['RR', t, REAR_AXLE, false]]) {
    const w = buildWheel({ radius: R, width: 0.205, rimRadius: 0.19, mats, style: 'steel', side: Math.sign(x) });
    w.group.position.set(x, R, z(f));
    w.group.name = 'wheel_' + id;
    root.add(w.group);
    rig.wheels.push({ id, front, ...w });
  }

  // ===== الصالون الداخلي =====
  const exterior = new THREE.Group(); exterior.name = 'exterior';
  const interiorGroup = new THREE.Group(); interiorGroup.name = 'interior';
  shell.add(exterior, interiorGroup);
  if (interior) {
    const kitInt = new Kit();
    buildInterior(kitInt, interiorGroup, mats, rig);
    kitInt.build(mats, interiorGroup);
  }
  kit.build(mats, exterior);
  rig.exterior = exterior;
  rig.interiorGroup = interiorGroup;
  // ضل ناعم تحت الميكروباص
  rig.contactShadow = contactShadowMesh(2.2, 5.3);
  root.add(rig.contactShadow);
  // الإضاءة
  rig.lights = { head: mats.headlight, tail: mats.taillight, indicator: mats.indicator };
  return rig;
}

function buildInterior(kit, shell, mats, rig) {
  const z = (f) => -f;
  const IW = HALF_W - 0.04;
  // أرضية + بطانة السقف + جوانب
  kit.box('floor', -IW, 0.42, z(2.0), IW, 0.55, z(-2.56));
  kit.box('headliner', -IW, 2.14, z(1.22), IW, 2.17, z(-2.56), { skip: 'py' });
  for (const sx of [-1, 1]) {
    kit.box('trim', sx * IW - 0.02 * sx, 0.55, z(1.75), sx * IW, 1.30, z(-2.56));
    // أعمدة A من جوه
    const len = Math.hypot(1.86 - 1.34, 2.08 - 1.12);
    kit.add('dash', new THREE.BoxGeometry(0.07, len, 0.1), M4(sx * 0.86, (1.12 + 2.08) / 2, z((1.86 + 1.34) / 2), -Math.atan2(1.86 - 1.34, 2.08 - 1.12) * -1, 0, 0));
    // عمود B وعمود بين الشبابيك
    for (const f of [0.485, -0.67, -1.77]) kit.box('trim', sx * (IW - 0.03), 1.28, z(f + 0.06), sx * IW, 2.14, z(f - 0.06));
  }
  kit.box('trim', -IW, 1.98, z(-2.56), IW, 2.14, z(-2.5));

  // ===== التابلوه =====
  const dashShape = new THREE.Shape();
  dashShape.moveTo(1.50, 0.80);
  dashShape.lineTo(1.40, 1.12);
  dashShape.quadraticCurveTo(1.38, 1.30, 1.46, 1.34);
  dashShape.lineTo(1.74, 1.36);
  dashShape.lineTo(1.86, 1.13);
  dashShape.lineTo(1.86, 0.80);
  dashShape.lineTo(1.50, 0.80);
  {
    const g = new THREE.ExtrudeGeometry(dashShape, { depth: 2 * IW, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 2, curveSegments: 6 });
    g.rotateY(Math.PI / 2);
    g.translate(-IW, 0, 0);
    kit.add('dash', g);
  }
  // غطا العدادات
  {
    const g = new RoundedBoxGeometry(0.46, 0.17, 0.2, 3, 0.04);
    kit.add('dash', g, M4(-0.45, 1.36, z(1.52), -0.6));
    kit.add('dash', new RoundedBoxGeometry(0.5, 0.025, 0.12, 2, 0.01), M4(-0.45, 1.475, z(1.47), 0.1));
  }
  // العدادات: وش العداد + إبر
  const gauges = {};
  for (const [kind, x] of [['speed', -0.53], ['rpm', -0.37]]) {
    const gm = new THREE.MeshStandardMaterial({ map: makeGauge(kind), emissive: 0xffffff, emissiveMap: null, emissiveIntensity: 0.0, roughness: 0.4 });
    gm.emissiveMap = gm.map;
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.068, 32), gm);
    const holder = new THREE.Group();
    holder.position.set(x, 1.36 + 0.1 * Math.sin(0.6) + 0.006, z(1.52) + 0.1 * Math.cos(0.6) + 0.004);
    holder.rotation.x = -0.6;
    face.position.z = 0;
    holder.add(face);
    // إبرة
    const needlePivot = new THREE.Group();
    needlePivot.position.z = 0.004;
    const needle = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.058, 0.002).translate(0, 0.026, 0), new THREE.MeshStandardMaterial({ color: 0xff5a1a, emissive: 0xff3a00, emissiveIntensity: 0.6 }));
    needlePivot.add(needle);
    const cap = new THREE.Mesh(new THREE.CircleGeometry(0.009, 12), mats.chrome);
    cap.position.z = 0.005;
    holder.add(needlePivot, cap);
    shell.add(holder);
    gauges[kind] = { pivot: needlePivot, mat: gm };
  }
  // راديو كاسيت في النص
  kit.box('dash', -0.12, 1.06, z(1.47), 0.12, 1.16, z(1.52));
  {
    const radioMat = new THREE.MeshStandardMaterial({ color: 0x103018, emissive: 0x30ff70, emissiveIntensity: 0.6 });
    const disp = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.025), radioMat);
    disp.position.set(0, 1.12, z(1.465));
    shell.add(disp);
  }
  // فتحات التكييف
  for (const x of [-0.75, -0.18, 0.18, 0.75]) kit.box('plasticBlack', x - 0.06, 1.24, z(1.44), x + 0.06, 1.29, z(1.46));

  // ===== الدركسيون =====
  const swTilt = new THREE.Group();
  swTilt.position.set(-0.45, 1.40, z(1.20));
  swTilt.rotation.x = -0.61; // ميل الدركسيون (35 درجة) ناحية السواق
  const steering = new THREE.Group();
  swTilt.add(steering);
  {
    const swMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.55 });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.205, 0.017, 12, 48), swMat);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.05, 18).rotateX(Math.PI / 2), swMat);
    hub.position.z = 0.01;
    const logo = new THREE.Mesh(new THREE.CircleGeometry(0.03, 16), mats.chrome);
    logo.position.z = 0.037;
    steering.add(rim, hub, logo);
    for (const a of [Math.PI / 2 + 0.0, Math.PI / 2 + 2.3, Math.PI / 2 - 2.3]) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.17, 0.012), swMat);
      sp.position.set(Math.cos(a - Math.PI) * 0.11, Math.sin(a - Math.PI) * 0.11, 0.005);
      sp.rotation.z = a - Math.PI / 2 - Math.PI;
      steering.add(sp);
    }
    // علامة أعلى الدركسيون عشان تشوف اللف بوضوح
    const mark = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 0.04), new THREE.MeshStandardMaterial({ color: 0xb08a3a, roughness: 0.4, metalness: 0.5 }));
    mark.position.set(0, 0.205, 0);
    steering.add(mark);
    // غطا دركسيون قماش (زينة مصرية)
    steering.traverse((o) => { o.castShadow = true; });
    // عمود الدركسيون
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.42, 10).rotateX(Math.PI / 2), mats.dash);
    col.position.z = -0.23;
    swTilt.add(col);
  }
  shell.add(swTilt);

  // ===== الدواسات =====
  const pedals = {};
  const pedalMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.6, metalness: 0.5 });
  for (const [name, x, w] of [['clutch', -0.64, 0.07], ['brake', -0.48, 0.09], ['gas', -0.30, 0.06]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 1.0, z(1.62));
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.32, 0.018).translate(0, -0.16, 0), pedalMat);
    const pad = new THREE.Mesh(new THREE.BoxGeometry(w, name === 'gas' ? 0.14 : 0.08, 0.02), pedalMat);
    pad.position.set(0, -0.33, -0.01);
    pivot.add(arm, pad);
    pivot.rotation.x = -0.4;
    shell.add(pivot);
    pedals[name] = pivot;
  }

  // ===== تبة الموتور + ناقل الحركة =====
  kit.add('trim', new RoundedBoxGeometry(0.42, 0.42, 0.9, 3, 0.06), M4(-0.02, 0.76, z(1.18)));
  const gearBase = new THREE.Group();
  gearBase.position.set(-0.12, 0.97, z(1.25));
  const gearLever = new THREE.Group();
  gearBase.add(gearLever);
  {
    const boot = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.1, 10), mats.plasticBlack);
    boot.position.y = 0.03;
    gearBase.add(boot);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.011, 0.42, 8).translate(0, 0.21, 0), mats.chrome);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.032, 14, 10), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3 }));
    knob.position.y = 0.43;
    gearLever.add(rod, knob);
    gearLever.rotation.x = 0.35; // مايل ناحية السواق
  }
  shell.add(gearBase);

  // ===== فرامل اليد =====
  const hbPivot = new THREE.Group();
  hbPivot.position.set(-0.17, 0.99, z(0.70));
  {
    const lever = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.03, 0.34).translate(0, 0, -0.17), mats.plasticBlack);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 8).rotateX(Math.PI / 2).translate(0, 0, -0.28), mats.dash);
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.02, 8).rotateX(Math.PI / 2).translate(0, 0, -0.35), mats.chrome);
    hbPivot.add(lever, grip, btn);
    hbPivot.rotation.x = 0.15;
  }
  shell.add(hbPivot);

  // ===== الكراسي =====
  const seat = (x, f, w, back = true, ry = 0) => {
    const m = M4(x, 0, z(f), 0, ry);
    kit.add('seat', new RoundedBoxGeometry(w, 0.13, 0.5, 3, 0.04), new THREE.Matrix4().multiplyMatrices(m, M4(0, 0.98, 0)));
    if (back) kit.add('seat', new RoundedBoxGeometry(w, 0.66, 0.11, 3, 0.04), new THREE.Matrix4().multiplyMatrices(m, M4(0, 1.36, 0.27, 0.16)));
    kit.add('dash', new THREE.BoxGeometry(w * 0.8, 0.42, 0.36), new THREE.Matrix4().multiplyMatrices(m, M4(0, 0.74, 0)));
  };
  seat(-0.45, 0.74, 0.52);          // كرسي السواق
  kit.add('seat', new RoundedBoxGeometry(0.48, 0.2, 0.09, 3, 0.04), M4(-0.45, 1.76, z(0.43), 0.16)); // مسند راس
  seat(0.48, 0.74, 0.78);           // الكنبة الأمامية (راكبين)
  for (const f of [-0.15, -0.95, -1.75]) {
    seat(-0.28, f, 1.18);
    seat(0.66, f, 0.42);
  }
  seat(0, -2.35, 1.7, false);
  kit.add('seat', new RoundedBoxGeometry(1.7, 0.62, 0.11, 3, 0.04), M4(0, 1.36, z(-2.5), 0.08));

  // ===== زينة مصرية: شرّابة فوق الزجاج + مراية + سبحة =====
  const fringe = new GeoBuilder();
  fringe.setColor([0.55, 0.05, 0.08]);
  fringe.box(-0.86, 2.055, z(1.325), 0.86, 2.09, z(1.30));
  for (let x = -0.84; x < 0.85; x += 0.06) {
    fringe.setColor(Math.round(x * 16) % 3 === 0 ? [0.85, 0.65, 0.15] : [0.6, 0.05, 0.1]);
    fringe.addGeometry(new THREE.CylinderGeometry(0.004, 0.008, 0.045, 5), M4(x, 2.032, z(1.322)));
  }
  shell.add(new THREE.Mesh(fringe.build(), mats.decor));
  // مراية جوه (بتعكس فعلًا اللي ورا)
  kit.add('plasticBlack', new THREE.CylinderGeometry(0.008, 0.008, 0.1, 6), M4(0, 1.99, z(1.36)));
  {
    const holder = new THREE.Group();
    holder.position.set(0, 1.925, z(1.38));
    const house = new THREE.Mesh(new RoundedBoxGeometry(0.25, 0.08, 0.03, 2, 0.01), mats.plasticBlack);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.23, 0.064), mats.mirrorDark);
    face.position.z = 0.016;
    holder.add(house, face);
    shell.add(holder);
    rig.mirrors.push({ holder, face, side: 0, aspect: 0.23 / 0.064, fov: 13 });
  }
  // السبحة المتعلقة (بتتمرجح مع الحركة)
  const sebha = new THREE.Group();
  sebha.position.set(0, 1.875, z(1.385));
  {
    // سبحة كهرمان: حلقة خرز + شرّابة
    const bead = new THREE.SphereGeometry(0.0055, 8, 6);
    const g = new GeoBuilder();
    g.setColor([0.75, 0.42, 0.08]);
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      g.addGeometry(bead, M4(Math.sin(a) * 0.028, -0.06 - 0.055 * (1 - Math.cos(a)), 0));
    }
    g.setColor([0.12, 0.3, 0.7]);
    g.addGeometry(new THREE.SphereGeometry(0.011, 12, 8), M4(0, -0.178, 0)); // خرزة زرقا
    g.setColor([0.75, 0.42, 0.08]);
    g.addGeometry(new THREE.CylinderGeometry(0.003, 0.007, 0.04, 6), M4(0, -0.205, 0));
    g.setColor([0.3, 0.3, 0.3]);
    g.addGeometry(new THREE.CylinderGeometry(0.0015, 0.0015, 0.06, 4), M4(0, -0.03, 0));
    sebha.add(new THREE.Mesh(g.build(), mats.decor));
  }
  shell.add(sebha);

  // ===== شماسات =====
  kit.add('trim', new RoundedBoxGeometry(0.42, 0.02, 0.18, 2, 0.01), M4(-0.45, 2.10, z(1.24), 0.25));
  kit.add('trim', new RoundedBoxGeometry(0.42, 0.02, 0.18, 2, 0.01), M4(0.45, 2.10, z(1.24), 0.25));

  rig.steering = steering;
  rig.gauges = gauges;
  rig.pedals = pedals;
  rig.gearLever = gearLever;
  rig.handbrake = hbPivot;
  rig.sebha = sebha;
  // مكان عين السواق
  const eye = new THREE.Object3D();
  eye.position.set(-0.45, 1.80, z(0.80));
  shell.add(eye);
  rig.eye = eye;
  rig.interior = true;
}

let _shadowTex = null;
function contactShadowMesh(w, l) {
  if (!_shadowTex) {
    const c = canvas(128, 128);
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,0.85)'); g.addColorStop(0.6, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
    _shadowTex = tex(c, { srgb: false, repeat: false });
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: _shadowTex, transparent: true, depthWrite: false, opacity: 0.75, polygonOffset: true, polygonOffsetFactor: -4 }));
  m.position.y = 0.012;
  m.renderOrder = 1;
  m.userData.role = 'shadow';
  return m;
}
