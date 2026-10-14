import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GeoBuilder } from '../render/GeoBuilder.js';
import { vehicleMaterials } from '../render/materials.js';
import {
  makeSeatFabric, makePlate, makeTextDecal, canvas, tex,
  makeHeadlightTexture, makeTaillightTexture, makeCurtain, makeShiftGate, makeGauge2,
} from '../render/textures.js';
import { buildWheel } from './wheel.js';
import { MICROBUS_SPEC } from '../physics/VehiclePhysics.js';

// ميكروباص هاي روف أبيض (مستوحى من الصور المرجعية: سقف عالي، زجاج أمامي مايل، فوانيس كبيرة ملفوفة،
// شبكة كروم، صدام أسود بكشافات ضباب، شريط شبابيك غامق بأعمدة سودا، باب جرار، مرايات كروم، جنوط 6 أذرع، ستاير).
// بدون أي شعارات ماركات.
// الإحداثيات: X يمين، Y فوق، Z لورا (المقدمة ناحية -Z). الأصل = الأرض تحت مركز الثقل. f = للأمام (z = -f)

const S = MICROBUS_SPEC;
const HW = 0.94;                                   // نص العرض
const FA = S.cgToFront;                            // المحور الأمامي f = 1.5
const RA = -(S.wheelBase - S.cgToFront);           // المحور الخلفي f = -1.5
const R = S.wheelRadius;
const z = (f) => -f;

// ====== أبعاد أساسية ======
const BOT = 0.44;          // أسفل الجسم
const WS_BASE = [1.98, 1.21];   // قاعدة الزجاج الأمامي (f,y)
const WS_TOP = [1.10, 2.10];    // أعلى الزجاج الأمامي
const ROOF = 2.30;              // حافة السقف (الوسط أعلى بـ 6 سم)
const REAR_F = -2.73;

/** يجمع القطع الثابتة حسب الخامة في Mesh واحد لكل خامة */
class Kit {
  constructor() { this.b = new Map(); }
  _g(key) { if (!this.b.has(key)) this.b.set(key, new GeoBuilder()); return this.b.get(key); }
  add(key, geom, matrix = new THREE.Matrix4()) { this._g(key).addGeometry(geom, matrix); }
  box(key, x0, y0, z0, x1, y1, z1, opts) { this._g(key).box(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1), Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1), opts); }
  quad(key, a, b, c, d, uv) { this._g(key).quad(a, b, c, d, uv); }
  build(mats, parent, shadows = true) {
    for (const [key, gb] of this.b) {
      if (gb.empty) continue;
      const mesh = new THREE.Mesh(gb.build(), mats[key]);
      mesh.name = key;
      mesh.userData.role = key;
      mesh.castShadow = shadows && !['glass', 'windshield', 'decal', 'curtain', 'shade', 'lamp', 'tail'].includes(key);
      mesh.receiveShadow = true;
      parent.add(mesh);
    }
  }
}

const M4 = (x = 0, y = 0, zz = 0, rx = 0, ry = 0, rz = 0, s = 1) => new THREE.Matrix4().compose(
  new THREE.Vector3(x, y, zz), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(s, s, s));

function roundedRectPath(path, f0, y0, f1, y1, r) {
  path.moveTo(f0 + r, y0);
  path.lineTo(f1 - r, y0); path.quadraticCurveTo(f1, y0, f1, y0 + r);
  path.lineTo(f1, y1 - r); path.quadraticCurveTo(f1, y1, f1 - r, y1);
  path.lineTo(f0 + r, y1); path.quadraticCurveTo(f0, y1, f0, y1 - r);
  path.lineTo(f0, y0 + r); path.quadraticCurveTo(f0, y0, f0 + r, y0);
  return path;
}

// شبابيك الجنب: باب السواق + شريط طويل للركاب (زي الصورة)
const WINDOWS = [
  { pts: [[1.84, 1.30], [1.19, 1.95], [0.66, 1.95], [0.66, 1.30]] },
  { rect: [-2.50, 1.30, 0.50, 1.98] },
];
// أعمدة سودا بين شبابيك الركاب
const BAND_PILLARS = [-0.42, -1.40];

function windowPath(w, P = THREE.Path) {
  const p = new P();
  if (w.pts) { p.moveTo(...w.pts[0]); for (const q of w.pts.slice(1)) p.lineTo(...q); p.lineTo(...w.pts[0]); }
  else roundedRectPath(p, w.rect[0], w.rect[1], w.rect[2], w.rect[3], 0.08);
  return p;
}

/** بروفايل الجنب (f,y) بفتحات العجل والشبابيك */
function sideShape(withWindows = true) {
  const s = new THREE.Shape();
  const arch = 0.47, cy = R, dy = BOT - cy, dx = Math.sqrt(arch * arch - dy * dy);
  const a0 = Math.atan2(dy, -dx), a1 = Math.atan2(dy, dx);
  s.moveTo(2.47, BOT);
  s.lineTo(2.50, 0.62);
  s.lineTo(2.52, 0.86);
  s.lineTo(2.525, 1.04);
  s.quadraticCurveTo(2.52, 1.11, 2.42, 1.12);
  s.lineTo(WS_BASE[0] + 0.04, WS_BASE[1] - 0.01);
  s.lineTo(...WS_BASE);
  s.lineTo(...WS_TOP);
  s.quadraticCurveTo(1.0, 2.27, 0.72, ROOF);
  s.lineTo(-2.52, ROOF + 0.01);
  s.quadraticCurveTo(-2.70, ROOF + 0.01, -2.72, 2.16);
  s.lineTo(REAR_F, 0.62);
  s.quadraticCurveTo(REAR_F, BOT, -2.62, BOT);
  s.lineTo(RA - dx, BOT);
  s.absarc(RA, cy, arch, a0, a1, true);
  s.lineTo(FA - dx, BOT);
  s.absarc(FA, cy, arch, a0, a1, true);
  s.lineTo(2.47, BOT);
  if (withWindows) for (const w of WINDOWS) s.holes.push(windowPath(w));
  return s;
}

function sidePanel(shape, x0, depth) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 10 });
  g.rotateY(Math.PI / 2); // shape.x(f) → -z
  g.translate(x0, 0, 0);
  return g;
}

/** شريط عرضي بين الجنبين (سقف / مقدمة) من نقطة (f0,y0) لـ (f1,y1)، الوش لبره */
function span(kit, key, f0, y0, f1, y1, xw = HW - 0.001, dy0 = 0, dy1 = 0) {
  kit.quad(key, [xw, y0 + dy0, z(f0)], [-xw, y0 + dy0, z(f0)], [-xw, y1 + dy1, z(f1)], [xw, y1 + dy1, z(f1)]);
}

export function buildMicrobus({ color = 0xf6f6f3, interior = true, plateText = 'ن ق ل ٣٨٥٢', stripe = null } = {}) {
  const mats = vehicleMaterials(color);
  mats.paint.roughness = 0.22;
  mats.glass.opacity = 0.62;
  mats.glass.color.set(0x0c1216);
  mats.trim = new THREE.MeshStandardMaterial({ color: 0x8a8984, roughness: 0.85, vertexColors: true });
  mats.beige = new THREE.MeshStandardMaterial({ color: 0xcfc6b2, roughness: 0.9, vertexColors: true });
  mats.dash = new THREE.MeshStandardMaterial({ color: 0x2b2c2f, roughness: 0.75, vertexColors: true });
  mats.trimDS = new THREE.MeshStandardMaterial({ color: 0x55565a, roughness: 0.85, side: THREE.DoubleSide });
  mats.floor = new THREE.MeshStandardMaterial({ color: 0x1f1f20, roughness: 0.95 });
  mats.decor = new THREE.MeshStandardMaterial({ roughness: 0.8, vertexColors: true });
  mats.seat = new THREE.MeshStandardMaterial({ map: makeSeatFabric(), roughness: 0.95 });
  mats.seat.map.repeat.set(2, 2);
  mats.mirrorDark = new THREE.MeshStandardMaterial({ color: 0x3a4550, roughness: 0.08, metalness: 1 });
  mats.underbody.side = THREE.DoubleSide;
  mats.lamp = new THREE.MeshStandardMaterial({ map: makeHeadlightTexture(), roughness: 0.08, metalness: 0.3, emissive: 0xfff2d0, emissiveIntensity: 0.0 });
  mats.lamp.userData.emissiveMapLater = true;
  mats.tail = new THREE.MeshStandardMaterial({ map: makeTaillightTexture(), roughness: 0.15, emissive: 0xff2010, emissiveMap: null, emissiveIntensity: 0.15 });
  mats.taillight = mats.tail; // نفس الخامة (فوانيس الفرامل)
  mats.fog = new THREE.MeshStandardMaterial({ color: 0xf4f4ee, emissive: 0xfff3c8, emissiveIntensity: 0.0, roughness: 0.1 });
  mats.curtain = new THREE.MeshStandardMaterial({ map: makeCurtain(), transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.9 });
  if (stripe) mats.stripe = new THREE.MeshPhysicalMaterial({ color: stripe, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.1 });

  const root = new THREE.Group();
  root.name = 'microbus';
  const body = new THREE.Group();
  const shell = new THREE.Group();
  shell.position.y = -S.cgHeight;
  body.position.y = S.cgHeight;
  body.add(shell);
  root.add(body);

  const kit = new Kit();
  const t = 0.035;

  // ===== الجنبين =====
  const shape = sideShape(true);
  kit.add('paint', sidePanel(shape, -HW, t));
  kit.add('paint', sidePanel(shape, HW - t, t));

  // ===== المقدمة (كبوت قصير) =====
  const nose = [[2.47, BOT], [2.50, 0.62], [2.52, 0.86], [2.525, 1.04], [2.505, 1.10], [2.42, 1.12], [WS_BASE[0] + 0.04, WS_BASE[1] - 0.01], WS_BASE];
  for (let i = 0; i < nose.length - 1; i++) span(kit, 'paint', nose[i][0], nose[i][1], nose[i + 1][0], nose[i + 1][1]);
  // ===== السقف العالي بحواف مدوّرة =====
  const roof = [WS_TOP, [1.05, 2.19], [0.92, 2.27], [0.72, ROOF], [-2.52, ROOF + 0.01], [-2.64, ROOF - 0.02], [-2.70, 2.24], [-2.72, 2.16]];
  const IN = HW - 0.10;
  for (let i = 0; i < roof.length - 1; i++) {
    const [f0, y0] = roof[i], [f1, y1] = roof[i + 1];
    const c0 = i === 0 ? 0 : 0.06, c1 = i + 1 === roof.length - 1 ? 0 : 0.06;
    span(kit, 'paint', f0, y0, f1, y1, IN, c0, c1);
    // حواف السقف المايلة
    kit.quad('paint', [HW - 0.001, y0, z(f0)], [IN, y0 + c0, z(f0)], [IN, y1 + c1, z(f1)], [HW - 0.001, y1, z(f1)]);
    kit.quad('paint', [-IN, y0 + c0, z(f0)], [-HW + 0.001, y0, z(f0)], [-HW + 0.001, y1, z(f1)], [-IN, y1 + c1, z(f1)]);
  }
  // مجاري مية المطر على حافة السقف
  for (const sx of [-1, 1]) kit.box('trim', sx * (HW + 0.004), 2.24, z(0.9), sx * (HW - 0.01), 2.26, z(-2.6));

  // ===== الضهر (باب خلفي بشباك كبير) =====
  {
    const sh = new THREE.Shape();
    sh.moveTo(-HW, BOT); sh.lineTo(HW, BOT); sh.lineTo(HW, 2.17); sh.lineTo(-HW, 2.17); sh.lineTo(-HW, BOT);
    sh.holes.push(roundedRectPath(new THREE.Path(), -0.76, 1.36, 0.76, 2.06, 0.07));
    const g = new THREE.ExtrudeGeometry(sh, { depth: t, bevelEnabled: false });
    g.translate(0, 0, -REAR_F - t);
    kit.add('paint', g);
  }
  // الأرضية من تحت + جوه الرفارف
  kit.box('underbody', -HW + 0.02, BOT - 0.03, z(2.45), HW - 0.02, BOT + 0.01, z(-2.68));
  for (const f of [FA, RA]) for (const sx of [-1, 1]) {
    const g = new THREE.CylinderGeometry(0.47, 0.47, 0.3, 16, 1, true, Math.PI / 2 - 1.45, 2.9).rotateZ(Math.PI / 2);
    kit.add('underbody', g, M4(sx * (HW - 0.17), R, z(f)));
  }

  // ===== الزجاج =====
  const glassFor = (w, x) => {
    const g = new THREE.ShapeGeometry(windowPath(w, THREE.Shape), 6);
    g.rotateY(Math.PI / 2);
    g.translate(x, 0, 0);
    return g;
  };
  for (const w of WINDOWS) for (const sx of [-1, 1]) kit.add('glass', glassFor(w, sx * (HW - t / 2)));
  // أعمدة سودا على شريط الشبابيك + برواز أسود (زي الصورة)
  for (const sx of [-1, 1]) {
    const x0 = sx * (HW + 0.002), x1 = sx * (HW + 0.008);
    for (const f of BAND_PILLARS) kit.box('plasticBlack', x0, 1.30, z(f + 0.045), x1, 1.98, z(f - 0.045));
    kit.box('plasticBlack', x0, 1.27, z(0.66), x1, 1.98, z(0.50)); // عمود B
    kit.box('plasticBlack', x0, 1.27, z(0.52), x1, 1.30, z(-2.50)); // برواز تحت
  }
  // الزجاج الأمامي + شريط تظليل أزرق فوق
  kit.quad('windshield', [-0.90, WS_BASE[1], z(WS_BASE[0])], [0.90, WS_BASE[1], z(WS_BASE[0])], [0.90, WS_TOP[1], z(WS_TOP[0])], [-0.90, WS_TOP[1], z(WS_TOP[0])]);
  {
    const c = canvas(4, 64), ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, 'rgba(30,70,140,0.75)'); g.addColorStop(1, 'rgba(30,70,140,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 4, 64);
    mats.shade = new THREE.MeshBasicMaterial({ map: tex(c, { repeat: false }), transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const k = 0.78; // من 78% لحد آخر الزجاج
    const fb = WS_BASE[0] + (WS_TOP[0] - WS_BASE[0]) * k, yb = WS_BASE[1] + (WS_TOP[1] - WS_BASE[1]) * k;
    kit.quad('shade', [-0.90, yb, z(fb) + 0.01], [0.90, yb, z(fb) + 0.01], [0.90, WS_TOP[1], z(WS_TOP[0]) + 0.01], [-0.90, WS_TOP[1], z(WS_TOP[0]) + 0.01], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }
  // الزجاج الخلفي
  {
    const g = new THREE.ShapeGeometry(roundedRectPath(new THREE.Shape(), -0.76, 1.36, 0.76, 2.06, 0.07), 6);
    g.translate(0, 0, -REAR_F - t / 2);
    kit.add('glass', g);
  }
  // مسّاحات
  for (const sx of [-0.45, 0.2]) kit.add('plasticBlack', new THREE.BoxGeometry(0.66, 0.012, 0.02), M4(sx, WS_BASE[1] + 0.05, z(WS_BASE[0] - 0.05), -0.79, 0, -0.12));

  // ===== الوش: فوانيس ملفوفة + شبكة كروم + صدام أسود =====
  for (const sx of [-1, 1]) {
    const xi = sx * 0.50, xo = sx * 0.925;
    const a = [xi, 0.88, z(2.531)], b = [xo, 0.88, z(2.531)], c = [xo, 1.045, z(2.531)], d = [xi, 1.045, z(2.531)];
    const uv = [[0, 0], [0.86, 0], [0.86, 1], [0, 1]];
    if (sx > 0) kit.quad('lamp', b, a, d, c, [uv[1], uv[0], uv[3], uv[2]]); else kit.quad('lamp', a, b, c, d, uv);
    // الجزء الملفوف على الجنب
    const xs = sx * (HW + 0.004);
    const su = [[0.86, 0], [1, 0], [1, 1], [0.86, 1]];
    if (sx < 0) kit.quad('lamp', [xs, 0.88, z(2.52)], [xs, 0.88, z(2.32)], [xs, 1.06, z(2.32)], [xs, 1.06, z(2.52)], su);
    else kit.quad('lamp', [xs, 0.88, z(2.32)], [xs, 0.88, z(2.52)], [xs, 1.06, z(2.52)], [xs, 1.06, z(2.32)], [[0.86, 0], [1, 0], [1, 1], [0.86, 1]]);
    // كشاف ضباب
    const fog = new THREE.CylinderGeometry(0.055, 0.055, 0.03, 18).rotateX(Math.PI / 2);
    kit.add('fog', fog, M4(sx * 0.80, 0.52, z(2.64)));
    kit.add('chrome', new THREE.TorusGeometry(0.06, 0.008, 6, 18), M4(sx * 0.80, 0.52, z(2.645)));
    // رفارف طين
    kit.box('plasticBlack', sx * 0.72, 0.14, z(FA - 0.47), sx * 0.92, 0.44, z(FA - 0.48));
    kit.box('plasticBlack', sx * 0.72, 0.14, z(RA - 0.47), sx * 0.92, 0.44, z(RA - 0.48));
  }
  // الشبكة: خلفية سودا + 3 خطوط كروم
  kit.quad('underbody', [0.50, 0.88, z(2.529)], [-0.50, 0.88, z(2.529)], [-0.50, 1.045, z(2.529)], [0.50, 1.045, z(2.529)]);
  for (let i = 0; i < 3; i++) {
    const y = 0.90 + i * 0.05;
    kit.box('chrome', -0.50, y, z(2.531), 0.50, y + 0.024, z(2.545));
  }
  kit.box('chrome', -0.93, 0.855, z(2.531), 0.93, 0.877, z(2.546)); // شريط كروم تحت الفوانيس
  kit.box('chrome', -0.5, 1.045, z(2.528), 0.5, 1.06, z(2.54));
  // الصدام الأمامي الأسود
  kit.add('plasticBlack', new RoundedBoxGeometry(1.96, 0.44, 0.26, 3, 0.06), M4(0, 0.62, z(2.50)));
  kit.box('underbody', -0.56, 0.44, z(2.632), 0.56, 0.58, z(2.636));
  for (let i = 0; i < 3; i++) kit.box('plasticBlack', -0.55, 0.46 + i * 0.04, z(2.637), 0.55, 0.47 + i * 0.04, z(2.645));
  // ===== الضهر =====
  kit.add('plasticBlack', new RoundedBoxGeometry(1.94, 0.24, 0.24, 3, 0.05), M4(0, 0.54, z(REAR_F - 0.04)));
  for (const sx of [-1, 1]) {
    const x0 = sx * 0.80, x1 = sx * 0.935, zz = z(REAR_F - 0.004);
    if (sx > 0) kit.quad('tail', [x0, 0.70, zz], [x1, 0.70, zz], [x1, 1.48, zz], [x0, 1.48, zz]); else kit.quad('tail', [x1, 0.70, zz], [x0, 0.70, zz], [x0, 1.48, zz], [x1, 1.48, zz], [[1, 0], [0, 0], [0, 1], [1, 1]]);
    const xs = sx * (HW + 0.004);
    if (sx > 0) kit.quad('tail', [xs, 0.70, z(REAR_F)], [xs, 0.70, z(REAR_F + 0.10)], [xs, 1.48, z(REAR_F + 0.10)], [xs, 1.48, z(REAR_F)], [[0, 0], [0.3, 0], [0.3, 1], [0, 1]]);
    else kit.quad('tail', [xs, 0.70, z(REAR_F + 0.10)], [xs, 0.70, z(REAR_F)], [xs, 1.48, z(REAR_F)], [xs, 1.48, z(REAR_F + 0.10)], [[0, 0], [0.3, 0], [0.3, 1], [0, 1]]);
  }
  kit.box('tail', -0.18, 2.10, z(REAR_F - 0.01), 0.18, 2.13, z(REAR_F - 0.02)); // فانوس فرامل عالي
  kit.box('chrome', -0.12, 1.20, z(REAR_F - 0.004), 0.12, 1.24, z(REAR_F - 0.02));
  kit.add('chrome', new THREE.CylinderGeometry(0.035, 0.035, 0.25, 10).rotateX(Math.PI / 2), M4(0.55, 0.36, z(REAR_F + 0.05)));

  // ===== تفاصيل الجنب: الباب الجرار، الكوالين، خط السقف، غطا البنزين =====
  const seam = (x, f0, y0, f1, y1) => kit.box('underbody', x - 0.002, y0, z(f0), x + 0.002, y1, z(f1));
  for (const sx of [-1, 1]) {
    const x = sx * (HW + 0.002);
    seam(x, 0.68, 0.48, 0.665, 1.27);            // نهاية باب السواق
    seam(x, 1.96, 0.62, 1.945, 1.20);
    kit.box('chrome', sx * (HW + 0.004), 1.17, z(0.80), sx * (HW + 0.022), 1.20, z(0.93)); // كالون
    kit.box('trim', sx * (HW + 0.001), 2.03, z(0.85), sx * (HW + 0.004), 2.045, z(-2.6));  // خط السقف العالي
  }
  // الباب الجرار (يمين)
  seam(HW + 0.002, 0.50, 0.48, 0.49, 1.98);
  seam(HW + 0.002, -0.40, 0.48, -0.41, 1.98);
  kit.box('underbody', HW, 1.215, z(-0.42), HW + 0.012, 1.235, z(-2.45)); // مجرى الباب
  kit.box('chrome', HW + 0.004, 1.17, z(0.40), HW + 0.022, 1.20, z(0.28));
  // غطا البنزين (شمال)
  seam(-HW - 0.002, -1.80, 0.95, -1.81, 1.13); seam(-HW - 0.002, -2.0, 0.95, -2.01, 1.13);
  if (stripe) for (const sx of [-1, 1]) kit.box('stripe', sx * (HW + 0.001), 0.92, z(2.3), sx * (HW + 0.005), 1.02, z(-2.65));

  // لوحات الأرقام
  mats.plate = new THREE.MeshStandardMaterial({ map: makePlate(plateText), roughness: 0.4, metalness: 0.2 });
  kit.quad('plate', [0.2, 0.55, z(2.638)], [-0.2, 0.55, z(2.638)], [-0.2, 0.71, z(2.638)], [0.2, 0.71, z(2.638)], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  kit.quad('plate', [-0.2, 0.70, z(REAR_F - 0.006)], [0.2, 0.70, z(REAR_F - 0.006)], [0.2, 0.86, z(REAR_F - 0.006)], [-0.2, 0.86, z(REAR_F - 0.006)], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  mats.decal = new THREE.MeshStandardMaterial({ map: makeTextDecal('ما شاء الله'), transparent: true, roughness: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  kit.quad('decal', [-0.5, 1.38, z(REAR_F - 0.008)], [0.5, 1.38, z(REAR_F - 0.008)], [0.5, 1.58, z(REAR_F - 0.008)], [-0.5, 1.58, z(REAR_F - 0.008)], [[0, 0], [1, 0], [1, 1], [0, 1]]);

  // ===== المرايات الجانبية (كروم) =====
  const mirrors = [];
  for (const sx of [-1, 1]) {
    const mx = sx * 1.13, my = 1.50, mf = 1.99;
    kit.add('chrome', new THREE.CylinderGeometry(0.014, 0.014, 0.2, 6).rotateZ(Math.PI / 2), M4(sx * 1.03, 1.36, z(1.97)));
    const holder = new THREE.Group();
    holder.position.set(mx, my, z(mf));
    const house = new THREE.Mesh(new RoundedBoxGeometry(0.19, 0.27, 0.08, 3, 0.03), mats.chrome);
    house.castShadow = true;
    house.userData.role = 'chrome';
    holder.add(house);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.165, 0.24), mats.mirrorDark);
    face.position.z = 0.042;
    face.userData.role = 'mirrorDark';
    holder.add(face);
    shell.add(holder);
    mirrors.push({ holder, face, side: sx });
  }

  const rig = { root, body, shell, mats, mirrors, wheels: [], interior: null };

  // ===== العجل (جنط ألومنيوم 6 أذرع) =====
  const tr = S.track / 2;
  for (const [id, x, f, front] of [['FL', -tr, FA, true], ['FR', tr, FA, true], ['RL', -tr, RA, false], ['RR', tr, RA, false]]) {
    const w = buildWheel({ radius: R, width: 0.205, rimRadius: 0.2, mats, style: 'alloy6', side: Math.sign(x) });
    w.group.position.set(x, R, z(f));
    w.group.name = 'wheel_' + id;
    root.add(w.group);
    rig.wheels.push({ id, front, ...w });
  }

  const exterior = new THREE.Group(); exterior.name = 'exterior';
  const interiorGroup = new THREE.Group(); interiorGroup.name = 'interior';
  shell.add(exterior, interiorGroup);
  // ستاير (بتبان من بره ومن جوه)
  const kitC = new Kit();
  for (const sx of [-1, 1]) for (const f of [0.40, ...BAND_PILLARS.map((p) => p - 0.06), -2.40]) {
    const x = sx * (HW - 0.05), w = 0.13;
    kitC.quad('curtain', [x, 1.31, z(f + w)], [x, 1.31, z(f - w)], [x, 1.97, z(f - w)], [x, 1.97, z(f + w)], [[0, 0], [1, 0], [1, 1], [0, 1]]);
  }
  kitC.build(mats, exterior, false);
  if (interior) {
    const kitInt = new Kit();
    buildInterior(kitInt, interiorGroup, mats, rig);
    kitInt.build(mats, interiorGroup);
  }
  kit.build(mats, exterior);
  rig.exterior = exterior;
  rig.interiorGroup = interiorGroup;
  rig.contactShadow = contactShadowMesh(2.2, 5.7);
  root.add(rig.contactShadow);
  rig.lights = { head: mats.lamp, tail: mats.tail, indicator: mats.indicator, fog: mats.fog };
  return rig;
}

// =====================================================================
//  الصالون: تابلوه رمادي غامق، 3 عدادات تحت غطا، دركسيون 3 أذرع بمركز كبير،
//  كونسول فيه شاشة وفتحات تكييف وزرار انتظار أحمر وأزرار تكييف، فتيس على التابلوه
// =====================================================================
function buildInterior(kit, shell, mats, rig) {
  const IW = HW - 0.04;
  const DX = -0.48; // مكان السواق (شمال)
  // أرضية + سقف بيج + جوانب
  kit.box('floor', -IW, BOT, z(2.0), IW, 0.60, z(-2.68));
  kit.box('beige', -IW, 2.22, z(1.0), IW, 2.25, z(-2.68), { skip: 'py' });
  for (const sx of [-1, 1]) {
    kit.box('trim', sx * IW - 0.025 * sx, 0.60, z(1.95), sx * IW, 1.29, z(-2.68));
    kit.box('beige', sx * IW - 0.02 * sx, 1.98, z(0.9), sx * IW, 2.22, z(-2.68));
    // عمود A من جوه (رفيع ومن بره عشان ميحجبش المرايات)
    const len = Math.hypot(WS_BASE[0] - WS_TOP[0], WS_TOP[1] - WS_BASE[1]);
    kit.add('trim', new THREE.BoxGeometry(0.035, len, 0.06), M4(sx * 0.925, (WS_BASE[1] + WS_TOP[1]) / 2, z((WS_BASE[0] + WS_TOP[0]) / 2), Math.atan2(WS_BASE[0] - WS_TOP[0], WS_TOP[1] - WS_BASE[1])));
    // مسكة على العمود
    kit.add('beige', new THREE.BoxGeometry(0.03, 0.28, 0.035), M4(sx * 0.89, 1.60, z(1.66), Math.atan2(WS_BASE[0] - WS_TOP[0], WS_TOP[1] - WS_BASE[1])));
    for (const f of [0.58, ...BAND_PILLARS]) kit.box('beige', sx * (IW - 0.03), 1.28, z(f + 0.06), sx * IW, 2.22, z(f - 0.06));
  }
  kit.box('beige', -IW, 2.06, z(-2.70), IW, 2.22, z(-2.64));
  // تلبيس جوه الكابينة (عشان الصاج الأبيض ميبانش من جوه حوالين الزجاج)
  for (const sx of [-1, 1]) {
    const sh = new THREE.Shape();
    sh.moveTo(2.0, 0.6); sh.lineTo(...WS_BASE); sh.lineTo(...WS_TOP); sh.lineTo(0.72, ROOF - 0.04); sh.lineTo(0.50, ROOF - 0.04); sh.lineTo(0.50, 0.6); sh.lineTo(2.0, 0.6);
    sh.holes.push(windowPath(WINDOWS[0]));
    const g = new THREE.ShapeGeometry(sh, 4);
    g.rotateY(Math.PI / 2);
    g.translate(sx * (HW - 0.037), 0, 0);
    kit.add('trimDS', g);
  }

  // ===== التابلوه =====
  const dash = new THREE.Shape();
  dash.moveTo(1.56, 0.92);
  dash.lineTo(1.52, 1.22);
  dash.quadraticCurveTo(1.52, 1.40, 1.62, 1.42);
  dash.lineTo(1.78, 1.41);
  dash.lineTo(1.96, 1.235);
  dash.lineTo(1.96, 0.92);
  dash.lineTo(1.56, 0.92);
  {
    const g = new THREE.ExtrudeGeometry(dash, { depth: 2 * IW, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 2, curveSegments: 6 });
    g.rotateY(Math.PI / 2);
    g.translate(-IW, 0, 0);
    kit.add('dash', g);
  }
  // درج تابلوه (ناحية الراكب)
  kit.box('dash', 0.30, 1.0, z(1.505), 0.80, 1.22, z(1.52));
  // باب السواق من جوه + أزرار الشبابيك
  kit.box('dash', -IW, 0.85, z(1.75), -IW + 0.06, 1.05, z(0.75));
  kit.box('plasticBlack', -IW + 0.06, 1.03, z(1.20), -IW + 0.10, 1.06, z(0.95));

  // ===== غطا العدادات + 3 عدادات =====
  const tilt = -0.55;
  kit.add('dash', new RoundedBoxGeometry(0.62, 0.22, 0.24, 3, 0.05), M4(DX, 1.40, z(1.70), tilt));
  const faceY = 1.40 + 0.12 * Math.sin(-tilt) + 0.004, faceZ = z(1.70) + 0.12 * Math.cos(tilt) + 0.004;
  const gauges = {};
  for (const [kind, dx, r] of [['rpm', -0.17, 0.058], ['speed', 0, 0.078], ['fuel', 0.165, 0.05]]) {
    const gm = new THREE.MeshStandardMaterial({ map: makeGauge2(kind), emissive: 0xffffff, emissiveIntensity: 0.0, roughness: 0.35 });
    gm.emissiveMap = gm.map;
    const holder = new THREE.Group();
    holder.position.set(DX + dx, faceY, faceZ);
    holder.rotation.x = tilt;
    holder.add(new THREE.Mesh(new THREE.CircleGeometry(r, 32), gm));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r + 0.004, 0.004, 6, 32), mats.chrome);
    holder.add(ring);
    const pivot = new THREE.Group();
    pivot.position.z = 0.004;
    const needle = new THREE.Mesh(new THREE.BoxGeometry(0.004, r * 0.85, 0.002).translate(0, r * 0.38, 0), new THREE.MeshStandardMaterial({ color: 0xff4a10, emissive: 0xff3a00, emissiveIntensity: 0.7 }));
    pivot.add(needle);
    const cap = new THREE.Mesh(new THREE.CircleGeometry(0.009, 12), mats.chrome);
    cap.position.z = 0.006;
    holder.add(pivot, cap);
    shell.add(holder);
    gauges[kind] = { pivot, mat: gm };
  }
  // شاشة صغيرة فيها D/N/R
  {
    const c = canvas(64, 32);
    const gt = tex(c, { repeat: false });
    const gmat = new THREE.MeshBasicMaterial({ map: gt });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.025), gmat);
    const h = new THREE.Group();
    h.position.set(DX, faceY - 0.055, faceZ + 0.03);
    h.rotation.x = tilt;
    h.add(plane);
    shell.add(h);
    rig.gearDisplay = {
      set(mode) {
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#0a1a10'; ctx.fillRect(0, 0, 64, 32);
        ctx.fillStyle = mode === 'R' ? '#ff6040' : '#70ff90'; ctx.font = 'bold 26px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(mode, 32, 17);
        gt.needsUpdate = true;
      },
    };
    rig.gearDisplay.set('D');
  }
  rig.gauges = gauges;

  // ===== الكونسول: شاشة، تكييف، زرار انتظار، أزرار، فتيس =====
  const CF = 1.525;
  kit.box('dash', -0.14, 1.00, z(CF + 0.005), 0.30, 1.36, z(CF + 0.03));
  {
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.11), new THREE.MeshStandardMaterial({ color: 0x0b1a2a, emissive: 0x3070c0, emissiveIntensity: 0.35, roughness: 0.15 }));
    scr.position.set(0.08, 1.25, z(CF) + 0.002);
    shell.add(scr);
    rig.screen = scr.material;
  }
  for (const x of [-0.095, 0.255]) for (let i = 0; i < 4; i++) kit.box('plasticBlack', x - 0.03, 1.19 + i * 0.03, z(CF - 0.002), x + 0.03, 1.205 + i * 0.03, z(CF - 0.008));
  for (const x of [-0.82, 0.78]) for (let i = 0; i < 3; i++) kit.box('plasticBlack', x - 0.06, 1.25 + i * 0.035, z(1.51), x + 0.06, 1.265 + i * 0.035, z(1.50));
  kit.box('tail', 0.065, 1.155, z(CF - 0.002), 0.095, 1.175, z(CF - 0.01)); // زرار الانتظار الأحمر
  for (const x of [0.0, 0.08, 0.16]) kit.add('plasticBlack', new THREE.CylinderGeometry(0.022, 0.022, 0.02, 14).rotateX(Math.PI / 2), M4(x, 1.08, z(CF - 0.01)));
  // لوحة الفتيس على التابلوه + الدراع
  const gate = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.2), new THREE.MeshStandardMaterial({ map: makeShiftGate(), roughness: 0.6 }));
  gate.position.set(-0.12, 1.02, z(1.50));
  gate.rotation.x = -0.25;
  shell.add(gate);
  const gearBase = new THREE.Group();
  gearBase.position.set(-0.115, 1.02, z(1.49));
  const gearLever = new THREE.Group();
  gearBase.add(gearLever);
  {
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.14, 8).rotateX(Math.PI / 2).translate(0, 0, 0.07), mats.chrome);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.028, 14, 10).scale(0.9, 1.25, 1), new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.35 }));
    knob.position.set(0, 0.015, 0.15);
    gearLever.add(rod, knob);
  }
  shell.add(gearBase);
  rig.gearLever = gearLever;
  rig.gearGate = { base: gearBase, top: 1.10, step: 0.027 }; // P,R,N,D من فوق لتحت

  // ===== الدركسيون: 3 أذرع ومركز كبير (من غير لوجو) =====
  const swTilt = new THREE.Group();
  swTilt.position.set(DX, 1.40, z(1.40));
  swTilt.rotation.x = -0.75;
  const steering = new THREE.Group();
  swTilt.add(steering);
  {
    const swMat = new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.6 });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.019, 12, 48), swMat);
    const hub = new THREE.Mesh(new RoundedBoxGeometry(0.15, 0.12, 0.06, 4, 0.03), swMat);
    hub.position.set(0, -0.01, 0.025);
    const emblem = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.004, 6, 20), mats.chrome);
    emblem.scale.y = 0.65;
    emblem.position.set(0, -0.01, 0.058);
    steering.add(rim, hub, emblem);
    for (const [x, y, w, h, rz] of [[-0.12, -0.02, 0.09, 0.035, 0.08], [0.12, -0.02, 0.09, 0.035, -0.08], [0, -0.12, 0.04, 0.1, 0]]) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.02), swMat);
      sp.position.set(x, y, 0.012); sp.rotation.z = rz;
      steering.add(sp);
    }
    const mark = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.028, 0.042), new THREE.MeshStandardMaterial({ color: 0xc8a050, roughness: 0.4, metalness: 0.5 }));
    mark.position.set(0, 0.19, 0);
    steering.add(mark);
    steering.traverse((o) => { o.castShadow = true; });
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.36, 10).rotateX(Math.PI / 2), mats.dash);
    col.position.z = -0.2;
    swTilt.add(col);
    // ذراع الإشارات والمساحات
    for (const sx of [-1, 1]) {
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.12, 6).rotateZ(Math.PI / 2), mats.plasticBlack);
      st.position.set(sx * 0.1, 0.0, -0.08);
      swTilt.add(st);
    }
  }
  shell.add(swTilt);
  rig.steering = steering;

  // ===== الدواسات (أوتوماتيك: بنزين وفرامل) =====
  const pedals = {};
  const pedalMat = new THREE.MeshStandardMaterial({ color: 0x2d2d2d, roughness: 0.6, metalness: 0.4 });
  for (const [name, x, w, h] of [['brake', -0.52, 0.12, 0.08], ['gas', -0.33, 0.06, 0.15]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 1.0, z(1.78));
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.30, 0.018).translate(0, -0.15, 0), pedalMat);
    const pad = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.02), pedalMat);
    pad.position.set(0, -0.31, -0.01);
    pivot.add(arm, pad);
    pivot.rotation.x = -0.4;
    shell.add(pivot);
    pedals[name] = pivot;
  }
  rig.pedals = pedals;

  // ===== تبة الموتور + فرامل اليد =====
  kit.add('trim', new RoundedBoxGeometry(0.34, 0.46, 0.8, 3, 0.06), M4(-0.03, 0.83, z(1.0)));
  const hbPivot = new THREE.Group();
  hbPivot.position.set(-0.16, 1.07, z(0.72));
  {
    const lever = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.03, 0.3).translate(0, 0, -0.15), mats.plasticBlack);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.11, 8).rotateX(Math.PI / 2).translate(0, 0, -0.25), mats.dash);
    hbPivot.add(lever, grip);
    hbPivot.rotation.x = 0.12;
  }
  shell.add(hbPivot);
  rig.handbrake = hbPivot;

  // ===== الكراسي =====
  const seat = (x, f, w, back = true) => {
    const m = M4(x, 0, z(f));
    kit.add('seat', new RoundedBoxGeometry(w, 0.13, 0.5, 3, 0.045), new THREE.Matrix4().multiplyMatrices(m, M4(0, 1.07, 0)));
    if (back) kit.add('seat', new RoundedBoxGeometry(w, 0.68, 0.11, 3, 0.045), new THREE.Matrix4().multiplyMatrices(m, M4(0, 1.46, 0.27, 0.15)));
    kit.add('dash', new THREE.BoxGeometry(w * 0.8, 0.42, 0.36), new THREE.Matrix4().multiplyMatrices(m, M4(0, 0.82, 0)));
  };
  seat(DX, 0.92, 0.52);
  kit.add('seat', new RoundedBoxGeometry(0.46, 0.2, 0.09, 3, 0.04), M4(DX, 1.88, z(0.62), 0.15));
  seat(0.52, 0.92, 0.70);
  for (const f of [0.05, -0.78, -1.60]) { seat(-0.27, f, 1.2); seat(0.66, f, 0.42); }
  seat(0, -2.32, 1.74, false);
  kit.add('seat', new RoundedBoxGeometry(1.74, 0.64, 0.11, 3, 0.045), M4(0, 1.45, z(-2.50), 0.08));

  // ===== زينة مصرية: شرّابة + سبحة كهرمان =====
  const fringe = new GeoBuilder();
  const fy = WS_TOP[1] - 0.04, ff = WS_TOP[0] + 0.03;
  fringe.setColor([0.55, 0.05, 0.08]);
  fringe.box(-0.86, fy, z(ff + 0.02), 0.86, fy + 0.035, z(ff - 0.005));
  for (let x = -0.84; x < 0.85; x += 0.06) {
    fringe.setColor(Math.round(x * 16) % 3 === 0 ? [0.85, 0.65, 0.15] : [0.6, 0.05, 0.1]);
    fringe.addGeometry(new THREE.CylinderGeometry(0.004, 0.008, 0.045, 5), M4(x, fy - 0.022, z(ff + 0.01)));
  }
  shell.add(new THREE.Mesh(fringe.build(), mats.decor));

  // مراية جوه (بتعكس فعلًا)
  kit.add('plasticBlack', new THREE.CylinderGeometry(0.009, 0.009, 0.1, 6), M4(0, 2.12, z(1.22)));
  {
    const holder = new THREE.Group();
    holder.position.set(0, 2.03, z(1.24));
    const house = new THREE.Mesh(new RoundedBoxGeometry(0.27, 0.085, 0.03, 2, 0.012), mats.plasticBlack);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 0.068), mats.mirrorDark);
    face.position.z = 0.016;
    holder.add(house, face);
    shell.add(holder);
    rig.mirrors.push({ holder, face, side: 0, aspect: 0.25 / 0.068, fov: 13 });
  }
  const sebha = new THREE.Group();
  sebha.position.set(0, 1.985, z(1.25));
  {
    const bead = new THREE.SphereGeometry(0.0055, 8, 6);
    const g = new GeoBuilder();
    g.setColor([0.75, 0.42, 0.08]);
    for (let i = 0; i < 26; i++) { const a = (i / 26) * Math.PI * 2; g.addGeometry(bead, M4(Math.sin(a) * 0.028, -0.06 - 0.055 * (1 - Math.cos(a)), 0)); }
    g.setColor([0.12, 0.3, 0.7]);
    g.addGeometry(new THREE.SphereGeometry(0.011, 12, 8), M4(0, -0.178, 0));
    g.setColor([0.3, 0.3, 0.3]);
    g.addGeometry(new THREE.CylinderGeometry(0.0015, 0.0015, 0.06, 4), M4(0, -0.03, 0));
    sebha.add(new THREE.Mesh(g.build(), mats.decor));
  }
  shell.add(sebha);
  rig.sebha = sebha;
  // شماسات بيج
  for (const sx of [-0.45, 0.45]) kit.add('beige', new RoundedBoxGeometry(0.44, 0.02, 0.17, 2, 0.01), M4(sx, 2.17, z(1.12), 0.35));

  // عين السواق
  const eye = new THREE.Object3D();
  eye.position.set(DX, 1.80, z(0.98));
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
