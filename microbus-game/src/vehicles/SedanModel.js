import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildWheel } from './wheel.js';
import { vehicleMaterials } from '../render/materials.js';
import { canvas, tex } from '../render/textures.js';
import { contactShadow } from './CarModels.js';

// =====================================================================
//  سيدان بنسب BYD F3 (تاكسي شبين الكوم في الصورة المرجعية):
//  الجسم "مسحوب" (loft) من مقاطع عرضية على طول العربية → سطح ناعم واحد من غير أجزاء طايرة.
//  التفاصيل (الشريطة الصفرا، فواصل الأبواب، الكشافات، الفوانيس، الشبكة، الشعار) بتترسم في الشيدر
//  من مكان النقطة على الجسم → حادة على أي موبايل ومن غير مثلثات زيادة.
//  نفس الشكل للتاكسي والملاكي والشرطة (geometry مشتركة)، والفرق في الخامة بس.
// =====================================================================

export const SEDAN = {
  zFront: -2.11, zRear: 2.42, axleF: -1.25, axleR: 1.39, wheelR: 0.31, track: 1.46,
  halfWidth: 0.852, roof: 1.49,
};

// ===== منحنيات ناعمة من غير ما تفلت (monotone cubic) =====
function mono(pts) {
  const n = pts.length, xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b;
    if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (x > xs[i + 1]) i++;
    const hh = xs[i + 1] - xs[i], t = (x - xs[i]) / hh, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * hh * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * hh * m[i + 1];
  };
}

// الأرض تحت العربية، خط الكتف (الحزام)، خط النص من فوق (كبوت ← زجاج ← سقف ← زجاج ورا ← شنطة)، ونص العرض
const yBottom = mono([[-2.11, 0.42], [-2.03, 0.31], [-1.88, 0.245], [-1.6, 0.215], [1.85, 0.215], [2.18, 0.265], [2.34, 0.33], [2.42, 0.44]]);
const yBelt = mono([[-2.11, 0.64], [-2.05, 0.735], [-1.88, 0.80], [-1.45, 0.855], [-0.95, 0.915], [-0.4, 0.95], [0.6, 0.972], [1.6, 0.995], [2.2, 1.0], [2.36, 0.985], [2.42, 0.93]]);
const yTop = mono([[-2.11, 0.69], [-2.02, 0.80], [-1.75, 0.865], [-1.3, 0.915], [-1.0, 0.955], [-0.72, 1.13], [-0.5, 1.31], [-0.3, 1.43], [0.1, 1.49], [0.6, 1.475], [0.9, 1.43], [1.2, 1.26], [1.48, 1.1], [1.62, 1.045], [2.2, 1.027], [2.36, 1.005], [2.42, 0.95]]);
const halfW = mono([[-2.11, 0.62], [-2.06, 0.71], [-1.95, 0.785], [-1.72, 0.836], [-1.2, 0.851], [1.6, 0.852], [2.15, 0.836], [2.32, 0.80], [2.42, 0.73]]);
const roofEdge = mono([[-1.0, 0.80], [-0.72, 0.72], [-0.35, 0.648], [0.4, 0.632], [0.9, 0.645], [1.25, 0.70], [1.55, 0.78]]);

const ARCH_R = 0.375;

/** المقطع العرضي (النص اليمين) عند z: نقاط تحكم من نص الأرضية لنص السقف */
function section(z) {
  const yB = yBottom(z), yBe = yBelt(z), yC = yTop(z), hw = halfW(z);
  // قد إيه الصالون "طالع" هنا (0 = كبوت/شنطة، 1 = سقف كامل)
  const g = THREE.MathUtils.clamp((yC - yBe - 0.04) / 0.4, 0, 1);
  const gx = THREE.MathUtils.lerp(hw * 0.86, Math.min(roofEdge(z), hw * 0.9), g);
  const gy = THREE.MathUtils.lerp(yBe + 0.03, yC - 0.075, g);
  return [
    [0, yB],
    [hw * 0.86, yB],
    [hw * 0.985, yB + 0.06],
    [hw, yB + (yBe - yB) * 0.5],
    [hw * 0.99, yBe - 0.06],
    [hw * 0.962, yBe],
    [gx, gy],
    [THREE.MathUtils.lerp(hw * 0.5, gx * 0.62, g), yC - THREE.MathUtils.lerp(0.012, 0.02, g)],
    [0, yC],
  ];
}

/** Catmull-Rom على نقط المقطع (sub نقط بين كل اتنين) + رقم الجزء لكل نقطة (عشان نعرف الزجاج من الصاج) */
function subdivide(ctrl, sub) {
  const out = [], seg = [];
  const P = [ctrl[0], ...ctrl, ctrl[ctrl.length - 1]];
  for (let i = 1; i < P.length - 2; i++) {
    for (let k = 0; k < sub; k++) {
      const t = k / sub, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(P[i - 1][0], P[i][0], P[i + 1][0], P[i + 2][0]), f(P[i - 1][1], P[i][1], P[i + 1][1], P[i + 2][1])]);
      seg.push(i - 1 + t);
    }
  }
  out.push(ctrl[ctrl.length - 1]); seg.push(ctrl.length - 1);
  return { pts: out, seg };
}

const _geoCache = {};
/** جسم العربية: group 0 = صاج (كل التفاصيل في الشيدر)، group 1 = زجاج */
export function sedanBodyGeometry(lod = 0) {
  if (_geoCache[lod]) return _geoCache[lod];
  const sub = lod ? 2 : 4;
  // محطات على الطول: أكتر عند الأطراف والزجاج (عشان المنحنيات تبقى ناعمة)
  const zs = [];
  for (let z = SEDAN.zFront; z < SEDAN.zRear; ) {
    zs.push(z);
    const near = Math.min(Math.abs(z - SEDAN.zFront), Math.abs(z - SEDAN.zRear));
    const step = (lod ? 0.11 : 0.055) * (near < 0.25 ? 0.4 : 1);
    z += step;
  }
  zs.push(SEDAN.zRear);
  const rows = [];
  for (const z of zs) {
    const { pts, seg } = subdivide(section(z), sub);
    // نص المقطع اليمين + المرآة (الشمال) → حلقة كاملة
    const ring = [];
    for (let i = 0; i < pts.length; i++) ring.push([pts[i][0], pts[i][1], seg[i]]);
    for (let i = pts.length - 2; i > 0; i--) ring.push([-pts[i][0], pts[i][1], seg[i]]);
    rows.push({ z, ring });
  }
  const R = rows[0].ring.length;
  const pos = [], segAttr = [];
  for (const { z, ring } of rows) for (const [x, y, sg] of ring) { pos.push(x, y, z); segAttr.push(sg); }
  // قص أقواس العجل: النقط اللي جوه دايرة القوس (من الجنب) بتتزق على حرف القوس
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    if (Math.abs(x) < halfW(z) * 0.55) continue;
    for (const za of [SEDAN.axleF, SEDAN.axleR]) {
      const dz = z - za, dy = y - SEDAN.wheelR;
      // جوه القوس → بتطلع لفوق على حرف القوس (اللي تحت نص العجلة = فتحة القوس نفسها)
      if (Math.abs(dz) < ARCH_R && Math.hypot(dz, Math.max(dy, 0)) < ARCH_R) pos[i + 1] = Math.max(y, SEDAN.wheelR + Math.sqrt(ARCH_R * ARCH_R - dz * dz));
    }
  }
  const idxBody = [], idxGlass = [];
  const vid = (r, c) => r * R + (c % R);
  // تصنيف كل مربع: زجاج ولا صاج (من مكانه على المقطع وعلى الطول)
  const isGlass = (r, c) => {
    const z = (rows[r].z + rows[Math.min(r + 1, rows.length - 1)].z) / 2;
    const half = Math.floor(R / 2);
    const cc = c > half ? R - c : c; // نفس العمود على الناحيتين
    const sg = (segAttr[vid(r, cc)] + segAttr[vid(r, cc + 1)]) / 2;
    const x = Math.abs((pos[vid(r, cc) * 3] + pos[vid(r, cc + 1) * 3]) / 2);
    const y = (pos[vid(r, cc) * 3 + 1] + pos[vid(r, cc + 1) * 3 + 1]) / 2;
    const g = THREE.MathUtils.clamp((yTop(z) - yBelt(z) - 0.04) / 0.4, 0, 1);
    const gx = THREE.MathUtils.lerp(halfW(z) * 0.86, Math.min(roofEdge(z), halfW(z) * 0.9), g);
    if (sg >= 5.15 && sg <= 5.92) {
      // الشبابيك الجانبية (من غير عمود B في النص)
      return z > -0.92 && z < 1.22 && !(z > 0.1 && z < 0.21) && y > yBelt(z) + 0.035 && y < yTop(z) - 0.09;
    }
    if (sg > 6.02) {
      const ws = z > -0.97 && z < -0.34, rw = z > 0.95 && z < 1.55;
      return (ws || rw) && x < gx * 0.9 - 0.04;
    }
    return false;
  };
  for (let r = 0; r < rows.length - 1; r++) {
    for (let c = 0; c < R; c++) {
      const a = vid(r, c), b = vid(r, c + 1), d = vid(r + 1, c), e = vid(r + 1, c + 1);
      const list = isGlass(r, c) ? idxGlass : idxBody;
      list.push(a, b, d, b, e, d); // الوش لبره
    }
  }
  // غطيان الأطراف (قدام وورا): مروحة من نص المقطع
  const capFan = (r, flip) => {
    const ring = rows[r].ring;
    let cx = 0, cy = 0; for (const [x, y] of ring) { cx += x; cy += y; } cx /= ring.length; cy /= ring.length;
    const ci = pos.length / 3; pos.push(cx, cy, rows[r].z); segAttr.push(-1);
    for (let c = 0; c < R; c++) { const a = vid(r, c), b = vid(r, c + 1); if (flip) idxBody.push(ci, a, b); else idxBody.push(ci, b, a); }
  };
  capFan(0, false); capFan(rows.length - 1, true);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex([...idxBody, ...idxGlass]);
  geo.addGroup(0, idxBody.length, 0);
  geo.addGroup(idxBody.length, idxGlass.length, 1);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  _geoCache[lod] = geo;
  return geo;
}

// ===== الألوان (Liveries) =====
export const SEDAN_LIVERIES = {
  // تاكسي شبين الكوم: أخضر فاتح + شريطة صفرا مايلة قدام وورا + دايرة سودا على الباب + شيال سقف
  taxi: { paint: 0x19b82a, stripe: 0xf5d000, stripes: 1, emblem: 1, rack: true },
  // الشرطة: أبيض وتحت كحلي + كلمة شرطة + كشاف سقف
  police: { paint: 0xf2f3f4, lower: 0x14285a, police: 1, lightbar: true },
};

let _plateTex = null, _bydTex = null, _policeTex = null;
function plateTexture() {
  if (_plateTex) return _plateTex;
  const c = canvas(256, 128), x = c.getContext('2d');
  x.fillStyle = '#f4f4ee'; x.fillRect(0, 0, 256, 128);
  x.fillStyle = '#f08a1c'; x.fillRect(0, 0, 256, 34);
  x.strokeStyle = '#222'; x.lineWidth = 6; x.strokeRect(3, 3, 250, 122);
  x.fillStyle = '#1a1a1a'; x.font = 'bold 22px Cairo, sans-serif'; x.textBaseline = 'middle';
  x.textAlign = 'left'; x.fillText('EGYPT', 12, 18); x.textAlign = 'right'; x.direction = 'rtl'; x.fillText('مصر', 244, 18);
  x.font = 'bold 54px Cairo, sans-serif'; x.textAlign = 'center'; x.fillText('أ ن ه  ١٥٨٣', 128, 84);
  _plateTex = tex(c, { repeat: false });
  return _plateTex;
}
function bydTexture() {
  if (_bydTex) return _bydTex;
  const c = canvas(128, 64), x = c.getContext('2d');
  x.fillStyle = '#d8dde2'; x.beginPath(); x.ellipse(64, 32, 60, 28, 0, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#1c2026'; x.beginPath(); x.ellipse(64, 32, 52, 22, 0, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#e8ecef'; x.font = 'bold 30px Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('BYD', 64, 34);
  _bydTex = tex(c, { repeat: false });
  return _bydTex;
}
function policeTexture() {
  if (_policeTex) return _policeTex;
  const c = canvas(512, 128), x = c.getContext('2d');
  x.clearRect(0, 0, 512, 128);
  x.fillStyle = '#14285a'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.direction = 'rtl';
  x.font = 'bold 70px Cairo, sans-serif'; x.fillText('شرطة', 170, 66);
  x.direction = 'ltr'; x.font = 'bold 52px Arial, sans-serif'; x.fillText('POLICE', 380, 68);
  _policeTex = tex(c, { repeat: false });
  return _policeTex;
}

const _matCache = new Map();
/**
 * خامة الصاج بكل التفاصيل المرسومة: livery = 'taxi' | 'police' | رقم لون (ملاكي)
 * U.uHead / U.uTail / U.uBrake / U.uRev بيتحكموا في نور الكشافات والفوانيس (emissive)
 */
export function sedanPaintMaterial(livery = 'taxi', { unique = false } = {}) {
  const key = String(livery);
  if (!unique && _matCache.has(key)) return _matCache.get(key);
  const L = typeof livery === 'number' ? { paint: livery } : SEDAN_LIVERIES[livery] || SEDAN_LIVERIES.taxi;
  const mat = new THREE.MeshPhysicalMaterial({ color: L.paint, roughness: 0.36, metalness: 0.0, clearcoat: 0.55, clearcoatRoughness: 0.14, envMapIntensity: 0.75 });
  const U = {
    uStripe: { value: new THREE.Color(L.stripe ?? 0xf3d20f) }, uStripes: { value: L.stripes ? 1 : 0 },
    uEmblem: { value: L.emblem ? 1 : 0 }, uLower: { value: new THREE.Color(L.lower ?? 0x000000) }, uPolice: { value: L.police ? 1 : 0 },
    uPoliceTex: { value: policeTexture() },
    uHead: { value: 0 }, uTail: { value: 0.12 }, uBrake: { value: 0 }, uRev: { value: 0 },
  };
  mat.userData.U = U;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vP; varying vec3 vN0;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvP = position; vN0 = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vP; varying vec3 vN0;
uniform vec3 uStripe, uLower; uniform float uStripes, uEmblem, uPolice, uHead, uTail, uBrake, uRev;
uniform sampler2D uPoliceTex;
float bandLine(vec2 p, vec2 a, vec2 b, float w) { vec2 d = normalize(b - a); vec2 n = vec2(-d.y, d.x); float t = dot(p - a, d); float L = length(b - a); return step(abs(dot(p - a, n)), w) * step(0.0, t) * step(t, L); }
float lineZ(float z, float z0, float w) { return 1.0 - smoothstep(w * 0.5, w, abs(z - z0)); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
vec3 emis = vec3(0.0);
float rough = roughness;
{
  float ax = abs(vP.x);
  vec3 n = normalize(vN0);
  float side = smoothstep(0.35, 0.6, abs(n.x));
  float front = smoothstep(0.35, 0.65, -n.z);
  float rear = smoothstep(0.35, 0.65, n.z);
  float top = smoothstep(0.45, 0.7, n.y);
  vec2 sz = vec2(vP.z, vP.y);
  // ===== الشريطة الصفرا (قدام: من باب السواق لحد تحت الكشاف، ورا: على الربع الخلفي) =====
  if (uStripes > 0.5) {
    float s1 = bandLine(sz, vec2(-1.06, 1.02), vec2(-1.93, 0.34), 0.13);
    float s2 = bandLine(sz, vec2(1.12, 1.02), vec2(1.66, 0.36), 0.09);
    float m = max(s1, s2) * side * step(vP.y, 0.985);
    diffuseColor.rgb = mix(diffuseColor.rgb, uStripe, m);
  }
  // ===== الشرطة: نص تحت كحلي + كلمة شرطة على الباب =====
  if (uPolice > 0.5) {
    float lowerPart = side * (1.0 - smoothstep(0.66, 0.675, vP.y)) * step(0.3, vP.y);
    diffuseColor.rgb = mix(diffuseColor.rgb, uLower, lowerPart);
    vec2 uv = vec2((vP.z - (-0.85)) / 1.9, (vP.y - 0.68) / 0.2);
    if (vP.x > 0.0) uv.x = 1.0 - uv.x;
    if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.08, 0.16, 0.36), texture2D(uPoliceTex, uv).a * side);
  }
  // ===== الدايرة السودا على الباب القدام =====
  if (uEmblem > 0.5) {
    float r = length(sz - vec2(-0.5, 0.72));
    float disc = (1.0 - smoothstep(0.1, 0.104, r)) * side;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03), disc);
    float ring = (1.0 - smoothstep(0.004, 0.008, abs(r - 0.075))) * side;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.75), ring * 0.8);
  }
  // ===== فواصل الأبواب والكبوت والشنطة (خطوط غامقة رفيعة) =====
  float gaps = 0.0;
  float lowerSide = side * step(0.26, vP.y);
  gaps += lineZ(vP.z, -0.97 + (vP.y - 0.95) * -0.12, 0.006) * lowerSide * step(vP.y, 1.0);   // قدام الباب القدام
  gaps += lineZ(vP.z, 0.155, 0.006) * lowerSide;                                             // بين البابين (عمود B)
  gaps += lineZ(vP.z, 1.13 + (vP.y - 0.95) * 0.25, 0.006) * lowerSide * step(vP.y, 1.0);   // ورا الباب الورّاني
  gaps += (1.0 - smoothstep(0.003, 0.006, abs(vP.y - 0.255))) * side * step(-0.97, vP.z) * step(vP.z, 1.13); // تحت الأبواب
  gaps += lineZ(vP.z, -1.03, 0.006) * top;                                                    // ورا الكبوت
  gaps += (1.0 - smoothstep(0.003, 0.006, abs(ax - 0.68))) * top * step(vP.z, -1.03);         // جوانب الكبوت
  gaps += lineZ(vP.z, 1.66, 0.006) * top;                                                     // الشنطة
  diffuseColor.rgb *= 1.0 - clamp(gaps, 0.0, 1.0) * 0.85;
  // ===== الصالون: الأعمدة والحواف حوالين الشبابيك سودا =====
  float upperSide = side * step(${(0.035).toFixed(3)}, vP.y - (0.95 + 0.04 * clamp((vP.z + 0.4) / 2.0, 0.0, 1.0)));
  float bPillar = step(0.09, vP.z) * step(vP.z, 0.225) * upperSide * step(vP.y, 1.42);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03), bPillar);
  // ===== قدام: الكشافات، الشبكة، الفتحة اللي تحت، الفوانيس الضباب =====
  float zf = vP.z - (${SEDAN.zFront.toFixed(3)});
  // كشاف مسحوب على الركن: من جنب الشبكة لحد الرفرف
  float headSweep = 0.11 + (ax - 0.36) * 0.55;
  float head = step(0.36, ax) * step(ax, 0.86) * step(0.655, vP.y) * step(vP.y, 0.80 - (ax - 0.36) * 0.08) * step(zf, headSweep);
  if (head > 0.5) {
    float amber = step(0.72, ax);
    float inner = (1.0 - smoothstep(0.0, 0.02, abs(ax - 0.52) - 0.06)) * step(0.69, vP.y) * step(vP.y, 0.76);
    vec3 lens = mix(vec3(0.82, 0.84, 0.86), vec3(0.95, 0.62, 0.15), amber);
    lens = mix(lens, vec3(0.98), inner * 0.6);
    diffuseColor.rgb = lens; rough = 0.08;
    emis += (1.0 - amber) * (0.25 + 0.75 * inner) * uHead * vec3(1.0, 0.95, 0.85) * 3.5;
  }
  float grille = front * step(ax, 0.34) * step(0.6, vP.y) * step(vP.y, 0.78) * step(zf, 0.12);
  if (grille > 0.5) {
    float frame = step(0.3, ax) + step(0.765, vP.y) + step(vP.y, 0.615);
    float bar = 1.0 - step(0.01, abs(vP.y - 0.735));
    float mesh = step(0.5, fract(vP.x * 60.0)) * step(0.5, fract(vP.y * 60.0));
    vec3 cg = mix(vec3(0.04), vec3(0.09), mesh);
    cg = mix(cg, vec3(0.86, 0.87, 0.9), clamp(frame + bar, 0.0, 1.0));
    diffuseColor.rgb = cg; rough = 0.25;
  }
  float intake = front * step(ax, 0.5) * step(0.3, vP.y) * step(vP.y, 0.47) * step(zf, 0.08);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.035), intake);
  float fog = (1.0 - smoothstep(0.045, 0.05, length(vec2(ax - 0.62, vP.y - 0.43)))) * step(zf, 0.16);
  if (fog > 0.5) { diffuseColor.rgb = vec3(0.85); rough = 0.1; emis += uHead * 0.6 * vec3(1.0, 0.95, 0.8); }
  // ===== ورا: الفوانيس (أحمر + أبيض للريوس) =====
  float zr = ${SEDAN.zRear.toFixed(3)} - vP.z;
  float tail = step(0.43, ax) * step(ax, 0.86) * step(0.78, vP.y) * step(vP.y, 0.955) * step(zr, 0.06 + (ax - 0.43) * 0.42);
  if (tail > 0.5) {
    float rev = step(ax, 0.53) * step(vP.y, 0.86);
    diffuseColor.rgb = mix(vec3(0.62, 0.03, 0.03), vec3(0.9), rev); rough = 0.12;
    emis += (1.0 - rev) * vec3(1.0, 0.05, 0.02) * (uTail + uBrake * 2.8);
    emis += rev * vec3(1.0) * uRev * 2.0;
  }
  // تحت الإكصدام الورّاني غامق شوية
  float rearLow = rear * step(vP.y, 0.42);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05), rearLow);
}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = rough;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += emis;');
  };
  mat.customProgramCacheKey = () => 'sedan-paint-1';
  if (!unique) _matCache.set(key, mat);
  return mat;
}

let _glassOpaque = null, _glassClear = null;
export function sedanGlass(seeThrough = false) {
  if (seeThrough) return (_glassClear ||= new THREE.MeshPhysicalMaterial({ color: 0x1e2a30, transparent: true, opacity: 0.42, roughness: 0.03, metalness: 0, envMapIntensity: 1.6, depthWrite: false, side: THREE.FrontSide }));
  return (_glassOpaque ||= new THREE.MeshStandardMaterial({ color: 0x141b20, roughness: 0.08, metalness: 0.6, envMapIntensity: 1.4 }));
}

// ===== القطع الصغيرة (مرايات، أوكر، شيال السقف، اللوحات...) — geometry واحدة مدموجة لكل نوع =====
const _partsCache = {};
function partsGeometry(kind) {
  if (_partsCache[kind]) return _partsCache[kind];
  const chrome = [], dark = [], body = [];
  const add = (list, geo, x, y, z, rx = 0, ry = 0, rz = 0) => { geo.rotateX(rx); geo.rotateY(ry); geo.rotateZ(rz); geo.translate(x, y, z); list.push(geo); };
  for (const sx of [-1, 1]) {
    // مراية جنب (فضي زي الصورة) على الباب القدام
    add(dark, new THREE.CapsuleGeometry(0.055, 0.09, 4, 10).scale(1.45, 0.95, 0.75), sx * 0.97, 1.0, -0.8, 0, 0, Math.PI / 2);
    add(dark, new THREE.BoxGeometry(0.24, 0.05, 0.1), sx * 0.82, 0.97, -0.79); // دراع المراية لحد الصاج (كان فيه فراغ بين المراية والعربية)
    // أكر الأبواب
    for (const z of [-0.32, 0.72]) add(chrome, new THREE.BoxGeometry(0.02, 0.028, 0.15), sx * 0.858, 0.9, z);
    // مساحات الزجاج (سودا عند قاعدة الزجاج)
    add(dark, new THREE.BoxGeometry(0.5, 0.015, 0.025), sx * 0.27, 0.975, -0.99, 0, sx * 0.12, 0);
  }
  if (kind === 'taxi') {
    // شيال السقف (فضي): قضيبين على الطول + 4 رجول + عارضة قدام
    for (const sx of [-1, 1]) {
      add(chrome, new THREE.CylinderGeometry(0.014, 0.014, 1.12, 8), sx * 0.5, 1.545, 0.32, Math.PI / 2, 0, 0);
      for (const z of [-0.18, 0.82]) add(dark, new THREE.BoxGeometry(0.05, 0.06, 0.07), sx * 0.5, 1.505, z);
    }
    add(chrome, new THREE.CylinderGeometry(0.012, 0.012, 1.0, 8), 0, 1.55, -0.12, 0, 0, Math.PI / 2);
  }
  const merge = (list) => {
    if (!list.length) return null;
    const g = new THREE.BufferGeometry();
    let n = 0; for (const x of list) n += x.attributes.position.count;
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3), idx = [];
    let o = 0;
    for (const x of list) {
      const nonIdx = x.index ? x.toNonIndexed() : x;
      // (بنحوّلها لغير مفهرسة عشان الدمج يبقى سهل)
      P.set(nonIdx.attributes.position.array, o * 3); N.set(nonIdx.attributes.normal.array, o * 3);
      o += nonIdx.attributes.position.count;
    }
    g.setAttribute('position', new THREE.BufferAttribute(P.subarray(0, o * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(N.subarray(0, o * 3), 3));
    void idx;
    return g;
  };
  // (الأحجام اتحسبت بعد toNonIndexed، فبنعيد الحساب بدقة)
  const fix = (list) => list.map((g) => (g.index ? g.toNonIndexed() : g));
  _partsCache[kind] = { chrome: merge(fix(chrome)), dark: merge(fix(dark)) };
  return _partsCache[kind];
}

const _sharedMats = {};
function partMats() {
  return (_sharedMats.parts ||= {
    chrome: new THREE.MeshStandardMaterial({ color: 0xc9cdd2, roughness: 0.22, metalness: 0.9 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.6 }),
    plate: new THREE.MeshStandardMaterial({ map: plateTexture(), roughness: 0.5 }),
    badge: new THREE.MeshStandardMaterial({ map: bydTexture(), roughness: 0.3, metalness: 0.5, transparent: true }),
    liner: new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.95, side: THREE.DoubleSide }),
    lightbarRed: new THREE.MeshStandardMaterial({ color: 0x8a0d10, emissive: 0xff1010, emissiveIntensity: 0.4, roughness: 0.3 }),
    lightbarBlue: new THREE.MeshStandardMaterial({ color: 0x0d1a8a, emissive: 0x1030ff, emissiveIntensity: 0.4, roughness: 0.3 }),
  });
}

let _linerGeo = null, _plateGeo = null, _badgeGeo = null, _linersMerged = null;
const _lodWheel = {};

/**
 * سيدان كاملة. opts:
 *  livery: 'taxi' | 'police' | لون (رقم)
 *  lod: 0 (عربية اللاعب/قريب) أو 1 (مرور)
 *  seeThrough: زجاج شفاف (عربية اللاعب) ولا معتم (مرور، أخف)
 *  wheels: true = عجل بيلف (بيرجع في wheels)
 * المرجع: z قدام سالب، الأرض y=0، نص العربية بين العجلتين
 */
export function buildSedan({ livery = 'taxi', lod = 0, seeThrough = false, wheels = true, uniqueMat = false } = {}) {
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  const paint = sedanPaintMaterial(livery, { unique: uniqueMat });
  const shell = new THREE.Mesh(sedanBodyGeometry(lod), [paint, sedanGlass(seeThrough)]);
  shell.castShadow = true; shell.receiveShadow = true;
  shell.userData.role = 'paint';
  body.add(shell);
  const M = partMats();
  const kind = livery === 'taxi' ? 'taxi' : 'plain';
  const parts = partsGeometry(kind);
  if (parts.chrome) { const m = new THREE.Mesh(parts.chrome, M.chrome); m.castShadow = true; m.userData.role = 'chrome'; body.add(m); }
  if (parts.dark) { const m = new THREE.Mesh(parts.dark, M.dark); m.userData.role = 'chrome'; body.add(m); }
  // بطانة أقواس العجل (سودا) عشان مايبانش فراغ جوه الرفرف
  _linerGeo ||= new THREE.CylinderGeometry(ARCH_R, ARCH_R, 0.3, 18, 1, true, -Math.PI / 2 - 1.2, 2.4 + Math.PI).rotateZ(Math.PI / 2);
  if (lod >= 1) {
    // المرور: الأربع بطانات Mesh واحدة (draw call واحد، وبتستخبى في البعيد)
    _linersMerged ||= mergeGeometries([SEDAN.axleF, SEDAN.axleF, SEDAN.axleR, SEDAN.axleR].map((za, i) => _linerGeo.clone().translate((i % 2 ? 1 : -1) * (SEDAN.halfWidth - 0.17), SEDAN.wheelR, za)));
    const l = new THREE.Mesh(_linersMerged, M.liner); l.userData.role = 'chrome'; body.add(l);
  } else for (const za of [SEDAN.axleF, SEDAN.axleR]) for (const sx of [-1, 1]) {
    const l = new THREE.Mesh(_linerGeo, M.liner); l.position.set(sx * (SEDAN.halfWidth - 0.17), SEDAN.wheelR, za); body.add(l);
  }
  // اللوحات + شعار BYD
  _plateGeo ||= new THREE.PlaneGeometry(0.34, 0.17);
  const pf = new THREE.Mesh(_plateGeo, M.plate); pf.position.set(0, 0.52, SEDAN.zFront - 0.012); pf.rotation.y = Math.PI; pf.userData.role = 'plate'; body.add(pf);
  const pr = new THREE.Mesh(_plateGeo, M.plate); pr.position.set(0, 0.62, SEDAN.zRear + 0.012); pr.userData.role = 'plate'; body.add(pr);
  _badgeGeo ||= new THREE.PlaneGeometry(0.15, 0.075);
  const bd = new THREE.Mesh(_badgeGeo, M.badge); bd.position.set(0, 0.70, SEDAN.zFront + 0.035); bd.rotation.y = Math.PI; bd.userData.role = 'plate'; body.add(bd);
  // الشرطة: كشاف سقف أحمر/أزرق
  let lightbar = null;
  if (livery === 'police') {
    lightbar = new THREE.Group(); lightbar.position.set(0, 1.52, 0.3);
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.05, 0.22), M.dark); lightbar.add(base);
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.08, 0.2), M.lightbarRed); red.position.set(-0.25, 0.06, 0); lightbar.add(red);
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.08, 0.2), M.lightbarBlue); blue.position.set(0.25, 0.06, 0); lightbar.add(blue);
    body.add(lightbar);
  }
  // العجل (جنط فضي متعدد الأذرع زي الصورة)
  const wheelList = [];
  if (wheels) {
    const wm = (_sharedMats.wheel ||= vehicleMaterials(0xffffff));
    const ids = ['FL', 'FR', 'RL', 'RR'];
    [[SEDAN.axleF, -1], [SEDAN.axleF, 1], [SEDAN.axleR, -1], [SEDAN.axleR, 1]].forEach(([za, sx], i) => {
      const w = buildWheel({ radius: SEDAN.wheelR, width: 0.2, rimRadius: 0.2, mats: wm, style: 'alloy6', side: sx });
      if (lod >= 1) {
        // المرور: الكاوتش والجنط Mesh واحدة بألوان (draw call واحد للعجلة بدل 3)
        const key = sx > 0 ? 'R' : 'L';
        if (!_lodWheel[key]) {
          const geos = w.spin.children.map((m) => {
            m.updateMatrix();
            const gg = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(m.matrix);
            const col = m.userData.role === 'tire' ? [0.03, 0.03, 0.032] : m.userData.role === 'rim' ? [0.5, 0.52, 0.55] : [0.38, 0.4, 0.43];
            const arr = new Float32Array(gg.attributes.position.count * 3);
            for (let k = 0; k < arr.length; k += 3) arr.set(col, k);
            gg.setAttribute('color', new THREE.BufferAttribute(arr, 3));
            for (const a of Object.keys(gg.attributes)) if (!['position', 'normal', 'color'].includes(a)) gg.deleteAttribute(a);
            return gg;
          });
          _lodWheel[key] = mergeGeometries(geos);
        }
        for (const c of [...w.spin.children]) w.spin.remove(c);
        const wmesh = new THREE.Mesh(_lodWheel[key], (_lodWheel.mat ||= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.3 })));
        wmesh.castShadow = true; wmesh.userData.role = 'tire';
        w.spin.add(wmesh);
      }
      w.group.position.set(sx * SEDAN.track / 2, SEDAN.wheelR, za);
      root.add(w.group);
      wheelList.push({ id: ids[i], front: i < 2, group: w.group, spin: w.spin });
    });
  }
  const sh = contactShadow(1.95, 4.75);
  sh.position.z = (SEDAN.zFront + SEDAN.zRear) / 2;
  root.add(sh);
  return {
    root, body, shell, wheels: wheelList, paint, lightbar,
    length: SEDAN.zRear - SEDAN.zFront, width: SEDAN.halfWidth * 2,
    // أماكن الكشافات والفوانيس الحقيقية (للنور وللأنوار)
    lamps: {
      head: [[-0.6, 0.73, SEDAN.zFront + 0.12], [0.6, 0.73, SEDAN.zFront + 0.12]],
      tail: [[-0.66, 0.88, SEDAN.zRear - 0.08], [0.66, 0.88, SEDAN.zRear - 0.08]],
    },
    U: paint.userData.U,
  };
}
