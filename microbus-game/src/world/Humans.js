// =====================================================================
//  الناس (شبه حقيقيين مش كرتون): نسب جسم حقيقية (7.5 راس)، وش مرسوم (عيون/حواجب/مناخير/بق/شنب)،
//  شعر أو طاقية أو حجاب، لبس (قميص/بنطلون، جلابية، عباية/جيبة)، إيدين وجزم.
//  كل شكل = geometry واحدة فيها رقم "عضمة" لكل نقطة (aBone)، والمشي بيتحسب في الـ vertex shader
//  (فخد + ركبة + كتف + كوع) من قيم لكل شخص (aAnim: phase, سرعة, رفع الإيد اليمين/الشمال).
//  → كل الناس من نفس الشكل في draw call واحد (InstancedMesh)، ومفيش حسابات أطراف على الـ CPU.
//  وكمان نسخة قاعدة (للسواقين والركاب جوه العربيات) بتتبني بالوضع ده مرة واحدة.
// =====================================================================
import * as THREE from 'three';
import { canvas, tex, rng } from '../render/textures.js';

// المفاصل (المرجع: الرجلين على الأرض y=0، الوش ناحية +z)
export const J = { hipX: 0.095, hipY: 0.92, kneeY: 0.5, shX: 0.195, shY: 1.42, elY: 1.13 };
// الألوان مكتوبة sRGB (زي ما بنشوفها) وبتتحول linear تحت (عشان البشرة واللبس مايطلعوش باهتين)
const SKIN = [[0.86, 0.68, 0.54], [0.76, 0.57, 0.43], [0.66, 0.48, 0.36], [0.56, 0.4, 0.3], [0.47, 0.33, 0.25]];
const HAIR = [[0.05, 0.04, 0.035], [0.12, 0.08, 0.05], [0.2, 0.14, 0.09], [0.55, 0.55, 0.55]];
const SHIRT = [[0.9, 0.9, 0.88], [0.22, 0.36, 0.6], [0.62, 0.18, 0.16], [0.3, 0.46, 0.32], [0.88, 0.76, 0.5], [0.15, 0.15, 0.17], [0.55, 0.62, 0.72]];
const PANTS = [[0.14, 0.17, 0.26], [0.3, 0.3, 0.31], [0.36, 0.29, 0.21], [0.1, 0.1, 0.11], [0.45, 0.42, 0.36]];
const ROBE = [[0.88, 0.88, 0.85], [0.45, 0.42, 0.38], [0.3, 0.31, 0.34], [0.24, 0.3, 0.44], [0.52, 0.42, 0.32], [0.6, 0.55, 0.45]];
const ABAYA = [[0.08, 0.08, 0.1], [0.16, 0.12, 0.18], [0.2, 0.26, 0.34], [0.32, 0.22, 0.24], [0.38, 0.32, 0.28]];
const HIJAB = [[0.88, 0.86, 0.82], [0.55, 0.16, 0.22], [0.22, 0.36, 0.56], [0.75, 0.6, 0.45], [0.12, 0.12, 0.13], [0.48, 0.55, 0.42], [0.85, 0.6, 0.62]];
const SHOE = [[0.08, 0.07, 0.06], [0.28, 0.18, 0.1], [0.85, 0.85, 0.85], [0.15, 0.15, 0.16]];
for (const pal of [SKIN, HAIR, SHIRT, PANTS, ROBE, ABAYA, HIJAB, SHOE]) for (const c of pal) for (let i = 0; i < 3; i++) c[i] = Math.pow(c[i], 2.2);

// ===== أطلس الوشوش: 8 وشوش (ابيض + ملامح غامقة) بيتضربوا في لون البشرة =====
const FA = { cols: 4, rows: 2, w: 96, h: 120 };
let _atlas = null;
function faceAtlas() {
  if (_atlas) return _atlas;
  const W = FA.cols * FA.w, H = FA.rows * FA.h + 16;
  const c = canvas(W, H), x = c.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, W, H);
  const R = rng(4711);
  for (let i = 0; i < FA.cols * FA.rows; i++) {
    const ox = (i % FA.cols) * FA.w, oy = Math.floor(i / FA.cols) * FA.h, cx = ox + FA.w / 2;
    const fem = i >= 6, mustache = !fem && i % 2 === 0, beard = !fem && i === 3, old = i === 5;
    // ضل خفيف على الجناب والدقن (حجم)
    const g = x.createRadialGradient(cx, oy + 58, 10, cx, oy + 58, 54);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(60,30,20,0.16)');
    x.fillStyle = g; x.fillRect(ox, oy, FA.w, FA.h);
    const eyeY = oy + 50, sp = 15;
    // الحواجب
    x.strokeStyle = fem ? 'rgba(40,25,20,0.75)' : old ? 'rgba(120,120,120,0.9)' : 'rgba(25,15,10,0.9)';
    x.lineWidth = fem ? 2.2 : 3.4; x.lineCap = 'round';
    for (const s of [-1, 1]) { x.beginPath(); x.moveTo(cx + s * (sp - 7), eyeY - 9); x.quadraticCurveTo(cx + s * sp, eyeY - 13 - R() * 2, cx + s * (sp + 8), eyeY - 9); x.stroke(); }
    // العيون (بياض + نِني + جفن)
    for (const s of [-1, 1]) {
      const ex = cx + s * sp;
      x.fillStyle = 'rgba(80,45,35,0.25)'; x.beginPath(); x.ellipse(ex, eyeY - 1, 9, 5.5, 0, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#f4efe8'; x.beginPath(); x.ellipse(ex, eyeY, 6.5, 3.4, 0, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#2a1a10'; x.beginPath(); x.arc(ex + (R() - 0.5), eyeY + 0.2, 2.8, 0, Math.PI * 2); x.fill();
      x.strokeStyle = 'rgba(30,15,10,0.85)'; x.lineWidth = fem ? 1.8 : 1.3; x.beginPath(); x.ellipse(ex, eyeY, 6.8, 3.6, 0, Math.PI * 1.05, Math.PI * 1.95); x.stroke();
    }
    // المناخير: ضل على الجنب + فتحات
    x.strokeStyle = 'rgba(70,35,25,0.35)'; x.lineWidth = 2;
    x.beginPath(); x.moveTo(cx - 3, eyeY + 4); x.quadraticCurveTo(cx - 6, eyeY + 18, cx - 4, eyeY + 22); x.stroke();
    x.fillStyle = 'rgba(60,30,20,0.4)'; for (const s of [-1, 1]) { x.beginPath(); x.ellipse(cx + s * 3.6, eyeY + 23, 2.2, 1.3, 0, 0, Math.PI * 2); x.fill(); }
    // البق
    const my = eyeY + 36;
    x.fillStyle = fem ? 'rgba(150,60,60,0.55)' : 'rgba(110,55,45,0.5)';
    x.beginPath(); x.moveTo(cx - 10, my); x.quadraticCurveTo(cx, my - 3, cx + 10, my); x.quadraticCurveTo(cx, my + 5, cx - 10, my); x.fill();
    x.strokeStyle = 'rgba(60,25,20,0.6)'; x.lineWidth = 1.2; x.beginPath(); x.moveTo(cx - 10, my); x.quadraticCurveTo(cx, my + 1, cx + 10, my); x.stroke();
    // شنب / دقن
    if (mustache) { x.fillStyle = old ? 'rgba(130,130,130,0.9)' : 'rgba(25,15,10,0.85)'; x.beginPath(); x.moveTo(cx - 12, my - 2); x.quadraticCurveTo(cx, my - 10, cx + 12, my - 2); x.quadraticCurveTo(cx, my - 5, cx - 12, my - 2); x.fill(); }
    if (beard) { x.fillStyle = 'rgba(25,15,10,0.45)'; x.beginPath(); x.ellipse(cx, my + 10, 22, 14, 0, 0, Math.PI); x.fill(); }
    if (old) { x.strokeStyle = 'rgba(80,45,35,0.25)'; x.lineWidth = 1; for (const s of [-1, 1]) { x.beginPath(); x.moveTo(cx + s * 9, my - 6); x.lineTo(cx + s * 13, my + 4); x.stroke(); } }
  }
  _atlas = tex(c, { repeat: false });
  _atlas.anisotropy = 4;
  return _atlas;
}
// الـ UV للنقط اللي مش وش: بيكسل أبيض تحت الأطلس
const WHITE_UV = [0.5, 8 / (FA.rows * FA.h + 16)];

// ===== أدوات بناء =====
class Parts {
  constructor() { this.pos = []; this.nrm = []; this.col = []; this.uv = []; this.bone = []; }
  /** geometry جاهزة + تحويل + لون + عضمة (+ دالة UV اختيارية للوش) */
  add(geo, m, color, bone, uvFn = null, shade = null) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const p = g.attributes.position, n = g.attributes.normal;
    const nm = new THREE.Matrix3().getNormalMatrix(m), v = new THREE.Vector3(), w = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const local = v.clone();
      v.applyMatrix4(m);
      w.fromBufferAttribute(n, i).applyMatrix3(nm).normalize();
      this.pos.push(v.x, v.y, v.z); this.nrm.push(w.x, w.y, w.z);
      const k = shade ? shade(local, v) : 1;
      this.col.push(color[0] * k, color[1] * k, color[2] * k);
      const uv = uvFn ? uvFn(local, v) : WHITE_UV;
      this.uv.push(uv[0], uv[1]);
      this.bone.push(bone);
    }
    if (g !== geo) g.dispose();
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aBone', new THREE.Float32BufferAttribute(this.bone, 1));
    g.computeBoundingSphere();
    return g;
  }
}
const T = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
/** جذع/جيبة بشكل حقيقي: lathe من بروفايل [r, y] */
const lathe = (prof, seg) => new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), seg);
/** طرف (cylinder) بين نقطتين على محور y */
const limb = (rTop, rBottom, len, seg) => new THREE.CylinderGeometry(rTop, rBottom, len, seg, 1, true);

/**
 * بيبني شكل شخص (geometry واحدة). opts: { type: 'casual'|'galabeya'|'woman'|'abaya'|'kid', low }
 * بيرجع { geo, type, height }
 */
export function buildHuman(R, opts = {}) {
  const low = !!opts.low, S = (n) => (low ? Math.max(5, Math.round(n * 0.6)) : n);
  const roll = R();
  const type = opts.type || (roll < 0.3 ? 'galabeya' : roll < 0.48 ? 'woman' : roll < 0.6 ? 'abaya' : 'casual');
  const pick = (a) => a[Math.floor(R() * a.length)];
  const fem = type === 'woman' || type === 'abaya';
  const skin = pick(SKIN), hair = R() < 0.18 && !fem ? HAIR[3] : pick(HAIR.slice(0, 3));
  const P = new Parts();
  const top = type === 'galabeya' ? pick(ROBE) : type === 'abaya' ? pick(ABAYA) : pick(SHIRT);
  const bottom = type === 'casual' ? pick(PANTS) : type === 'woman' ? pick([...ABAYA, ...PANTS]) : top;
  const shoe = pick(SHOE);
  const longSleeve = type !== 'casual' || R() < 0.5;
  // تدرج خفيف (أغمق تحت) عشان الحجم
  const shadeY = (y0, y1, a = 0.82) => (l, v) => a + (1 - a) * Math.min(1, Math.max(0, (v.y - y0) / (y1 - y0)));

  // ===== الرجلين (عضمة 1،2 شمال — 3،4 يمين) =====
  for (const [s, bt, bs] of [[-1, 1, 2], [1, 3, 4]]) {
    const hx = s * J.hipX;
    P.add(limb(0.084, 0.066, J.hipY - J.kneeY, S(10)), T(hx, (J.hipY + J.kneeY) / 2, 0), bottom, bt, null, shadeY(J.kneeY, J.hipY, 0.9));
    P.add(new THREE.SphereGeometry(0.066, S(8), S(6)), T(hx, J.kneeY, 0.005), bottom, bs);
    P.add(limb(0.062, 0.046, J.kneeY - 0.09, S(10)), T(hx, (J.kneeY + 0.09) / 2, 0), type === 'casual' ? bottom : skin, bs, null, shadeY(0.09, J.kneeY, 0.85));
    // الجزمة: مستطيل مدوّر (بوز لقدام)
    P.add(new THREE.SphereGeometry(0.06, S(10), S(6)), T(hx, 0.045, 0.06, 0, 0, 0, 0.85, 0.75, 2.0), shoe, bs);
  }
  // ===== الجذع (عضمة 0) =====
  const hipR = fem ? 0.175 : 0.16, waistR = fem ? 0.13 : 0.145, chestR = fem ? 0.16 : 0.18;
  const torsoProf = [[0.001, 0.86], [hipR * 0.85, 0.87], [hipR, 0.95], [hipR * 0.97, 1.0], [waistR, 1.08], [chestR * 0.92, 1.2], [chestR, 1.31], [chestR * 0.97, 1.38], [0.13, 1.44], [0.06, 1.47], [0.001, 1.48]];
  P.add(lathe(torsoProf, S(14)), T(0, 0, 0.0, 0, 0, 0, 1, 1, 0.64), top, 0, null, shadeY(0.86, 1.4, 0.85));
  // الكتفين
  for (const s of [-1, 1]) P.add(new THREE.SphereGeometry(0.06, S(8), S(6)), T(s * (J.shX - 0.012), J.shY - 0.012, 0, 0, 0, 0, 1, 0.9, 0.85), top, 0);
  // الجلابية/العباية: جيبة طويلة لحد الكعب (بتتمرجح شوية مع المشي: عضمة 9)
  if (type === 'galabeya' || type === 'abaya' || (type === 'woman' && R() < 0.6)) {
    const hem = type === 'woman' ? 0.22 : 0.1, wide = type === 'galabeya' ? 0.26 : 0.24;
    P.add(lathe([[wide, hem], [wide * 0.92, 0.5], [0.17, 0.9], [0.15, 1.02]], S(16)), T(0, 0, 0, 0, 0, 0, 1, 1, 0.78), type === 'woman' ? bottom : top, 9, null, shadeY(hem, 1.0, 0.78));
  }
  // ===== الرقبة والراس =====
  P.add(limb(0.052, 0.046, 0.1, S(10)), T(0, 1.5, 0.005), skin, 0);
  const headY = 1.64;
  const fi = fem ? 6 + Math.floor(R() * 2) : Math.floor(R() * 6);
  const fu = (fi % FA.cols) / FA.cols;
  const atlasH = FA.rows * FA.h + 16;
  // UV الوش: إسقاط على النص اللي قدام من الراس
  const faceUV = (l) => {
    if (l.z < 0.0) return WHITE_UV;
    const u = 0.5 + Math.atan2(l.x, l.z) / 2.4, v = (l.y + 1) / 2;
    if (u < 0.02 || u > 0.98) return WHITE_UV;
    return [fu + u / FA.cols, 1 - ((Math.floor(fi / FA.cols) * FA.h + (1 - v) * FA.h) / atlasH)];
  };
  P.add(new THREE.SphereGeometry(1, S(16), S(12)), T(0, headY, 0.01, 0, 0, 0, 0.088, 0.118, 0.103), skin, 0, faceUV);
  // ودان
  for (const s of [-1, 1]) P.add(new THREE.SphereGeometry(0.022, S(6), S(5)), T(s * 0.086, headY, -0.005, 0, 0, 0, 0.5, 1, 0.8), skin, 0);
  // الشعر / الطاقية / الحجاب
  if (fem) {
    const hj = pick(HIJAB);
    // الحجاب بيلف الراس (فتحة للوش) + بينزل على الكتفين
    P.add(new THREE.SphereGeometry(1, S(16), S(12), 0, Math.PI * 2, 0, Math.PI * 0.62), T(0, headY + 0.005, -0.008, -0.42, 0, 0, 0.1, 0.13, 0.115), hj, 0);
    P.add(new THREE.SphereGeometry(1, S(16), S(10), Math.PI * 0.32, Math.PI * 1.36, 0, Math.PI), T(0, headY - 0.01, -0.01, 0, Math.PI, 0, 0.103, 0.128, 0.108), hj, 0);
    P.add(lathe([[0.155, 1.385], [0.15, 1.42], [0.1, 1.5], [0.066, 1.56]], S(14)), T(0, 0, -0.005, 0, 0, 0, 1, 1, 0.78), hj, 0);
  } else if (type === 'galabeya' && R() < 0.5) {
    P.add(new THREE.CylinderGeometry(0.094, 0.098, 0.07, S(14)), T(0, headY + 0.085, -0.005), R() < 0.6 ? [0.86, 0.86, 0.8] : [0.27, 0.02, 0.02], 0); // طاقية (بيضا أو حمرا)
  } else {
    P.add(new THREE.SphereGeometry(1, S(14), S(8), 0, Math.PI * 2, 0, Math.PI * 0.55), T(0, headY + 0.012, -0.012, -0.25, 0, 0, 0.094, 0.118, 0.108), hair, 0);
  }
  // ===== الدراعات (5،6 شمال — 7،8 يمين) =====
  for (const [s, bu, bf] of [[-1, 5, 6], [1, 7, 8]]) {
    const ax = s * J.shX;
    P.add(limb(0.056, 0.047, J.shY - J.elY, S(9)), T(ax, (J.shY + J.elY) / 2, 0), longSleeve ? top : top, bu);
    P.add(new THREE.SphereGeometry(0.047, S(7), S(5)), T(ax, J.elY, 0), longSleeve ? top : skin, bf);
    P.add(limb(0.045, 0.035, 0.25, S(9)), T(ax, J.elY - 0.125, 0), longSleeve ? top : skin, bf);
    // الإيد: كف مقفول شوية
    P.add(new THREE.SphereGeometry(1, S(8), S(6)), T(ax, J.elY - 0.31, 0.01, 0, 0, 0, 0.036, 0.075, 0.03), skin, bf);
  }
  return { geo: P.build(), type, height: 1.75 };
}

// ===== الشيدر: حركة المشي من aAnim (phase, amp, armR, armL) =====
const ANIM_HEAD = `
attribute float aBone;
attribute vec4 aAnim;
vec3 rx3(vec3 p, vec3 c, float a) { p -= c; float cs = cos(a), sn = sin(a); return vec3(p.x, cs * p.y - sn * p.z, sn * p.y + cs * p.z) + c; }
vec3 rz3(vec3 p, vec3 c, float a) { p -= c; float cs = cos(a), sn = sin(a); return vec3(cs * p.x - sn * p.y, sn * p.x + cs * p.y, p.z) + c; }
vec3 rxN(vec3 n, float a) { float cs = cos(a), sn = sin(a); return vec3(n.x, cs * n.y - sn * n.z, sn * n.y + cs * n.z); }
vec3 rzN(vec3 n, float a) { float cs = cos(a), sn = sin(a); return vec3(cs * n.x - sn * n.y, sn * n.x + cs * n.y, n.z); }
`;
const ANIM_BODY = `
  vec3 animP = position;
  {
    float ph = aAnim.x, amp = aAnim.y, b = aBone;
    float sw = sin(ph) * 0.42 * amp;
    vec3 P = position, N = objectNormal;
    // الرجلين: الفخد بيتمرجح والركبة بتتني وهي طالعة لقدام
    if (b > 0.5 && b < 4.5) {
      float side = b < 2.5 ? -1.0 : 1.0;
      float th = side < 0.0 ? sw : -sw;
      // الركبة بتتني وهي الرجل رايحة لقدام (swing)، مش وهي على الأرض راجعة لورا (stance) —
      // كانت بالعكس بالظبط (فرق π) فالناس كانوا شكلهم ماشيين بضهرهم
      float kn = (max(0.0, sin(ph + (side < 0.0 ? 1.84 : -1.3))) * 0.95 + 0.06) * amp;
      vec3 hip = vec3(side * ${J.hipX.toFixed(3)}, ${J.hipY.toFixed(3)}, 0.0), knee = vec3(side * ${J.hipX.toFixed(3)}, ${J.kneeY.toFixed(3)}, 0.0);
      if (abs(b - 2.0) < 0.5 || abs(b - 4.0) < 0.5) { P = rx3(P, knee, kn); N = rxN(N, kn); }
      P = rx3(P, hip, -th); N = rxN(N, -th);
    }
    // الجلابية: بتتمرجح شوية
    if (abs(b - 9.0) < 0.5) { float k = clamp((${J.hipY.toFixed(3)} - P.y) / 0.8, 0.0, 1.0); P.z += sin(ph * 2.0) * 0.03 * amp * k; }
    // الدراعات: عكس الرجلين + الكوع متني شوية + رفع الإيد (شاور/سلام)
    if (b > 4.5 && b < 8.5) {
      float side = b < 6.5 ? -1.0 : 1.0;
      float raise = side < 0.0 ? aAnim.w : aAnim.z;
      // عكس الرجل اللي في نفس الناحية + رفع لفوق وقدام (شاور/سلام)
      float A = (side < 0.0 ? sw : -sw) * 0.85 - raise * 2.55;
      float wav = raise > 0.6 ? sin(ph * 6.0) * 0.3 * raise : 0.0;
      float el = 0.18 + 0.3 * amp + raise * 0.4;
      vec3 shp = vec3(side * ${J.shX.toFixed(3)}, ${J.shY.toFixed(3)}, 0.0), elp = vec3(side * ${J.shX.toFixed(3)}, ${J.elY.toFixed(3)}, 0.0);
      if (abs(b - 6.0) < 0.5 || abs(b - 8.0) < 0.5) { P = rx3(P, elp, -el); N = rxN(N, -el); }
      float ab = side * (0.07 + raise * 0.25) + wav;
      P = rz3(P, shp, ab); N = rzN(N, ab);
      P = rx3(P, shp, A); N = rxN(N, A);
    }
    // الجسم بيطلع وينزل مع الخطوة
    P.y += abs(cos(ph)) * 0.025 * amp;
    animP = P; objectNormal = N;
  }
`;

let _animMat = null, _staticMat = null;
/** خامة الناس الماشيين (InstancedMesh + aAnim) */
export function humanAnimMaterial() {
  if (_animMat) return _animMat;
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, map: faceAtlas(), roughness: 0.82 });
  m.onBeforeCompile = (sh) => {
    // الحركة بتتحسب بعد objectNormal (قبل ما يتحول للإضاءة)، والمكان الجديد بيتحط في transformed
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + ANIM_HEAD)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n' + ANIM_BODY)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = animP;');
  };
  m.customProgramCacheKey = () => 'human-anim-1';
  _animMat = m;
  return m;
}
/** خامة الناس الثابتين/القاعدين (من غير حسابات حركة) */
export function humanStaticMaterial() {
  return (_staticMat ||= new THREE.MeshStandardMaterial({ vertexColors: true, map: faceAtlas(), roughness: 0.82 }));
}

/** وضع القعدة: بيلف الأطراف على الـ CPU مرة واحدة (فخد لقدام، ركبة لتحت، إيدين لقدام) */
export function seatedGeometry(geo, { hands = 'lap', knee = -1.55 } = {}) {
  const g = geo.clone();
  const p = g.attributes.position, n = g.attributes.normal, b = g.attributes.aBone;
  const v = new THREE.Vector3(), w = new THREE.Vector3();
  const rotX = (vec, c, a) => { vec.sub(c); const cs = Math.cos(a), sn = Math.sin(a); const y = cs * vec.y - sn * vec.z, z = sn * vec.y + cs * vec.z; vec.y = y; vec.z = z; return vec.add(c); };
  const rotXN = (vec, a) => { const cs = Math.cos(a), sn = Math.sin(a); const y = cs * vec.y - sn * vec.z, z = sn * vec.y + cs * vec.z; vec.y = y; vec.z = z; return vec; };
  for (let i = 0; i < p.count; i++) {
    const bone = b.getX(i);
    v.fromBufferAttribute(p, i); w.fromBufferAttribute(n, i);
    if (bone >= 1 && bone <= 4) {
      const side = bone <= 2 ? -1 : 1;
      const hip = new THREE.Vector3(side * J.hipX, J.hipY, 0), kneeP = new THREE.Vector3(side * J.hipX, J.kneeY, 0);
      if (bone === 2 || bone === 4) { rotX(v, kneeP, knee); rotXN(w, knee); }
      rotX(v, hip, 1.5); rotXN(w, 1.5);
    } else if (bone === 9) {
      // الجلابية وهو قاعد: النص اللي تحت بيتطبّق قدام على الرجلين
      if (v.y < J.hipY) { const t = (J.hipY - v.y); v.y = J.hipY - 0.05 - t * 0.08; v.z += t * 0.95; }
    } else if (bone >= 5 && bone <= 8) {
      const side = bone <= 6 ? -1 : 1;
      const sh = new THREE.Vector3(side * J.shX, J.shY, 0), el = new THREE.Vector3(side * J.shX, J.elY, 0);
      const elA = hands === 'wheel' ? 0.9 : 1.05, shA = hands === 'wheel' ? 0.75 : 0.32;
      if (bone === 6 || bone === 8) { rotX(v, el, elA); rotXN(w, elA); }
      rotX(v, sh, shA); rotXN(w, shA);
    }
    p.setXYZ(i, v.x, v.y, v.z); n.setXYZ(i, w.x, w.y, w.z);
  }
  // القعدة على y=0 (الكرسي): الحوض كان عند ~0.92 → ننزله
  g.translate(0, -J.hipY + 0.06, 0);
  g.computeBoundingSphere();
  return g;
}

/**
 * أشكال جاهزة (variants): نفس الـ geometry بتتعاد لكل الناس من نفس الشكل.
 * types: لو اتحدد بيتوزع على الأنواع بالترتيب
 */
const _variants = new Map();
export function humanVariants(n, seed = 2024, low = false) {
  const key = `${n}:${seed}:${low}`;
  if (_variants.has(key)) return _variants.get(key);
  const out = [], kinds = ['casual', 'galabeya', 'woman', 'casual', 'abaya', 'galabeya', 'woman', 'casual'];
  for (let i = 0; i < n; i++) {
    const R = rng((seed + i * 7919) >>> 0); for (let k = 0; k < 6; k++) R();
    const h = buildHuman(R, { type: kinds[i % kinds.length], low });
    h.scale = 0.93 + R() * 0.12;
    out.push(h);
  }
  _variants.set(key, out);
  return out;
}

/**
 * مجموعة ناس بتترسم بالـ instancing: كل variant = InstancedMesh واحدة.
 * set(i, variant, x,y,z, yaw, scale, phase, amp, armR, armL) وبعدين flush()
 */
export class HumanBatch {
  constructor(parent, variants, cap, { shadow = true } = {}) {
    this.vars = variants.map((v) => {
      const m = new THREE.InstancedMesh(v.geo, humanAnimMaterial(), cap);
      m.count = 0; m.frustumCulled = false; m.castShadow = shadow; m.receiveShadow = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const anim = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
      anim.setUsage(THREE.DynamicDrawUsage);
      m.geometry = v.geo.clone(); // كل batch ليه نسخة عشان الـ attribute بتاع الحركة
      m.geometry.setAttribute('aAnim', anim);
      parent.add(m);
      return { mesh: m, anim, n: 0, scale: v.scale };
    });
  }
  begin() { for (const v of this.vars) v.n = 0; }
  /** fall: 0 واقف → 1 نايم على ضهره (بيلف حوالين رجليه لورا) — للحوادث والنقالة */
  add(variant, x, y, z, yaw, scale, phase, amp, armR = 0, armL = 0, fall = 0) {
    const V = this.vars[variant % this.vars.length], i = V.n++;
    if (i >= V.mesh.instanceMatrix.count) { V.n--; return; }
    _q.setFromAxisAngle(_Y, yaw);
    if (fall) _q.multiply(_qx.setFromAxisAngle(_X, -fall * Math.PI / 2));
    _m.compose(_p.set(x, y, z), _q, _s.setScalar(scale * V.scale));
    V.mesh.setMatrixAt(i, _m);
    const a = V.anim.array; a[i * 4] = phase; a[i * 4 + 1] = amp; a[i * 4 + 2] = armR; a[i * 4 + 3] = armL;
  }
  flush() {
    for (const V of this.vars) {
      V.mesh.count = V.n; V.mesh.visible = V.n > 0;
      if (V.n) { V.mesh.instanceMatrix.needsUpdate = true; V.anim.needsUpdate = true; V.anim.addUpdateRange?.(0, V.n * 4); }
    }
  }
  setShadows(on) { for (const V of this.vars) V.mesh.castShadow = on; }
}
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _qx = new THREE.Quaternion(), _s = new THREE.Vector3(), _Y = new THREE.Vector3(0, 1, 0), _X = new THREE.Vector3(1, 0, 0);
