// =====================================================================
//  ملامح شبين الكوم (من بيانات OSM الحقيقية بس — مفيش مكان متألف):
//  - الاستاد: المدرجات والسور والأبراج حوالين أرضية الملعب الحقيقية (OSM leisure=pitch جوه leisure=stadium)
//  - الكورنيش على ترعة بحر شبين (OSM waterway=canal name=ترعة بحر شبين): سور، ممشى، دكك، شجر، أكشاك، ناس قاعدة
//  - شجر على أرصفة الشوارع الرئيسية
//  - يافطات المحلات/الكافيهات/المطاعم/المولات اللي ليها اسم في OSM (في مكانها)
//  كل الديكور المتكرر بـ NearInstancer: InstancedMesh واحدة لكل نوع، بتتملي بالقريب من الكاميرا بس
//  (draw call واحد للنوع كله، والمثلثات على قد اللي حواليك)
// =====================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { edgePoint, edgesNear } from './ShibinData.js';
import { canvas, tex } from '../../render/textures.js';
import { GeoBuilder } from '../../render/GeoBuilder.js';
import { humanVariants, seatedGeometry, humanStaticMaterial } from '../Humans.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _Y = new THREE.Vector3(0, 1, 0);
const CELL = 100;
let propMat = null;
export const propMaterial = () => (propMat ||= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }));

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

/** geometry بلون واحد (vertex colors) من geometry عادية */
const _lc = new THREE.Color();
/** الألوان مكتوبة sRGB (زي اللي في الصور) → linear (اللي الـ shader بيستناه) */
const lin = (c) => { _lc.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace); return [_lc.r, _lc.g, _lc.b]; };
function linearizeColors(geo) {
  const a = geo.attributes.color; if (!a) return geo;
  for (let i = 0; i < a.count; i++) { _lc.setRGB(a.getX(i), a.getY(i), a.getZ(i), THREE.SRGBColorSpace); a.setXYZ(i, _lc.r, _lc.g, _lc.b); }
  return geo;
}
function colored(g, c, m) {
  c = lin(c);
  g = g.index ? g.toNonIndexed() : g.clone();
  if (m) g.applyMatrix4(m);
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  const n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c[0]; a[i * 3 + 1] = c[1]; a[i * 3 + 2] = c[2]; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
const T = (x, y, z, ry = 0, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(_Y, ry), new THREE.Vector3(sx, sy, sz));

/**
 * ديكور متكرر: كل العناصر متخزنة (x,y,z,yaw,scale) في شبكة، وكل نص ثانية بنحط أقرب `max` جوه نطاق R في InstancedMesh واحدة.
 * check(item) → true/false/undefined (undefined = لسه المربع ماتحملش، نجرب تاني بعدين)
 */
export class NearInstancer {
  constructor(geo, mat, { R = 200, max = 400, name = 'props', check = null, castShadow = false, colors = false, attrs = null } = {}) {
    this.R = R; this.max = max; this.check = check;
    this.items = []; this.grid = new Map();
    // attrs: أسماء خصائص لكل نسخة (رقم واحد لكل عنصر، زي خانة الأطلس) → InstancedBufferAttribute
    this.attrs = attrs ? attrs.map((n) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(max), 1); a.setUsage(THREE.DynamicDrawUsage); return [n, a]; }) : null;
    if (this.attrs) { geo = geo.clone(); for (const [n, a] of this.attrs) geo.setAttribute(n, a); }
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    if (colors) this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3).fill(1), 3);
    this.mesh.name = name; this.mesh.count = 0; this.mesh.frustumCulled = false;
    this.mesh.castShadow = castShadow; this.mesh.receiveShadow = true;
    this._t = 0; this.visibleCount = 0;
  }
  /** بيشيل كل العناصر اللي ليها نفس الـ tag (مربع اتشال) */
  removeTag(tag) {
    for (const [k, a] of this.grid) { const b = a.filter((it) => it.tag !== tag); if (b.length !== a.length) { if (b.length) this.grid.set(k, b); else this.grid.delete(k); } }
    this.items = this.items.filter((it) => it.tag !== tag);
  }
  /** ext (اختياري): { sx, sz, color: [r,g,b] linear, a: [قيم attrs بالترتيب] } */
  add(x, y, z, yaw = 0, scale = 1, sy = scale, tag, ext) {
    const it = { x, y, z, yaw, scale, sy, ok: undefined, tag, ext };
    this.items.push(it);
    const k = Math.floor(x / CELL) * 100003 + Math.floor(z / CELL);
    let a = this.grid.get(k); if (!a) this.grid.set(k, (a = [])); a.push(it);
    return it;
  }
  /** العناصر اللي جوه r من نقطة (من غير ترتيب) */
  near(x, z, r, out = []) {
    out.length = 0;
    const c0 = Math.floor((x - r) / CELL), c1 = Math.floor((x + r) / CELL), d0 = Math.floor((z - r) / CELL), d1 = Math.floor((z + r) / CELL);
    for (let i = c0; i <= c1; i++) for (let j = d0; j <= d1; j++) {
      const a = this.grid.get(i * 100003 + j); if (!a) continue;
      for (const it of a) if ((it.x - x) ** 2 + (it.z - z) ** 2 < r * r) out.push(it);
    }
    return out;
  }
  update(cam, force = false) {
    const R = this.R, R2 = R * R, pick = this._pick || (this._pick = []);
    pick.length = 0;
    const c0 = Math.floor((cam.x - R) / CELL), c1 = Math.floor((cam.x + R) / CELL), d0 = Math.floor((cam.z - R) / CELL), d1 = Math.floor((cam.z + R) / CELL);
    for (let i = c0; i <= c1; i++) for (let j = d0; j <= d1; j++) {
      const a = this.grid.get(i * 100003 + j); if (!a) continue;
      for (const it of a) {
        const d2 = (it.x - cam.x) ** 2 + (it.z - cam.z) ** 2;
        if (d2 > R2) continue;
        if (it.ok === undefined) { it.ok = this.check ? this.check(it) : true; if (it.ok === undefined) continue; }
        if (!it.ok) continue;
        it.d2 = d2; pick.push(it);
      }
    }
    // عنصر واحد ممكن يبقى كذا نسخة فوق بعض (ext.rep كل ext.dy، و ext.skip = bitmask للي مش موجود): بلكونات الأدوار
    // → ذاكرة أقل بكتير (عنصر لكل عمود بلكونات بدل عنصر لكل بلكونة)
    pick.sort((a, b) => a.d2 - b.d2);
    const M = this.mesh;
    let k = 0;
    for (let i = 0; i < pick.length && k < this.max; i++) {
      const it = pick[i], e = it.ext, rep = e?.rep || 1;
      _q.setFromAxisAngle(_Y, it.yaw); _s.set(e?.sx ?? it.scale, it.sy, e?.sz ?? it.scale);
      for (let j = 0; j < rep && k < this.max; j++) {
        if (e?.skip && (e.skip >> j) & 1) continue;
        _p.set(it.x, it.y + j * (e?.dy || 0), it.z);
        M.setMatrixAt(k, _m.compose(_p, _q, _s));
        if (M.instanceColor && e?.color) M.instanceColor.setXYZ(k, e.color[0], e.color[1], e.color[2]);
        if (this.attrs && e?.a) for (let q = 0; q < this.attrs.length; q++) this.attrs[q][1].array[k] = e.a[q];
        k++;
      }
    }
    M.count = k; M.instanceMatrix.needsUpdate = true;
    if (M.instanceColor) M.instanceColor.needsUpdate = true;
    if (this.attrs) for (const [, a] of this.attrs) a.needsUpdate = true;
    M.visible = k > 0; // فاضية = مفيش draw call خالص (ولا في رسمة الضل)
    this.visibleCount = k;
    void force;
  }
}

// ===================== الأشكال =====================
function treeGeo(R) {
  const parts = [colored(new THREE.CylinderGeometry(0.11, 0.17, 2.6, 6, 1, true), [0.36, 0.29, 0.22], T(0, 1.3, 0))];
  const greens = [[0.2, 0.36, 0.16], [0.25, 0.42, 0.18], [0.18, 0.32, 0.15]];
  for (let k = 0; k < 3; k++) {
    const a = k * 2.1 + R() * 0.5, r = 1.1 + R() * 0.4;
    parts.push(colored(new THREE.IcosahedronGeometry(r, 0), greens[k], T(Math.cos(a) * 0.6, 3.1 + k * 0.35, Math.sin(a) * 0.6, 0, 1, 0.8, 1)));
  }
  return mergeGeometries(parts);
}
/** نخلة (بلح): جذع طويل بيضيق لفوق بحلقات + سعف نازل (كل سعفة شريط متني) + سباطة بلح */
function palmGeo() {
  const parts = [], H = 7.5;
  for (let i = 0; i < 6; i++) {
    const y0 = (i / 6) * H, h = H / 6, r0 = 0.24 - i * 0.018, r1 = r0 - 0.018;
    parts.push(colored(new THREE.CylinderGeometry(r1, r0, h, 7, 1, true), i % 2 ? [0.42, 0.34, 0.25] : [0.37, 0.3, 0.22], T(0, y0 + h / 2, 0)));
  }
  const N = 12;
  for (let k = 0; k < N; k++) {
    const a = (k / N) * Math.PI * 2 + (k % 2) * 0.2, L = 2.6 + (k % 3) * 0.35, droop = 0.55 + (k % 2) * 0.35;
    // سعفة: شريط من 4 حتت كل واحدة مايلة لتحت أكتر من اللي قبلها
    const g = new THREE.BufferGeometry(), pos = [];
    const seg = 4, w = 0.42;
    for (let s = 0; s < seg; s++) {
      const u0 = s / seg, u1 = (s + 1) / seg;
      const P = (u, side) => { const r = u * L, y = H + 0.15 + Math.sin(u * 1.4) * 0.5 - u * u * droop * 2.2, ww = w * Math.sin(Math.PI * Math.min(1, u * 1.15 + 0.08)); return [Math.cos(a) * r - Math.sin(a) * ww * side, y, Math.sin(a) * r + Math.cos(a) * ww * side]; };
      pos.push(...P(u0, -1), ...P(u1, -1), ...P(u1, 1), ...P(u0, -1), ...P(u1, 1), ...P(u0, 1));
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
    parts.push(colored(g, k % 3 === 0 ? [0.24, 0.36, 0.13] : [0.2, 0.42, 0.15]));
  }
  parts.push(colored(new THREE.SphereGeometry(0.32, 6, 5), [0.55, 0.32, 0.12], T(0.18, H - 0.3, 0.1)));
  return mergeGeometries(parts);
}
function benchGeo() {
  const wood = [0.42, 0.28, 0.16], iron = [0.16, 0.16, 0.17];
  return mergeGeometries([
    colored(new THREE.BoxGeometry(1.8, 0.06, 0.42), wood, T(0, 0.45, 0)),
    colored(new THREE.BoxGeometry(1.8, 0.36, 0.05), wood, T(0, 0.72, 0.2, 0, 1, 1, 1).multiply(new THREE.Matrix4().makeRotationX(-0.15))),
    colored(new THREE.BoxGeometry(0.06, 0.45, 0.4), iron, T(-0.78, 0.22, 0)),
    colored(new THREE.BoxGeometry(0.06, 0.45, 0.4), iron, T(0.78, 0.22, 0)),
  ]);
}
/** وحدة سور الكورنيش (طولها 2.5م على محور x): عمود + درابزين فوق + درابزين في النص */
function railGeo() {
  const c = [0.82, 0.8, 0.74], g = [0.25, 0.42, 0.36];
  return mergeGeometries([
    colored(new THREE.BoxGeometry(0.16, 1.0, 0.16), c, T(0, 0.5, 0)),
    colored(new THREE.BoxGeometry(2.5, 0.07, 0.07), g, T(1.25, 0.95, 0)),
    colored(new THREE.BoxGeometry(2.5, 0.05, 0.05), g, T(1.25, 0.55, 0)),
  ]);
}
function pavingGeo() {
  // بلاط الممشى: 2.5م × 3م (مربعات بلونين)
  const parts = [];
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
    const c = (i + j) % 2 ? [0.72, 0.66, 0.58] : [0.62, 0.52, 0.46];
    parts.push(colored(new THREE.PlaneGeometry(1.25, 1.5).rotateX(-Math.PI / 2), c, T(0.625 + i * 1.25, 0, 0.75 + j * 1.5)));
  }
  return mergeGeometries(parts);
}
function kioskGeo() {
  const parts = [
    colored(new THREE.BoxGeometry(2.2, 2.3, 1.6), [0.85, 0.82, 0.74], T(0, 1.15, 0)),
    colored(new THREE.BoxGeometry(2.6, 0.08, 2.2), [0.75, 0.15, 0.12], T(0, 2.4, 0.25)),
    colored(new THREE.BoxGeometry(1.6, 0.9, 0.04), [0.12, 0.1, 0.08], T(0, 1.35, 0.81)), // الشباك
    colored(new THREE.BoxGeometry(2.0, 0.25, 0.3), [0.9, 0.86, 0.8], T(0, 0.95, 0.95)),  // الرف
    colored(new THREE.BoxGeometry(0.5, 0.5, 0.5), [0.85, 0.2, 0.15], T(-1.4, 0.25, 0.3)), // تلاجة/صندوق حاجة ساقعة
  ];
  return mergeGeometries(parts);
}

// ===================== الاستاد =====================
/**
 * المدرجات حوالين أرضية الملعب الحقيقية. مدى كل جنب (لحد أقرب طريق) بيتحسب من الشبكة نفسها
 * عشان المدرجات عمرها ما تقفل شارع أو رصيف.
 */
function buildStadium(W, pitch, group) {
  const R4 = pitch.ring.slice(0, 4);
  const e0 = [R4[1][0] - R4[0][0], R4[1][1] - R4[0][1]], e1 = [R4[2][0] - R4[1][0], R4[2][1] - R4[1][1]];
  const L0 = Math.hypot(...e0), L1 = Math.hypot(...e1);
  const cx = R4.reduce((s, q) => s + q[0], 0) / 4, cz = R4.reduce((s, q) => s + q[1], 0) / 4;
  const [ux, uz, A, B] = L0 > L1 ? [e0[0] / L0, e0[1] / L0, L0 / 2, L1 / 2] : [e1[0] / L1, e1[1] / L1, L1 / 2, L0 / 2];
  const vx = -uz, vz = ux;
  const WP = (u, v, y = 0) => [cx + ux * u + vx * v, y, cz + uz * u + vz * v];
  // المسافة لأقرب طريق (ناقص عرضه ورصيفه)
  const near = edgesNear(W.graph, cx, cz, 160).filter((e) => !e.closed);
  const clear = (x, z) => {
    let m = 1e9;
    for (const e of near) for (let i = 0; i < e.pts.length - 1; i++) {
      const p = e.pts[i], q = e.pts[i + 1], ex = q.x - p.x, ez = q.z - p.z, l2 = ex * ex + ez * ez || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - p.x) * ex + (z - p.z) * ez) / l2));
      m = Math.min(m, Math.hypot(x - p.x - ex * t, z - p.z - ez * t) - e.half - (e.cls === 'service' ? 0.8 : 2.8));
    }
    return m;
  };
  const side = (su, sv) => {
    let best = 0;
    for (let r = 4; r <= 26; r++) {
      let ok = true;
      for (let t = -1; t <= 1.001; t += 0.1) {
        const [x, , z] = WP(su ? su * (A + r) : t * (A + r), sv ? sv * (B + r) : t * (B + r));
        if (clear(x, z) < 0) { ok = false; break; }
      }
      if (!ok) break; best = r;
    }
    return best;
  };
  const R = { pu: side(1, 0), nu: side(-1, 0), pv: side(0, 1), nv: side(0, -1) };
  if (Math.min(R.pu, R.nu, R.pv, R.nv) < 6) return null;
  const off = (k) => Math.min(k - 1, 22);
  const OU = [off(R.pu), off(R.nu)], OV = [off(R.pv), off(R.nv)];
  const r0 = 2.2, N = 12, stepH = 0.62;
  // حلقة المدرج رقم k: مستطيل بين الداخل (r0) والخارج (مختلف لكل جنب)
  const ring = (k) => {
    const f = k / N, pu = A + r0 + (OU[0] - r0) * f, nu = A + r0 + (OU[1] - r0) * f, pv = B + r0 + (OV[0] - r0) * f, nv = B + r0 + (OV[1] - r0) * f;
    return [[pu, pv], [-nu, pv], [-nu, -nv], [pu, -nv]];
  };
  const G = new GeoBuilder();
  const Q = (a, b, c, d) => G.quad(a, b, c, d);
  // الأرضية: نجيلة بخطوط + خطوط الملعب
  for (let i = 0; i < 12; i++) {
    G.setColor(i % 2 ? [0.2, 0.46, 0.18] : [0.24, 0.52, 0.2]);
    const u0 = -A + (2 * A * i) / 12, u1 = -A + (2 * A * (i + 1)) / 12;
    Q(WP(u0, -B, 0.05), WP(u1, -B, 0.05), WP(u1, B, 0.05), WP(u0, B, 0.05));
  }
  G.setColor([0.95, 0.95, 0.92]);
  const line = (u0, v0, u1, v1, w = 0.12) => {
    const du = u1 - u0, dv = v1 - v0, L = Math.hypot(du, dv) || 1, nu = (-dv / L) * w / 2, nv = (du / L) * w / 2;
    Q(WP(u0 - nu, v0 - nv, 0.07), WP(u1 - nu, v1 - nv, 0.07), WP(u1 + nu, v1 + nv, 0.07), WP(u0 + nu, v0 + nv, 0.07));
  };
  const a = A - 2.5, b = B - 2.5;
  line(-a, -b, a, -b); line(a, -b, a, b); line(a, b, -a, b); line(-a, b, -a, -b); line(0, -b, 0, b);
  for (let i = 0; i < 24; i++) { const t0 = (i / 24) * Math.PI * 2, t1 = ((i + 1) / 24) * Math.PI * 2; line(Math.cos(t0) * 9.15, Math.sin(t0) * 9.15, Math.cos(t1) * 9.15, Math.sin(t1) * 9.15); }
  for (const s of [-1, 1]) { line(s * a, -20.15, s * (a - 16.5), -20.15); line(s * (a - 16.5), -20.15, s * (a - 16.5), 20.15); line(s * (a - 16.5), 20.15, s * a, 20.15); line(s * a, -9.16, s * (a - 5.5), -9.16); line(s * (a - 5.5), -9.16, s * (a - 5.5), 9.16); line(s * (a - 5.5), 9.16, s * a, 9.16); }
  // المرمى
  G.setColor([0.96, 0.96, 0.96]);
  for (const s of [-1, 1]) {
    for (const v of [-3.66, 3.66]) G.addGeometry(new THREE.CylinderGeometry(0.06, 0.06, 2.44, 6), new THREE.Matrix4().makeTranslation(...WP(s * a, v, 1.22)));
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...WP(s * a, 0, 2.44)), new THREE.Quaternion().setFromAxisAngle(_Y, Math.atan2(vx, vz)), new THREE.Vector3(1, 1, 1));
    G.addGeometry(new THREE.BoxGeometry(0.1, 0.1, 7.4), new THREE.Matrix4().multiplyMatrices(m, new THREE.Matrix4().makeRotationY(Math.PI / 2)));
  }
  // التراك حوالين الأرضية (لون الطوب) لحد أول مدرج
  G.setColor([0.55, 0.3, 0.24]);
  { const r1 = ring(0); const r00 = [[A, B], [-A, B], [-A, -B], [A, -B]];
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; Q(WP(...r00[i], 0.04), WP(...r1[i], 0.04), WP(...r1[j], 0.04), WP(...r00[j], 0.04)); } }
  // المدرجات: درجات (قعدة ملونة + ضهر رمادي)
  const seats = [[0.78, 0.78, 0.76], [0.85, 0.16, 0.14], [0.78, 0.78, 0.76], [0.15, 0.25, 0.55]];
  for (let k = 0; k < N; k++) {
    const ra = ring(k), rb = ring(k + 1), y0 = 0.4 + k * stepH, y1 = y0 + stepH;
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      G.setColor([0.42, 0.42, 0.42]); // الواجهة الرأسية للدرجة
      Q(WP(...rb[i], y0), WP(...rb[j], y0), WP(...rb[j], y1), WP(...rb[i], y1));
      G.setColor(seats[(k + i) % 4]);
      Q(WP(...ra[i], y0), WP(...ra[j], y0), WP(...rb[j], y0), WP(...rb[i], y0));
    }
  }
  // الحيطة الأمامية (قدام الملعب)
  { const r = ring(0); G.setColor([0.88, 0.88, 0.84]); for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; Q(WP(...r[j], 0), WP(...r[i], 0), WP(...r[i], 0.4), WP(...r[j], 0.4)); } }
  // السور الخارجي: حيطة عالية بحزام ملون + أعمدة كل ~9م + بوابات
  const top = 0.4 + N * stepH, ro = ring(N), wallTop = top + 1.4;
  const gates = [];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4, [u0, v0] = ro[i], [u1, v1] = ro[j];
    const L = Math.hypot(u1 - u0, v1 - v0), nSeg = Math.max(2, Math.round(L / 9));
    for (let s = 0; s < nSeg; s++) {
      const f0 = s / nSeg, f1 = (s + 1) / nSeg, pa = [u0 + (u1 - u0) * f0, v0 + (v1 - v0) * f0], pb = [u0 + (u1 - u0) * f1, v0 + (v1 - v0) * f1];
      const gate = s === Math.floor(nSeg / 2) || (nSeg > 8 && (s === 2 || s === nSeg - 3));
      // الحيطة (من برا) — مبنى خرساني بأدوار مش لوح أبيض واحد (كان شكله غريب من الشارع):
      // دور أرضي محارة بشبابيك/أبواب غرف، فوقيه خرسانة بفتحات بتبان منها المدرجات، حزام لون النادي، ودروة فوق
      const [ou, ov] = [[0, 1], [-1, 0], [0, -1], [1, 0]][i];
      const out = (p, d) => [p[0] + ou * d, p[1] + ov * d];
      const lerpP = (f) => [pa[0] + (pb[0] - pa[0]) * f, pa[1] + (pb[1] - pa[1]) * f];
      const GF = 3.6;
      G.setColor([0.74, 0.67, 0.56]); Q(WP(...pb, 0), WP(...pa, 0), WP(...pa, GF), WP(...pb, GF));
      G.setColor([0.66, 0.66, 0.63]); Q(WP(...pb, GF), WP(...pa, GF), WP(...pa, wallTop), WP(...pb, wallTop));
      G.setColor([0.52, 0.5, 0.46]); Q(WP(...out(pb, 0.02), GF - 0.25), WP(...out(pa, 0.02), GF - 0.25), WP(...out(pa, 0.02), GF + 0.15), WP(...out(pb, 0.02), GF + 0.15));
      if (!gate) {
        // شباكين في الدور الأرضي (غامقين بحلق)
        for (const [f0, f1] of [[0.14, 0.4], [0.6, 0.86]]) {
          const w0 = out(lerpP(f0), 0.03), w1 = out(lerpP(f1), 0.03);
          G.setColor([0.12, 0.14, 0.16]); Q(WP(...w1, 1.3), WP(...w0, 1.3), WP(...w0, 2.7), WP(...w1, 2.7));
          G.setColor([0.84, 0.82, 0.76]); Q(WP(...w1, 1.18), WP(...w0, 1.18), WP(...w0, 1.3), WP(...w1, 1.3));
        }
      }
      // فتحات طويلة فوق (ضل المدرجات من جوه)
      { const w0 = out(lerpP(0.1), 0.03), w1 = out(lerpP(0.9), 0.03), y0 = GF + 1.1, y1 = Math.max(y0 + 0.8, top - 1.8);
        G.setColor([0.16, 0.16, 0.17]); Q(WP(...w1, y0), WP(...w0, y0), WP(...w0, y1), WP(...w1, y1)); }
      G.setColor([0.12, 0.32, 0.6]); Q(WP(...out(pb, 0.03), top - 1.2), WP(...out(pa, 0.03), top - 1.2), WP(...out(pa, 0.03), top - 0.5), WP(...out(pb, 0.03), top - 0.5));
      G.setColor([0.86, 0.85, 0.82]); Q(WP(...out(pb, 0.05), wallTop - 0.35), WP(...out(pa, 0.05), wallTop - 0.35), WP(...out(pa, 0.05), wallTop), WP(...out(pb, 0.05), wallTop));
      if (gate) {
        const pm = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2], du = (pb[0] - pa[0]) / 2 * 0.55, dv = (pb[1] - pa[1]) / 2 * 0.55;
        const g0 = [pm[0] - du, pm[1] - dv], g1 = [pm[0] + du, pm[1] + dv];
        // البوابة: فتحة غامقة + برواز + بوابة حديد
        const o = 0.03, nU = ring(N + 0.05)[i], ou = (nU[0] - u0) * 0, ov = 0; void ou; void ov; void o;
        const h0 = out(g0, 0.04), h1 = out(g1, 0.04);
        G.setColor([0.08, 0.08, 0.09]); Q(WP(...h1, 0.01), WP(...h0, 0.01), WP(...h0, 3.3), WP(...h1, 3.3));
        G.setColor([0.3, 0.3, 0.32]); Q(WP(...h1, 3.3), WP(...h0, 3.3), WP(...h0, 3.8), WP(...h1, 3.8));
        gates.push({ m: pm, i });
      }
      // عمود
      G.setColor([0.74, 0.72, 0.66]);
      const pc = WP(...pa, 0), yaw = Math.atan2(ux, uz);
      G.addGeometry(new THREE.BoxGeometry(0.7, wallTop + 0.4, 0.7), T(pc[0], (wallTop + 0.4) / 2, pc[2], yaw));
    }
  }
  // سقف مظلة فوق الجنب الأعمق (المقصورة)
  { const deep = OV[0] >= OV[1] ? 0 : 1, sv = deep ? -1 : 1, rI = ring(5), rO = ring(N);
    const i0 = deep ? 2 : 0, i1 = deep ? 3 : 1;
    const y = wallTop + 4.5;
    G.setColor([0.9, 0.9, 0.9]);
    Q(WP(...rO[i0], y), WP(...rO[i1], y), WP(...rI[i1], y + 0.6), WP(...rI[i0], y + 0.6));
    G.setColor([0.35, 0.35, 0.38]);
    const [u0, v0] = rO[i0], [u1, v1] = rO[i1];
    for (let s = 0; s <= 6; s++) { const f = s / 6, p = WP(u0 + (u1 - u0) * f, v0 + (v1 - v0) * f); G.addGeometry(new THREE.CylinderGeometry(0.18, 0.18, y, 6), T(p[0], y / 2, p[2])); }
    void sv;
  }
  // ممشى/ساحة حوالين السور (2.5م)
  { const rO = ring(N), rX = ring(N + 2.5 / ((OU[0] - r0) / N)); G.setColor([0.66, 0.62, 0.56]); for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; Q(WP(...rO[i], 0.03), WP(...rX[i], 0.03), WP(...rX[j], 0.03), WP(...rO[j], 0.03)); } }
  // أبراج الكشافات في الأركان
  const heads = new GeoBuilder(), lightPts = [];
  const ro2 = ring(N);
  for (let i = 0; i < 4; i++) {
    const [u, v] = ro2[i], fu = Math.sign(u) * 2.5, fv = Math.sign(v) * 2.5, p = WP(u + fu, v + fv);
    if (clear(p[0], p[2]) < -1) continue;
    G.setColor([0.55, 0.56, 0.58]);
    G.addGeometry(new THREE.CylinderGeometry(0.35, 0.7, 30, 8), T(p[0], 15, p[2]));
    const yaw = Math.atan2(cx - p[0], cz - p[2]);
    G.addGeometry(new THREE.BoxGeometry(5.6, 3.2, 0.5), T(p[0], 31.2, p[2], yaw));
    heads.setColor([1, 1, 1]);
    const hm = T(p[0], 31.2, p[2], yaw);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) heads.addGeometry(new THREE.PlaneGeometry(0.7, 0.7), new THREE.Matrix4().multiplyMatrices(hm, new THREE.Matrix4().makeTranslation(-2.2 + c * 0.88, -1 + r * 1, 0.27)));
    const hp = new THREE.Vector3(0, 0, 1.5).applyMatrix4(hm);
    lightPts.push(hp.x, hp.y, hp.z);
  }
  const mesh = new THREE.Mesh(linearizeColors(G.build()), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }));
  mesh.name = 'stadium'; mesh.castShadow = true; mesh.receiveShadow = true;
  group.add(mesh);
  const headMat = new THREE.MeshBasicMaterial({ color: 0x8a8c8e, toneMapped: false });
  const hmesh = new THREE.Mesh(heads.build(), headMat); group.add(hmesh);
  // يافطة على البوابة الرئيسية (الاسم زي ما هو في بيانات المعالم)
  const main = gates.find((g) => g.i === (OV[0] >= OV[1] ? 0 : 2)) || gates[0];
  let signMesh = null;
  if (main) {
    const c = canvas(1024, 160), x = c.getContext('2d');
    x.fillStyle = '#123c6e'; x.fillRect(0, 0, 1024, 160);
    x.fillStyle = '#fff'; x.font = 'bold 92px Cairo, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.direction = 'rtl';
    x.fillText(pitch.signName || 'الاستاد الرياضي', 512, 84);
    const sm = new THREE.MeshStandardMaterial({ map: tex(c, { repeat: false }), roughness: 0.6, emissive: 0xffffff, emissiveIntensity: 0.05 });
    sm.emissiveMap = sm.map;
    signMesh = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.4), sm);
    const [u, v] = main.m, p = WP(u * 1.004, v * 1.004, 5.4), q = WP(u * 2, v * 2, 5.4);
    signMesh.position.set(p[0], p[1], p[2]); signMesh.lookAt(q[0], q[1], q[2]);
    group.add(signMesh);
  }
  // السور جسم حقيقي (الأربع جناب)
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4, [u0, v0] = ro[i], [u1, v1] = ro[j];
    const pa = WP(u0, v0), pb = WP(u1, v1), L = Math.hypot(pb[0] - pa[0], pb[2] - pa[2]);
    W._addCollider({ cx: (pa[0] + pb[0]) / 2, cz: (pa[2] + pb[2]) / 2, hx: L / 2, hz: 0.5, angle: Math.atan2(pb[0] - pa[0], pb[2] - pa[2]) - Math.PI / 2, restitution: 0.12, kind: 'wall' }, null);
  }
  return {
    center: [cx, cz], sides: R, top, lightPts,
    setNight(on) { headMat.color.set(on ? 0xfff6dc : 0x8a8c8e); },
  };
}

// ===================== الكورنيش =====================
function buildCorniche(W, canals, out) {
  const R = rng(4242);
  const onRoad = (x, z, pad) => {
    const r = W.nearestRoad(x, z, 30);
    return r && r.d < r.e.half + pad;
  };
  const groundOk = (it) => {
    const Tl = W.tiles.get(W._tkey(Math.floor(it.x / W.TS), Math.floor(it.z / W.TS)));
    if (!Tl || !Tl.ready) return undefined;
    const h = W.height(it.x, it.z, 0);
    return h > -0.05 && h < 0.2;
  };
  for (const c of canals) {
    const p = c.p, hw = (c.w || 10) / 2;
    for (const sd of [1, -1]) {
      let acc = 0, k = 0, bench = 6, tree = 3, kiosk = 60 + R() * 80, lamp = 10;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3], L = Math.hypot(bx - ax, bz - az);
        if (L < 0.5) continue;
        const dx = (bx - ax) / L, dz = (bz - az) / L, nx = -dz * sd, nz = dx * sd;
        for (let s = acc; s < L; s += 2.5, k++) {
          const cx = ax + dx * s, cz = az + dz * s;
          const rx = cx + nx * (hw + 0.4), rz = cz + nz * (hw + 0.4);
          if (onRoad(rx, rz, 0.5) || W._underDeck?.(rx, rz)) continue;
          const yaw = Math.atan2(-dz, dx); // محور x المحلي على طول الترعة
          out.rail.add(rx, 0, rz, yaw);
          // الممشى ورا السور (لو فيه مكان 3م قبل الشارع)
          const fx = cx + nx * (hw + 3.6), fz = cz + nz * (hw + 3.6);
          const walk = !onRoad(fx, fz, 0.3) && !W._underDeck?.(fx, fz);
          if (walk) {
            out.paving.add(rx - nx * 0.1, 0.04, rz - nz * 0.1, Math.atan2(-dz, dx) + (sd > 0 ? 0 : Math.PI), 1);
            if ((bench -= 2.5) <= 0) {
              bench = 18 + R() * 8;
              const bx2 = cx + nx * (hw + 1.4), bz2 = cz + nz * (hw + 1.4), byaw = Math.atan2(-nx, -nz) + Math.PI; // وشها للترعة
              out.bench.add(bx2, 0.04, bz2, byaw);
              if (R() < 0.55) { const v = R() < 0.5 ? 0 : 1; (v ? out.sit1 : out.sit0).add(bx2 + dx * (R() - 0.5) * 1.2 - nx * 0.05, 0.47, bz2 + dz * (R() - 0.5) * 1.2 - nz * 0.05, Math.atan2(-nx, -nz), 0.95); }
            }
            if ((tree -= 2.5) <= 0) { tree = 11 + R() * 6; const tx = cx + nx * (hw + 3.1), tz = cz + nz * (hw + 3.1); out.tree.add(tx, 0, tz, R() * 6.28, 0.9 + R() * 0.35); }
            if ((kiosk -= 2.5) <= 0) {
              kiosk = 160 + R() * 120;
              const kx = cx + nx * (hw + 2.4), kz = cz + nz * (hw + 2.4);
              if (!onRoad(kx, kz, 1.2) && !W._underDeck?.(kx, kz)) { out.kiosk.add(kx, 0.04, kz, Math.atan2(nx, nz)); W._addCollider({ cx: kx, cz: kz, hx: 1.2, hz: 0.9, angle: Math.atan2(nx, nz), restitution: 0.1, kind: 'prop' }, null); }
            }
            if ((lamp -= 2.5) <= 0) { lamp = 27; out.lamps.push({ x: rx - nx * 0.3, z: rz - nz * 0.3, y: 0.04, ax: -nx, az: -nz }); }
          }
        }
        acc = ((acc - L) % 2.5 + 2.5) % 2.5;
      }
    }
  }
  for (const k of ['rail', 'paving', 'bench', 'kiosk', 'sit0', 'sit1']) out[k].check = groundOk;
  out.tree.cornicheCheck = groundOk;
}

// ===================== شجر الأرصفة =====================
function streetTrees(W, inst) {
  const R = rng(99), q = {};
  const CLS = new Set(['primary', 'secondary', 'tertiary', 'primary_link', 'secondary_link']);
  for (const e of W.graph.edges) {
    if (!CLS.has(e.cls) || e.closed || e.elevated || e.length < 30) continue;
    for (let s = 9 + R() * 6; s < e.length - 9; s += 13 + R() * 9) {
      edgePoint(e, s, q);
      for (const sd of e.width >= 11 ? [1, -1] : [R() < 0.5 ? 1 : -1]) {
        if (R() < 0.25) continue;
        const off = e.half + 1.2, x = q.x - q.dz * sd * off, z = q.z + q.dx * sd * off;
        inst.add(x, 0.15, z, R() * 6.28, 0.75 + R() * 0.3);
      }
    }
  }
  const corn = inst.cornicheCheck;
  inst.check = (it) => {
    if (it.tag === 'corniche') return corn(it);
    if (it.tag === 'roundabout') return true; // جوه جزيرة الميدان (المكان اتحسب من الداتا)
    const Tl = W.tiles.get(W._tkey(Math.floor(it.x / W.TS), Math.floor(it.z / W.TS)));
    if (!Tl || !Tl.ready) return undefined;
    if (W._underDeck?.(it.x, it.z)) return false;
    return Math.abs(W.height(it.x, it.z, 0) - 0.15) < 0.01; // على الرصيف بس
  };
}

// ===================== جزر الدورانات =====================
/** list: [{x, z, island:[x,z,...], area}] من features.json (tools/osm/roundabouts.py) */
function buildRoundabouts(W, list, group, trees) {
  const R = rng(77), H = 0.24;
  const gp = [], gi = [], cp = [], cc = [], ci = [];
  const yel = lin([0.95, 0.76, 0.1]), blk = lin([0.08, 0.08, 0.08]), top = lin([0.72, 0.7, 0.66]);
  for (const rb of list) {
    const pts = []; for (let i = 0; i < rb.island.length; i += 2) pts.push(new THREE.Vector2(rb.island[i], rb.island[i + 1]));
    if (pts.length < 3) continue;
    if (THREE.ShapeUtils.isClockWise(pts)) pts.reverse();
    // النجيلة
    const k0 = gp.length / 3;
    for (const p of pts) gp.push(p.x, H, p.y);
    for (const tr of THREE.ShapeUtils.triangulateShape(pts, [])) gi.push(k0 + tr[0], k0 + tr[2], k0 + tr[1]);
    // الحرف: حيطة صغيرة بره الجزيرة مدهونة أصفر/أسود كل متر + تصادم
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length], L = a.distanceTo(b);
      if (L < 0.05) continue;
      const nx = (b.y - a.y) / L, nz = -(b.x - a.x) / L; // لبره (الحلقة عكس عقارب الساعة)
      const n = Math.max(1, Math.round(L));
      for (let s = 0; s < n; s++) {
        const u0 = s / n, u1 = (s + 1) / n;
        const x0 = a.x + (b.x - a.x) * u0, z0 = a.y + (b.y - a.y) * u0, x1 = a.x + (b.x - a.x) * u1, z1 = a.y + (b.y - a.y) * u1;
        const col = (s + i) % 2 ? yel : blk, k = cp.length / 3;
        cp.push(x0 + nx * 0.18, 0, z0 + nz * 0.18, x1 + nx * 0.18, 0, z1 + nz * 0.18, x1 + nx * 0.18, H, z1 + nz * 0.18, x0 + nx * 0.18, H, z0 + nz * 0.18);
        cp.push(x0 + nx * 0.18, H, z0 + nz * 0.18, x1 + nx * 0.18, H, z1 + nz * 0.18, x1, H + 0.005, z1, x0, H + 0.005, z0);
        for (let j = 0; j < 4; j++) cc.push(...col);
        for (let j = 0; j < 4; j++) cc.push(...top);
        ci.push(k, k + 2, k + 1, k, k + 3, k + 2, k + 4, k + 6, k + 5, k + 4, k + 7, k + 6);
      }
      W._addCollider({ cx: (a.x + b.x) / 2 + nx * 0.1, cz: (a.y + b.y) / 2 + nz * 0.1, hx: 0.2, hz: L / 2, angle: Math.atan2(b.x - a.x, b.y - a.y), restitution: 0.15, kind: 'curb', yMax: H + 0.1 }, null);
    }
    // نخل: واحدة في النص للجزيرة الصغيرة، ودايرة نخل (وشجر جوه) للكبيرة
    const inside = (x, z) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const p = pts[i], q = pts[j]; if ((p.y > z) !== (q.y > z) && x < ((q.x - p.x) * (z - p.y)) / (q.y - p.y) + p.x) c = !c; } return c; };
    trees.add(rb.x, H, rb.z, R() * 6.28, 1.0, 1.0, 'roundabout');
    if (rb.area > 60) {
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length], L = a.distanceTo(b);
        for (let s = 3; s < L; s += 7) {
          const x = a.x + (b.x - a.x) * (s / L), z = a.y + (b.y - a.y) * (s / L);
          const dx = rb.x - x, dz = rb.z - z, l = Math.hypot(dx, dz) || 1;
          const px = x + dx / l * 1.8, pz = z + dz / l * 1.8;
          if (inside(px, pz)) trees.add(px, H, pz, R() * 6.28, 0.8 + R() * 0.25, 0.8 + R() * 0.25, 'roundabout');
        }
      }
    }
  }
  if (!gi.length) return 0;
  const gg = new THREE.BufferGeometry();
  gg.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3)); gg.setIndex(gi); gg.computeVertexNormals();
  const grass = new THREE.Mesh(gg, new THREE.MeshStandardMaterial({ map: grassTex(), color: 0xffffff, roughness: 1 }));
  { const uv = []; for (let i = 0; i < gp.length; i += 3) uv.push(gp[i] / 3, gp[i + 2] / 3); gg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); }
  grass.receiveShadow = true; grass.name = 'roundabout-grass'; group.add(grass);
  const cg = new THREE.BufferGeometry();
  cg.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3)); cg.setAttribute('color', new THREE.Float32BufferAttribute(cc, 3)); cg.setIndex(ci); cg.computeVertexNormals();
  const curb = new THREE.Mesh(cg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }));
  curb.receiveShadow = true; curb.name = 'roundabout-curb'; group.add(curb);
  return list.length;
}

/** نجيلة: ضوضاء خضرا بسيطة (بتتكرر كل 3م) */
let _grass = null;
function grassTex() {
  if (_grass) return _grass;
  const c = canvas(128, 128), x = c.getContext('2d'), R = rng(5);
  x.fillStyle = '#4c7a2f'; x.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 900; i++) { const g = 90 + R() * 70; x.fillStyle = `rgba(${40 + R() * 40},${g},${20 + R() * 30},0.55)`; x.fillRect(R() * 128, R() * 128, 1 + R() * 2, 2 + R() * 4); }
  return (_grass = tex(c));
}

// ===================== قعدة القهوة (OSM amenity=cafe) =====================
/** كل قهوة في OSM: كراسي بلاستيك بيضا جنب ترابيزة أو اتنين على الرصيف قدامها (ناحية الشارع) */
function cafeSeating(W, pois, mobile) {
  const a = W.assets?.get?.('chair_plastic');
  if (!a) return null;
  let src = null;
  a.holder.updateMatrixWorld(true);
  a.holder.traverse((o) => { if (o.isMesh && !src) src = o; });
  if (!src) return null;
  const geo = src.geometry.clone().applyMatrix4(src.matrixWorld);
  const mat = src.material.clone(); mat.side = THREE.DoubleSide;
  const cafes = pois.filter((p) => p.kind === 'cafe');
  if (!cafes.length) return null;
  const chairs = new NearInstancer(geo, mat, { R: mobile ? 70 : 110, max: mobile ? 60 : 160, name: 'cafe-chair', castShadow: !mobile });
  // ترابيزة صاج مدوّرة (رجل واحدة) — نفس خامة الحاجات التانية
  const tg = mergeGeometries([
    new THREE.CylinderGeometry(0.33, 0.33, 0.03, 16).translate(0, 0.7, 0),
    new THREE.CylinderGeometry(0.03, 0.03, 0.7, 6).translate(0, 0.35, 0),
    new THREE.CylinderGeometry(0.2, 0.22, 0.03, 12).translate(0, 0.015, 0),
  ]);
  const tables = new NearInstancer(tg, new THREE.MeshStandardMaterial({ color: 0x9aa3a8, metalness: 0.6, roughness: 0.45 }), { R: mobile ? 70 : 110, max: mobile ? 25 : 60, name: 'cafe-table' });
  const R = rng(31);
  for (const p of cafes) {
    const r = W.nearestRoad(p.p[0], p.p[1], 60);
    if (!r || r.e.elevated) continue;
    let nx = -r.dz, nz = r.dx;
    if ((p.p[0] - r.x) * nx + (p.p[1] - r.z) * nz < 0) { nx = -nx; nz = -nz; }
    const tx = r.dx, tz = r.dz, nT = 1 + (R() < 0.5 ? 1 : 0);
    for (let k = 0; k < nT; k++) {
      // الرصيف المصري ضيق (1.2–3م): الترابيزة على بعد متر من حرف الأسفلت، والكراسي جنبها على طول الرصيف
      // (يمين وشمال) وشها للترابيزة — والكرسي اللي يطلع برا الرصيف بيتشال لوحده (الفحص تحت)
      const along = (k - (nT - 1) / 2) * 2.6, off = r.e.half + 1.0;
      const cx = r.x + nx * off + tx * along, cz = r.z + nz * off + tz * along;
      tables.add(cx, 0.15, cz, 0);
      for (const [a, o] of [[-0.68, 0], [0.68, 0], [0, 0.7], [-0.5, 0.65], [0.5, 0.65]].slice(0, 2 + Math.floor(R() * 3))) {
        const x = cx + tx * a + nx * o, z = cz + tz * a + nz * o;
        chairs.add(x, 0.15, z, Math.atan2(cx - x, cz - z) + (R() - 0.5) * 0.35);
      }
    }
  }
  // على الرصيف بس (زي الشجر) — ومش جوه شارع تاني ولا تحت كوبري
  const ok = (it) => {
    const Tl = W.tiles.get(W._tkey(Math.floor(it.x / W.TS), Math.floor(it.z / W.TS)));
    if (!Tl || !Tl.ready) return undefined;
    if (W._underDeck?.(it.x, it.z)) return false;
    return Math.abs(W.height(it.x, it.z, 0) - 0.15) < 0.01;
  };
  chairs.check = ok; tables.check = ok;
  return { chairs, tables };
}

// ===================== قهاوي كورنيش البحر =====================
/** على طريق الكورنيش (OSM: "طريق الجيش" / "كورنيش"): كل 70–140م قعدة على رصيف البحر —
 *  ترابيزات بكراسي بلاستيك وشمسيات، وأحيانًا كشك، وناس قاعدة. ناحية البحر بتتعرف وقت ما المربع يتحمّل
 *  (لو على بعد 12–45م في الاتجاه ده فيه مية) — الناحية التانية بتتشال. مش متسجّلة كأماكن حقيقية (من غير أسامي). */
function seaCafes(W, out, chair, mobile) {
  const E = W.graph.edges.filter((e) => /طريق الجيش|كورنيش/.test(e.name || '') && !e.elevated && e.length > 30);
  if (!E.length) return 0;
  const R = rng(777), q = {};
  const umbGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.03, 0.03, 2.3, 6).translate(0, 1.15, 0),
    new THREE.ConeGeometry(1.35, 0.45, 8, 1, true).translate(0, 2.3, 0),
    new THREE.CylinderGeometry(0.25, 0.3, 0.12, 8).translate(0, 0.06, 0),
  ].map((g) => g.toNonIndexed()));
  const umbMat = new THREE.MeshStandardMaterial({ roughness: 0.85, side: THREE.DoubleSide });
  const umb = new NearInstancer(umbGeo, umbMat, { R: mobile ? 90 : 140, max: mobile ? 30 : 70, name: 'cafe-umbrella', colors: true, castShadow: !mobile });
  out.umbrella = umb;
  // نخل على رصيف البحر (على طول الكورنيش كل ~16م)
  const palms = new NearInstancer(palmGeo(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }), { R: mobile ? 160 : 240, max: mobile ? 50 : 110, name: 'corniche-palm', castShadow: !mobile });
  out.palm = palms;
  const UC = [[0.86, 0.12, 0.1], [0.12, 0.35, 0.72], [0.95, 0.95, 0.92], [0.98, 0.72, 0.08], [0.1, 0.55, 0.3]].map((c) => new THREE.Color().setRGB(...c, THREE.SRGBColorSpace).toArray());
  const seaSide = (it) => {
    for (const d of [12, 22, 32, 45]) { const h = W.height(it.x + it.sx * d, it.z + it.sz * d, 0); if (h < -0.4) return true; }
    return false;
  };
  const tileReady = (x, z) => { const Tl = W.tiles.get(W._tkey(Math.floor(x / W.TS), Math.floor(z / W.TS))); return !!(Tl && Tl.ready); };
  const okSea = (it) => {
    if (!tileReady(it.x, it.z) || !tileReady(it.x + it.sx * 45, it.z + it.sz * 45)) return undefined;
    if (W._underDeck?.(it.x, it.z)) return false;
    const r = W.nearestRoad(it.x, it.z, 30); if (r && r.d < r.e.half + 0.6) return false;
    const h = W.height(it.x, it.z, 0); if (h < -0.05 || h > 0.2) return false;
    it.y = h + (it.dy || 0);
    return seaSide(it);
  };
  const wrap = (inst) => { if (!inst) return; const prev = inst.check; inst.check = (it) => (it.sea ? okSea(it) : prev ? prev(it) : true); };
  for (const k of ['kiosk', 'sit0', 'sit1']) wrap(out[k]);
  wrap(chair.chairs); wrap(chair.tables); umb.check = okSea; palms.check = okSea;
  const mark = (it, sx, sz, dy = 0) => { if (it) { it.sea = true; it.sx = sx; it.sz = sz; it.dy = dy; } return it; };
  let n = 0;
  for (const e of E) {
    for (let s = 6; s < e.length - 4; s += 14 + R() * 5) {
      edgePoint(e, s, q);
      for (const sd of [1, -1]) { const nx = -q.dz * sd, nz = q.dx * sd; mark(palms.add(q.x + nx * (e.half + 1.3), 0, q.z + nz * (e.half + 1.3), R() * 6.28, 0.85 + R() * 0.3), nx, nz); }
    }
    for (let s = 20 + R() * 60; s < e.length - 10; s += 70 + R() * 70) {
      edgePoint(e, s, q);
      for (const sd of [1, -1]) {
        const nx = -q.dz * sd, nz = q.dx * sd, nT = 3 + Math.floor(R() * 3);
        for (let k = 0; k < nT; k++) {
          const along = (k - (nT - 1) / 2) * 3.2, off = e.half + 3.2 + (k % 2) * 1.6;
          const cx = q.x + nx * off + q.dx * along, cz = q.z + nz * off + q.dz * along;
          mark(chair.tables.add(cx, 0.15, cz, 0), nx, nz);
          mark(umb.add(cx, 0.15, cz, R() * 6.28, 1, 1, undefined, { color: UC[Math.floor(R() * UC.length)] }), nx, nz);
          const nc = 2 + Math.floor(R() * 3);
          for (let c = 0; c < nc; c++) {
            const a = (c / nc) * 6.28 + R() * 0.5, x = cx + Math.cos(a) * 0.72, z = cz + Math.sin(a) * 0.72, yaw = Math.atan2(cx - x, cz - z);
            mark(chair.chairs.add(x, 0.15, z, yaw), nx, nz);
            // ناس قاعدة (مش كل الكراسي)
            if (R() < 0.45) { const S = R() < 0.5 || !out.sit1 ? out.sit0 : out.sit1; mark(S.add(x, 0.47, z, yaw, 0.95), nx, nz, 0.32); }
          }
        }
        if (R() < 0.4) { const kx = q.x + nx * (e.half + 2.2) + q.dx * (nT * 1.8 + 2), kz = q.z + nz * (e.half + 2.2) + q.dz * (nT * 1.8 + 2); mark(out.kiosk.add(kx, 0.04, kz, Math.atan2(-nx, -nz)), nx, nz, 0.04); }
        n++;
      }
    }
  }
  return n;
}

// ===================== يافطات المحلات (OSM) =====================
const POI_STYLE = {
  cafe: { bg: '#5b3a1e', fg: '#ffe7b0', icon: '☕' }, restaurant: { bg: '#8a1c12', fg: '#fff', icon: '🍽' }, fast_food: { bg: '#c0392b', fg: '#fff', icon: '🍔' },
  pharmacy: { bg: '#127a3a', fg: '#fff', icon: '✚' }, bakery: { bg: '#a8641d', fg: '#fff', icon: '🥖' }, bank: { bg: '#123c6e', fg: '#fff', icon: '🏦' }, atm: { bg: '#123c6e', fg: '#fff', icon: '🏧' },
  shop: { bg: '#f2f2ee', fg: '#222', icon: '🛍' }, school: { bg: '#2b5d8a', fg: '#fff', icon: '🏫' }, post_office: { bg: '#d9a400', fg: '#1b1b1b', icon: '✉' },
  place_of_worship: { bg: '#1f5e4a', fg: '#fff', icon: '' }, fuel: { bg: '#0b7a3e', fg: '#fff', icon: '⛽' },
};
function poiSigns(W, pois, group, skipNames) {
  let list = pois.filter((p) => p.name && /[؀-ۿ]/.test(p.name) && !skipNames.has(p.name) && POI_STYLE[p.kind]);
  if (!list.length) return 0;
  // المدن الكبيرة (الإسكندرية ~400 يافطة): الأطلس كان بيطلع 13 ألف بكسل طول (الموبايل حده 4096 → بيتصغّر ويتبوّظ):
  // أكتر من 128 يافطة → خانة نص الحجم، ولحد 512 يافطة (الأقرب لوسط البلد)
  const big = list.length > 128, k = big ? 0.5 : 1;
  if (list.length > 512) list = list.sort((a, b) => Math.hypot(a.p[0], a.p[1]) - Math.hypot(b.p[0], b.p[1])).slice(0, 512);
  const COLS = big ? 8 : 4, SW = 512 * k, SH = 128 * k, rows = Math.ceil(list.length / COLS);
  const c = canvas(SW * COLS, SH * rows), x = c.getContext('2d');
  const G = new GeoBuilder(), poles = new GeoBuilder();
  let n = 0;
  list.forEach((p, i) => {
    const st = POI_STYLE[p.kind], col = i % COLS, row = Math.floor(i / COLS);
    x.fillStyle = st.bg; x.fillRect(col * SW, row * SH, SW, SH);
    x.strokeStyle = 'rgba(255,255,255,0.6)'; x.lineWidth = 5 * k; x.strokeRect(col * SW + 6 * k, row * SH + 6 * k, SW - 12 * k, SH - 12 * k);
    x.fillStyle = st.fg; x.textAlign = 'center'; x.textBaseline = 'middle'; x.direction = 'rtl';
    let fs = 56 * k; x.font = `bold ${fs}px Cairo, sans-serif`;
    const label = `${p.name}`;
    while (x.measureText(label).width > SW - 40 * k && fs > 22 * k) { fs -= 4 * k; x.font = `bold ${fs}px Cairo, sans-serif`; }
    x.fillText(label, col * SW + SW / 2, row * SH + SH / 2 + 4 * k);
    // أقرب رصيف للمكان
    const r = W.nearestRoad(p.p[0], p.p[1], 80);
    if (!r || r.e.elevated) return;
    let nx = -r.dz, nz = r.dx;
    if ((p.p[0] - r.x) * nx + (p.p[1] - r.z) * nz < 0) { nx = -nx; nz = -nz; }
    const off = r.e.half + 0.9, sx = r.x + nx * off, sz = r.z + nz * off;
    // مكان اللافتة نفسه مايبقاش على طريق تاني (تقاطع/منزل كوبري) ولا تحت كوبري
    const q = W.nearestRoad(sx, sz, 30);
    if (q && q.d < q.e.half + 0.6 || W._underDeck?.(sx, sz)) return;
    const yaw = Math.atan2(nx, nz);
    const m = T(sx, 2.75, sz, yaw);
    const u0 = col / COLS, u1 = (col + 1) / COLS, v1 = 1 - row / rows, v0 = 1 - (row + 1) / rows;
    const w = 2.6, h = 0.65;
    G.setTransform(m);
    // وشين للافتة (للناحيتين)
    // (أول الصورة u0 على شمال اللي باصص للوش — كانت معكوسة فالكلام بيبان زي المراية من الناحيتين)
    G.quad([-w / 2, -h / 2, 0.05], [w / 2, -h / 2, 0.05], [w / 2, h / 2, 0.05], [-w / 2, h / 2, 0.05], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
    G.quad([w / 2, -h / 2, -0.05], [-w / 2, -h / 2, -0.05], [-w / 2, h / 2, -0.05], [w / 2, h / 2, -0.05], [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
    poles.setColor([0.22, 0.23, 0.24]);
    poles.addGeometry(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6), T(sx, 1.35, sz));
    poles.addGeometry(new THREE.BoxGeometry(w + 0.1, h + 0.1, 0.08), m);
    W._addCollider({ cx: sx, cz: sz, hx: 0.12, hz: 0.12, angle: 0, restitution: 0.1, kind: 'prop' }, null);
    n++;
  });
  if (!n) return 0;
  const sm = new THREE.MeshStandardMaterial({ map: tex(c, { repeat: false }), roughness: 0.6, emissive: 0xffffff, emissiveIntensity: 0.08 });
  sm.emissiveMap = sm.map;
  const sg = new THREE.Mesh(G.build(), sm); sg.name = 'poi-signs';
  const pg = new THREE.Mesh(linearizeColors(poles.build()), propMaterial()); pg.name = 'poi-poles';
  group.add(sg, pg);
  return n;
}

/** كل الملامح. بيرجّع { update(cam), setNight(on), lampSpots, stats } */
export function buildLandmarks(W, features, { mobile = false } = {}) {
  const group = new THREE.Group(); group.name = 'shibin-landmarks';
  const stats = {};
  const PM = propMaterial();
  const R = mobile ? 150 : 220;
  // الاستاد: أرضية الملعب (pitch) اللي جوه مضلع الاستاد في OSM
  let stadium = null;
  const st = W.landmarks.confirmed.find((l) => l.id === 'stadium');
  if (st?.footprint && features?.areas) {
    const inPoly = (x, z, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
    const pitch = features.areas.find((a) => a.kind === 'pitch' && a.ring.length >= 5 && inPoly(a.ring.reduce((s, q) => s + q[0], 0) / a.ring.length, a.ring.reduce((s, q) => s + q[1], 0) / a.ring.length, st.footprint));
    if (pitch) { stadium = buildStadium(W, { ...pitch, signName: st.name }, group); stats.stadium = stadium ? { osm: pitch.osm, sides: stadium.sides } : 'no room'; }
  }
  // الكورنيش
  const sitV = humanVariants(2, 515, true);
  const out = {
    rail: new NearInstancer(railGeo(), PM, { R, max: mobile ? 220 : 380, name: 'corniche-rail' }),
    paving: mobile ? null : new NearInstancer(pavingGeo(), PM, { R, max: 380, name: 'corniche-paving' }), // الموبايل: من غير بلاط (تفصيلة صغيرة)
    bench: new NearInstancer(benchGeo(), PM, { R, max: 60, name: 'corniche-bench' }),
    tree: null, // نفس شجر الشوارع (instancing واحد للشجر كله)
    kiosk: new NearInstancer(kioskGeo(), PM, { R: R + 60, max: 20, name: 'corniche-kiosk', castShadow: true }),
    sit0: new NearInstancer(seatedGeometry(sitV[0].geo), humanStaticMaterial(), { R: mobile ? 80 : 120, max: 40, name: 'corniche-sit0' }),
    sit1: mobile ? null : new NearInstancer(seatedGeometry(sitV[1].geo), humanStaticMaterial(), { R: 120, max: 40, name: 'corniche-sit1' }),
    lamps: [],
  };
  const canals = (W._mmWater || []).filter((w) => w.name === 'ترعة بحر شبين' && w.kind === 'canal');
  const trees = new NearInstancer(treeGeo(rng(13)), PM, { R: mobile ? 140 : 200, max: mobile ? 150 : 300, name: 'trees', castShadow: !mobile });
  out.tree = trees;
  const nop = { add() {}, items: [] };
  if (!out.paving) out.paving = nop;
  if (!out.sit1) out.sit1 = out.sit0;
  buildCorniche(W, canals, out);
  stats.corniche = { canals: canals.length, rail: out.rail.items.length, benches: out.bench.items.length, trees: trees.items.length, kiosks: out.kiosk.items.length };
  // شجر الأرصفة (نفس الـ instancer): شجر الكورنيش اتعلّم بـ tag عشان فحصه مختلف (أرض مش رصيف)
  for (const it of trees.items) it.tag = 'corniche';
  streetTrees(W, trees);
  stats.streetTrees = trees.items.length;
  // جزر الميادين/الدورانات الحقيقية (OSM): نجيلة + حرف أصفر وأسود + نخل (كانت تراب/عمارة في النص)
  stats.roundabouts = features?.roundabouts ? buildRoundabouts(W, features.roundabouts, group, trees) : 0;
  // يافطات المحلات
  const skip = new Set(W.landmarks.confirmed.map((l) => l.name));
  stats.poiSigns = features?.pois ? poiSigns(W, features.pois, group, skip) : 0;
  // القهاوي اللي في OSM: كراسي بلاستيك (موديل حقيقي CC0) وترابيزات صغيرة على الرصيف قدامها
  const chair = cafeSeating(W, features?.pois || [], mobile);
  if (chair) { out.chair = chair.chairs; out.table = chair.tables; stats.cafeChairs = chair.chairs.items.length; }
  // كورنيش البحر (إسكندرية وأي مدينة على البحر): قعدات قهاوي على رصيف البحر — مولّدة (من غير أسامي)، زي العمارات المولّدة
  if (W.waterStyle === 'sea' && chair) stats.seaCafes = seaCafes(W, out, chair, mobile);
  const insts = [...new Set([...['rail', 'paving', 'bench', 'kiosk', 'sit0', 'sit1', 'chair', 'table', 'umbrella', 'palm'].map((k) => out[k]), trees])].filter((x) => x?.mesh);
  for (const it of insts) group.add(it.mesh);
  let t = 0;
  return {
    group, stats, stadium, lampSpots: out.lamps, instancers: insts,
    update(dt, cam) { t -= dt; if (t > 0) return; t = 0.5; for (const it of insts) it.update(cam); },
    setNight(on) { stadium?.setNight(on); },
  };
}
