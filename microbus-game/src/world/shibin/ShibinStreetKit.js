// =====================================================================
//  تفاصيل الشارع والواجهات (بتخلّي العمارات مش صناديق ملزوقة): كله NearInstancer = draw call واحد لكل نوع،
//  ومتملي بالقريب من الكاميرا بس (البعيد بيفضل الواجهة المرسومة في الـ shader).
//  - بلكونات بارزة (بلاطة + سور محارة بلون العمارة) على الواجهة اللي ع الشارع
//  - واجهة محل: يافطة (أطلس أسماء محلات عامة — مش محلات حقيقية بعينها) + تندة قماش (مقلمة/سادة)، بتنوّر بالليل
//  - أعمدة كهربا خرسانة + سلوك مدلدلة في الشوارع الجانبية والسكنية (طابع الدلتا)
//  - دور أخير "على المحارة": أعمدة خرسانة وحديد تسليح طالع من السطح (أغلب عمارات الطوب الأحمر)
// =====================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { NearInstancer, propMaterial } from './ShibinLandmarks.js';
import { edgePoint } from './ShibinData.js';
import { canvas, tex } from '../../render/textures.js';
import { BUILDING_DIMS } from './ShibinBuildings.js';

const { GF, FH, PARAPET } = BUILDING_DIMS;
const _c = new THREE.Color();
const lin = (r, g, b) => { _c.setRGB(r, g, b, THREE.SRGBColorSpace); return [_c.r, _c.g, _c.b]; };
const M4 = (x, y, z, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, 0)), new THREE.Vector3(sx, sy, sz));

/** geometry بلون واحد + خصائص زيادة ثابتة لكل الرؤوس */
function part(g, rgb, m, extra = {}) {
  g = g.index ? g.toNonIndexed() : g.clone();
  if (m) g.applyMatrix4(m);
  const keepUv = 'aKind' in extra;
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && !(keepUv && k === 'uv')) g.deleteAttribute(k);
  const n = g.attributes.position.count, c = lin(...rgb), a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set(c, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  for (const [k, v] of Object.entries(extra)) g.setAttribute(k, new THREE.BufferAttribute(new Float32Array(n).fill(v), 1));
  if (keepUv && !g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2).fill(0.5), 2));
  return g;
}

// ===================== البلكونة =====================
// الأصل = نص حرف البلاطة على الحيطة، +z = بره الحيطة. اللون الأبيض بيتضرب في لون العمارة (instanceColor)
function balconyGeo() {
  const W = 1.8, D = 0.85, wall = [0.93, 0.92, 0.9], slab = [0.7, 0.69, 0.66];
  return mergeGeometries([
    part(new THREE.BoxGeometry(W, 0.14, D), slab, M4(0, 0.07, D / 2)),               // البلاطة
    part(new THREE.BoxGeometry(W, 0.95, 0.09), wall, M4(0, 0.6, D - 0.045)),         // السور القدامي
    part(new THREE.BoxGeometry(0.09, 0.95, D - 0.09), wall, M4(-W / 2 + 0.045, 0.6, D / 2 - 0.045)),
    part(new THREE.BoxGeometry(0.09, 0.95, D - 0.09), wall, M4(W / 2 - 0.045, 0.6, D / 2 - 0.045)),
    part(new THREE.BoxGeometry(W + 0.06, 0.06, 0.16), slab, M4(0, 1.1, D - 0.05)),   // الدروة فوق السور
  ]);
}

// ===================== واجهة المحل (يافطة + تندة) =====================
// aKind: 0 وش اليافطة (من الأطلس) / 1 قماش التندة (خانة نقشة) / 2 حديد/خشب (لون الرؤوس بس)
const SIGN_COLS = 4, SIGN_ROWS = 10; // 6 صفوف يافطات (24) + صفين نقشات تندة (8) + صفين إعلانات (8)
function shopGeo() {
  const W = 3.0, dark = [0.18, 0.18, 0.19], white = [1, 1, 1];
  const face = new THREE.PlaneGeometry(W - 0.12, 0.62);
  // التندة: سطح مايل من الحيطة (2.85م) لبره (1.05م) لتحت (2.35م) + كشكشة قدام
  const canvasG = new THREE.PlaneGeometry(W, 1.15);
  const flap = new THREE.PlaneGeometry(W, 0.22);
  return mergeGeometries([
    part(new THREE.BoxGeometry(W, 0.72, 0.1), dark, M4(0, 3.22, 0.05), { aKind: 2 }),              // برواز اليافطة
    part(face, white, M4(0, 3.22, 0.105), { aKind: 0 }),                                          // وش اليافطة
    part(canvasG, white, M4(0, 2.6, 0.52, 0, 1, 1, 1, -1.12), { aKind: 1 }),                       // سطح التندة (مايل)
    part(flap, white, M4(0, 2.24, 1.05), { aKind: 1 }),
    part(new THREE.BoxGeometry(0.04, 0.04, 1.1), dark, M4(-W / 2 + 0.05, 2.57, 0.52, 0, 1, 1, 1, 0.456), { aKind: 2 }), // دراع
    part(new THREE.BoxGeometry(0.04, 0.04, 1.1), dark, M4(W / 2 - 0.05, 2.57, 0.52, 0, 1, 1, 1, 0.456), { aKind: 2 }),
  ]);
}

// أسماء أنواع محلات عامة (مفيش اسم محل حقيقي) — اللي بتلاقيه في أي شارع تجاري في شبين
const SHOPS = [
  ['سوبر ماركت', '#1d6b3a'], ['صيدلية', '#0f7d4a'], ['مخبز بلدي', '#9a5a1c'], ['عصير قصب', '#3d7a1e'],
  ['كشري', '#b3261e'], ['فول وطعمية', '#c47a12'], ['موبايلات واكسسوارات', '#123f7a'], ['ملابس أطفال', '#b0306a'],
  ['أدوات منزلية', '#2d4f6b'], ['حلاق', '#1a1a1a'], ['مكتبة وأدوات مدرسية', '#2b5d8a'], ['أدوات كهربائية', '#d1a000'],
  ['ألوميتال', '#4a4f55'], ['مشويات', '#7a1d12'], ['حلواني', '#a33c6b'], ['عطارة', '#6b4a1e'],
  ['جزارة', '#8a1010'], ['خضار وفاكهة', '#2f7a2a'], ['مكوجي', '#3a5f8a'], ['قطع غيار', '#222831'],
  ['نظارات', '#0e5a6b'], ['بوتيك', '#5b2a6b'], ['استوديو تصوير', '#303030'], ['مفروشات', '#7a4a2a'],
];
const AWN = [ // نقشات التندة: [لون1, لون2 (مقلمة) أو null]
  ['#1f6b3a', '#e8e4d8'], ['#a8231c', '#efe9dc'], ['#1f4f8a', '#e8e6df'], ['#c86a12', null],
  ['#2b6b2b', null], ['#cdbb94', null], ['#244a7a', null], ['#b3261e', '#e3b33a'],
];
const ADS = [
  ['شقق للبيع', 'تقسيط على ٥ سنين', '#f2f2ee', '#b3261e'], ['مدرسة لغات', 'التقديم مفتوح', '#123f7a', '#fff'],
  ['عيادة أسنان', 'تركيبات وتقويم', '#e8f4f4', '#0e5a6b'], ['مركز دروس', 'ثانوية عامة', '#d1a000', '#1b1b1b'],
  ['معرض أثاث', 'غرف نوم وسفرة', '#5b2a1e', '#ffe7b0'], ['قاعة أفراح', 'حجز المواسم', '#6b1e4a', '#fff'],
  ['تكييفات', 'بيع وصيانة', '#1f6b8a', '#fff'], ['انترنت منزلي', 'تركيب في نفس اليوم', '#2f7a2a', '#fff'],
];
function shopAtlas() {
  const CW = 512, CH = 128, c = canvas(CW * SIGN_COLS, CH * SIGN_ROWS), x = c.getContext('2d');
  SHOPS.forEach(([name, bg], i) => {
    const cx = (i % SIGN_COLS) * CW, cy = Math.floor(i / SIGN_COLS) * CH;
    x.fillStyle = bg; x.fillRect(cx, cy, CW, CH);
    x.fillStyle = 'rgba(255,255,255,0.12)'; x.fillRect(cx, cy, CW, CH * 0.45);
    x.strokeStyle = 'rgba(255,255,255,0.75)'; x.lineWidth = 4; x.strokeRect(cx + 7, cy + 7, CW - 14, CH - 14);
    x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.direction = 'rtl';
    let fs = 64; x.font = `bold ${fs}px Cairo, sans-serif`;
    while (x.measureText(name).width > CW - 50 && fs > 26) { fs -= 4; x.font = `bold ${fs}px Cairo, sans-serif`; }
    x.fillText(name, cx + CW / 2, cy + CH / 2 + 4);
  });
  AWN.forEach(([a, b], i) => {
    const cx = (i % SIGN_COLS) * CW, cy = (6 + Math.floor(i / SIGN_COLS)) * CH;
    x.fillStyle = a; x.fillRect(cx, cy, CW, CH);
    if (b) { x.fillStyle = b; for (let k = 0; k < 8; k++) x.fillRect(cx + k * 64 + 32, cy, 32, CH); }
    x.fillStyle = 'rgba(0,0,0,0.12)'; x.fillRect(cx, cy + CH - 14, CW, 14); // وسخ على الطرف
  });
  // إعلانات عامة (مفيش ماركة حقيقية): نفس نوعية اليفط اللي فوق عمارات الشوارع الرئيسية
  ADS.forEach(([t1, t2, bg, fg], i) => {
    const cx = (i % SIGN_COLS) * CW, cy = (8 + Math.floor(i / SIGN_COLS)) * CH;
    x.fillStyle = bg; x.fillRect(cx, cy, CW, CH);
    x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle'; x.direction = 'rtl';
    x.font = 'bold 50px Cairo, sans-serif'; x.fillText(t1, cx + CW / 2, cy + 44);
    x.font = 'bold 30px Cairo, sans-serif'; x.fillText(t2, cx + CW / 2, cy + 98);
  });
  x.fillStyle = '#fff'; x.fillRect(0, 6 * CH, 24, 24); // بكسلات بيضا للحديد/الخشب (لونهم من الرؤوس)
  const t = tex(c, { repeat: false, aniso: 4 });
  return t;
}
function shopMaterial(map) {
  const U = { uNight: { value: 0 } };
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, map, roughness: 0.75, metalness: 0, side: THREE.DoubleSide });
  m.userData.U = U;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aKind; attribute float aSign; attribute float aAwn; varying float vSignF;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>
{ float cell = aKind < 0.5 ? aSign : aKind < 1.5 ? 24.0 + aAwn : 24.0;
  vec2 f = aKind < 0.5 ? uv : aKind < 1.5 ? vec2(uv.x, 0.5) : vec2(0.02, 0.97); // 2: المربع الأبيض فوق شمال خانة 24
  vMapUv = vec2((mod(cell, 4.0) + clamp(f.x, 0.01, 0.99)) / 4.0, 1.0 - (floor(cell / 4.0) + 1.0 - clamp(f.y, 0.02, 0.98)) / 10.0);
  vSignF = aKind < 0.5 ? 1.0 : 0.0; }`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nif (aKind > 0.5 && aKind < 1.5 && aAwn < 0.0) transformed = vec3(0.0);'); // من غير تندة
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight; varying float vSignF;')
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance = sampledDiffuseColor.rgb * vSignF * uNight * 0.85;');
  };
  m.customProgramCacheKey = () => 'shibin-shopfront-1';
  return m;
}

// ===================== يافطة إعلان فوق السطح (رجلين حديد + برواز + وش) =====================
function billboardGeo() {
  const iron = [0.22, 0.22, 0.23], W = 6.4, H = 2.4;
  return mergeGeometries([
    part(new THREE.BoxGeometry(0.14, 2.2, 0.14), iron, M4(-W / 3, 1.1, 0), { aKind: 2 }),
    part(new THREE.BoxGeometry(0.14, 2.2, 0.14), iron, M4(W / 3, 1.1, 0), { aKind: 2 }),
    part(new THREE.BoxGeometry(0.1, 1.5, 0.1), iron, M4(-W / 3, 1.0, -0.6, 0, 1, 1, 1, 0.6), { aKind: 2 }),
    part(new THREE.BoxGeometry(0.1, 1.5, 0.1), iron, M4(W / 3, 1.0, -0.6, 0, 1, 1, 1, 0.6), { aKind: 2 }),
    part(new THREE.BoxGeometry(W + 0.2, H + 0.2, 0.12), iron, M4(0, 2.2 + H / 2, 0), { aKind: 2 }),
    part(new THREE.PlaneGeometry(W, H), [1, 1, 1], M4(0, 2.2 + H / 2, 0.065), { aKind: 0 }),
  ]);
}

// ===================== عمود الكهربا + السلك =====================
function poleGeo() {
  const con = [0.66, 0.65, 0.62], dark = [0.2, 0.2, 0.21];
  const shaft = new THREE.CylinderGeometry(0.09, 0.15, 8.6, 6, 1, true);
  return mergeGeometries([
    part(shaft, con, M4(0, 4.3, 0)),
    part(new THREE.BoxGeometry(0.1, 0.1, 1.5), dark, M4(0, 8.0, 0)),        // الدراع (عمودي على الشارع)
    part(new THREE.CylinderGeometry(0.05, 0.05, 0.16, 5), [0.85, 0.84, 0.8], M4(0, 8.13, -0.6)),
    part(new THREE.CylinderGeometry(0.05, 0.05, 0.16, 5), [0.85, 0.84, 0.8], M4(0, 8.13, 0)),
    part(new THREE.CylinderGeometry(0.05, 0.05, 0.16, 5), [0.85, 0.84, 0.8], M4(0, 8.13, 0.6)),
    part(new THREE.BoxGeometry(0.34, 0.5, 0.26), [0.5, 0.52, 0.5], M4(0.2, 6.6, 0)),  // علبة توزيع
  ]);
}
// 3 سلوك من x=0 لـ x=1 بدلدلة ثابتة (الـ scale.x = المسافة للعمود اللي بعده)
function wireGeo() {
  const pos = [], SEG = 8, SAG = 0.45, H = 0.025;
  for (const z of [-0.6, 0, 0.6]) {
    for (let i = 0; i < SEG; i++) {
      const t0 = i / SEG, t1 = (i + 1) / SEG, y0 = 8.2 - SAG * 4 * t0 * (1 - t0), y1 = 8.2 - SAG * 4 * t1 * (1 - t1);
      pos.push(t0, y0, z, t1, y1, z, t1, y1 + H, z, t0, y0, z, t1, y1 + H, z, t0, y0 + H, z);
      pos.push(t0, y0 + H / 2, z - H, t1, y1 + H / 2, z - H, t1, y1 + H / 2, z + H, t0, y0 + H / 2, z - H, t1, y1 + H / 2, z + H, t0, y0 + H / 2, z + H);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// ===================== دور على المحارة: عمود خرسانة + أسياخ =====================
function rebarGeo() {
  const con = [0.6, 0.59, 0.56], rust = [0.36, 0.2, 0.12];
  const parts = [part(new THREE.BoxGeometry(0.32, 1.1, 0.32), con, M4(0, 0.55, 0))];
  for (const [dx, dz] of [[-0.09, -0.09], [0.09, -0.09], [-0.09, 0.09], [0.09, 0.09]]) parts.push(part(new THREE.BoxGeometry(0.025, 0.75, 0.025), rust, M4(dx, 1.47, dz, 0, 1, 1, 1, dx * 0.6)));
  return mergeGeometries(parts);
}

const hash = (a, b, k) => { const v = Math.sin((a * 12.9898 + b * 78.233 + k * 37.719) * 0.01) * 43758.5453; return v - Math.floor(v); };
// ألوان البلكونات: نفس عيلة ألوان المحارة (TINTS في ShibinBuildings) + خرسانة للطوب
const BAL_TINTS = [[0.93, 0.9, 0.84], [0.88, 0.76, 0.58], [0.9, 0.82, 0.66], [0.86, 0.7, 0.62], [0.9, 0.82, 0.55], [0.78, 0.76, 0.72]].map((c) => lin(...c));
const CONCRETE = lin(0.7, 0.69, 0.66);

export class StreetKit {
  constructor(W, { low = false, tier = 'high' } = {}) {
    this.W = W; this.low = low;
    const hi = !low && tier === 'high'; // الأعمدة بضل في HIGH بس
    this.group = new THREE.Group(); this.group.name = 'street-kit';
    const PM = propMaterial();
    this.balcony = new NearInstancer(balconyGeo(), PM, { R: low ? 70 : 110, max: low ? 200 : 520, name: 'kit-balcony', colors: true, castShadow: !low });
    this.shopMat = shopMaterial(shopAtlas());
    this.shop = new NearInstancer(shopGeo(), this.shopMat, { R: low ? 75 : 120, max: low ? 110 : 260, name: 'kit-shopfront', attrs: ['aSign', 'aAwn'] }); // من غير ضل: التندة المخفية بتتشال في الـ vertex shader والضل مش هيعرف
    this.pole = new NearInstancer(poleGeo(), PM, { R: low ? 110 : 170, max: low ? 50 : 110, name: 'kit-pole', castShadow: hi });
    this.wire = new NearInstancer(wireGeo(), new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.9, side: THREE.DoubleSide }), { R: low ? 110 : 170, max: low ? 50 : 110, name: 'kit-wire' });
    this.rebar = low ? null : new NearInstancer(rebarGeo(), PM, { R: 130, max: 220, name: 'kit-rebar' });
    this.board = new NearInstancer(billboardGeo(), this.shopMat, { R: low ? 220 : 320, max: low ? 8 : 16, name: 'kit-billboard', attrs: ['aSign', 'aAwn'] });
    this.all = [this.balcony, this.shop, this.pole, this.wire, this.rebar, this.board].filter(Boolean);
    for (const n of this.all) this.group.add(n.mesh);
    this._poles(W);
    this.stats = { poles: this.pole.items.length };
  }

  /** عمارات مربع اتحمل: [cx, cz, w, d, angle, floors, style, flags] */
  addTile(tag, list) {
    for (const b of list) {
      const [cx, cz, w, d, a, floors, style, flags] = b;
      const ca = Math.cos(a), sa = Math.sin(a);
      const at = (lx, lz) => [cx + lx * ca + lz * sa, cz - lx * sa + lz * ca];
      const r = (k) => hash(cx, cz, k);
      const brick = style < 2.5;
      // البلكونات: نفس تقسيمة الشبابيك في الـ shader (bays = w/3.3)
      if (floors >= 2 && w >= 5.5 && r(1) < (brick ? 0.55 : 0.8)) {
        const bays = Math.max(1, Math.round(w / 3.3)), bw = w / bays, pat = Math.floor(r(2) * 3);
        const col = brick ? (r(3) < 0.5 ? CONCRETE : lin(0.62, 0.34, 0.24)) : BAL_TINTS[Math.floor(r(3) * BAL_TINTS.length)];
        for (let bi = 0; bi < bays; bi++) {
          if (pat === 0 && bi % 2) continue;                              // كل تاني فتحة
          if (pat === 1 && bays > 2 && (bi === 0 || bi === bays - 1)) continue; // الوسط بس
          const lx = (bi + 0.5) * bw - w / 2;
          for (let f = 0; f < floors; f++) {
            if (hash(cx + bi, cz + f, 7) < 0.12) continue; // بلكونة اتقفلت/مش موجودة
            const [x, z] = at(lx, d / 2);
            this.balcony.add(x, GF + f * FH, z, a, 1, 1, tag, { sx: Math.min(1, (bw - 0.4) / 1.8), sz: 1, color: col });
          }
        }
      }
      // واجهات المحلات: الدور الأرضي التجاري
      if (flags & 1) {
        const sb = Math.max(1, Math.round(w / 3.4)), sw = w / sb;
        for (let k = 0; k < sb; k++) {
          if (hash(cx, cz + k, 11) < 0.3) continue; // مدخل عمارة/محل مقفول من غير يافطة
          const lx = (k + 0.5) * sw - w / 2, [x, z] = at(lx, d / 2 + 0.01);
          const sign = Math.floor(hash(cx + k, cz, 13) * SHOPS.length), awn = hash(cz, cx + k, 17) < 0.65 ? Math.floor(hash(cx, k, 19) * AWN.length) : -1;
          this.shop.add(x, 0, z, a, 1, 1, tag, { sx: (sw - 0.25) / 3.0, sz: 1, a: [sign, awn] });
        }
      }
      // إعلان فوق السطح: عمارات عالية على الشوارع التجارية (قليل)
      if ((flags & 1) && floors >= 4 && w >= 8 && r(8) < 0.07) {
        const [x, z] = at(0, d / 2 - 1.2);
        this.board.add(x, GF + floors * FH + PARAPET - 0.02, z, a, 1, 1, tag, { sx: Math.min(1.2, (w - 1) / 6.6), sz: 1, a: [32 + Math.floor(r(9) * ADS.length), -1] });
      }
      // دور على المحارة (أعمدة وأسياخ في الأركان): أغلبها عمارات طوب
      if (this.rebar && floors >= 2 && r(5) < (brick ? 0.4 : 0.1)) {
        const y = GF + floors * FH + PARAPET - 0.02, hw = w / 2 - 0.25, hd = d / 2 - 0.25;
        const pts = [[-hw, hd], [hw, hd], [-hw, -hd], [hw, -hd]];
        if (w > 9) pts.push([0, hd]);
        for (const [lx, lz] of pts) { const [x, z] = at(lx, lz); this.rebar.add(x, y, z, a, 1, 1, tag); }
      }
    }
  }
  removeTile(tag) { for (const n of this.all) n.removeTag(tag); }

  /** أعمدة الكهربا والسلك: الشوارع الجانبية/السكنية (الرئيسية فيها عواميد نور بس) */
  _poles(W) {
    const CLS = new Set(['residential', 'unclassified', 'tertiary', 'living_street', 'tertiary_link']);
    const q = {};
    let seed = 7;
    const R = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (const e of W.graph.edges) {
      if (!CLS.has(e.cls) || e.closed || e.elevated || e.length < 40) continue;
      const sd = R() < 0.5 ? 1 : -1, off = e.half + 0.45;
      let prev = null;
      for (let s = 6 + R() * 8; s < e.length - 6; s += 30 + R() * 8) {
        edgePoint(e, s, q);
        const x = q.x - q.dz * sd * off, z = q.z + q.dx * sd * off;
        const yaw = Math.atan2(q.dx, q.dz) + Math.PI / 2; // الدراع عمودي على الشارع
        const p = this.pole.add(x, 0.15, z, yaw);
        if (prev) {
          const dx = x - prev.x, dz = z - prev.z, L = Math.hypot(dx, dz);
          if (L < 46) this.wire.add(prev.x, 0.15, prev.z, Math.atan2(-dz, dx), 1, 1, undefined, { sx: L, sz: 1, from: prev, to: p });
        }
        prev = p;
      }
    }
    const onWalk = (x, z) => {
      const Tl = W.tiles.get(W._tkey(Math.floor(x / W.TS), Math.floor(z / W.TS)));
      if (!Tl || !Tl.ready) return undefined;
      if (W._underDeck?.(x, z)) return false;
      return Math.abs(W.height(x, z, 0) - 0.15) < 0.01;
    };
    this.pole.check = (it) => onWalk(it.x, it.z);
    // السلك بيظهر لو العمودين الاتنين اتحطوا
    this.wire.check = (it) => { const a = it.ext.from, b = it.ext.to; const ka = a.ok ?? onWalk(a.x, a.z), kb = b.ok ?? onWalk(b.x, b.z); if (ka === undefined || kb === undefined) return undefined; return ka && kb; };
  }

  update(cam) { for (const n of this.all) n.update(cam); }
  setNight(on) { this.shopMat.userData.U.uNight.value = on ? 1 : 0; }
  get visible() { return this.all.reduce((s, n) => s + n.visibleCount, 0); }
}
