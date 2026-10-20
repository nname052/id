// =====================================================================
//  LOD للعربيات اللي في المرور/المركونة: نسخة "مخبوزة" من نفس العربية = Mesh واحدة (draw call واحد)
//  - كل قطعة بلون خامتها × متوسط لون الصورة بتاعتها (vertex colors) — من بعيد شكلها ولونها نفس العربية
//  - الزجاج غامق مصمت، والعجل ثابت (من بعيد اللفة مش باينة)
//  - الـ geometry متخزنة لكل (نوع + لون) ومتشاركة بين كل العربيات اللي زي بعض
//  القريبة (Tier A) بتفضل العربية الكاملة بتفاصيلها؛ دي للمسافة المتوسطة والبعيدة (Tier B/C)
// =====================================================================
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const texAvg = new WeakMap();
const cache = new Map();
const _inv = new THREE.Matrix4(), _m = new THREE.Matrix4();
/** للقياس: كام شكل اتخبز وكام لون اتعمل */
export const lodStats = { shapes: 0, variants: 0, ms: 0 };
let lodMat = null;

function averageColor(tex) {
  if (!tex?.image) return null;
  if (texAvg.has(tex)) return texAvg.get(tex);
  let c = null;
  try {
    const cv = document.createElement('canvas'); cv.width = cv.height = 4;
    const x = cv.getContext('2d', { willReadFrequently: true });
    x.drawImage(tex.image, 0, 0, 4, 4);
    const d = x.getImageData(0, 0, 4, 4).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 40) continue; r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
    if (n) c = new THREE.Color().setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace);
  } catch { /* صورة مش متاحة للقراءة */ }
  texAvg.set(tex, c);
  return c;
}

/** المادة المشتركة لكل نسخ الـ LOD */
let lodMats = null;
export function lodMaterials() {
  return (lodMats ||= [lodMaterial(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.12, metalness: 0.3, envMapIntensity: 0.35, side: THREE.DoubleSide })]);
}
export function lodMaterial() {
  return (lodMat ||= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.36, metalness: 0.05, envMapIntensity: 0.8 })); // لامع زي دهان العربيات الحقيقية (كانت مطفية = لون مختلف لما تقرب)
}

// القطع اللي بتدخل في الـ LOD (بنفس الترتيب دايمًا) + لون كل قطعة
function lodParts(root, fn) {
  root.traverse((o) => {
    if (!o.isMesh || o.userData.role === 'shadow' || o.isInstancedMesh || o.isSkinnedMesh && !o.geometry) return;
    // مخفي عن قصد (قطع اتشالت/اتبدلت) — بس العجل بتتحسب حتى لو مخفية عشان المسافة
    for (let p = o; p && p !== root; p = p.parent) if (!p.visible && !p.userData?.lodKeep) return;
    // جسم بأكتر من خامة (زي السيدان: دهان + إزاز): كل جزء بلون خامته (كان بياخد أول خامة بس → عربية من غير شبابيك)
    const multi = Array.isArray(o.material) && o.geometry.groups.length;
    const list = multi ? o.geometry.groups.map((gr) => [o.material[gr.materialIndex], gr]) : [[Array.isArray(o.material) ? o.material[0] : o.material, null]];
    for (const [mat, grp] of list) {
      if (!mat || mat.visible === false) continue;
      const role = o.userData.role;
      const glass = role === 'glass' || /glass|gls/i.test(mat.name || '') || (mat.transparent && mat.opacity < 0.7 && !mat.map) || (multi && mat.metalness >= 0.5 && mat.roughness < 0.2 && !mat.map);
      if (mat.transparent && !glass && (mat.opacity ?? 1) < 0.3) continue; // ملصقات شبه شفافة
      fn(o, mat, glass, grp);
    }
  });
}

/** جزء واحد (group) من الهندسة كـ geometry لوحده (non-indexed) */
function groupGeometry(src, grp) {
  const out = new THREE.BufferGeometry();
  const idx = src.index, n = grp.count;
  for (const [name, a] of Object.entries(src.attributes)) {
    const arr = new Float32Array(n * a.itemSize);
    for (let i = 0; i < n; i++) {
      const v = idx ? idx.getX(grp.start + i) : grp.start + i;
      for (let d = 0; d < a.itemSize; d++) arr[i * a.itemSize + d] = a.getComponent(v, d);
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  return out;
}

const _lum = new THREE.Color();
function partColor(mat, glass, out) {
  // اللون: لون الخامة × متوسط الصورة
  if (glass) return out.setRGB(0.06, 0.08, 0.09);
  out.copy(mat.color || out.setRGB(1, 1, 1));
  const a = averageColor(mat.map);
  if (a) out.multiply(a);
  if (mat.emissive && mat.emissiveIntensity > 0.5 && !mat.map) out.lerp(mat.emissive, 0.3);
  // دهان السيدان (شيدر بشرايط وتغميق تحت): متوسطه أغمق وأقل تشبّع من لونه الأساسي (مقاس بالكاميرا: نفس المكان والإضاءة، جسم العربية بس من غير الضل اللي تحتها)
  if (mat.userData?.U?.uStripes) { const l = out.r * 0.3 + out.g * 0.59 + out.b * 0.11; out.lerp(_lum.setRGB(l, l, l), 0.25).multiplyScalar(0.85); }
  return out;
}

/**
 * الشكل بيتخبز مرة واحدة لكل نوع عربية (key الشكل من غير الألوان): geometry واحدة + رقم القطعة لكل رأس.
 * كل لون جديد = بس مصفوفة ألوان جديدة (لفة واحدة على الرؤوس) على نفس الـ position/normal/index (متشاركين على كارت الشاشة).
 * (كانت كل عربية بلون مختلف بتتخبز وتتبسط من الأول: ~50 مرة وقت التحميل = 1.4 ث)
 */
export function bakeLod(root, key, shapeKey = key) {
  if (cache.has(key)) return cache.get(key);
  const t0 = performance.now();
  let shape = cache.get('shape:' + shapeKey);
  if (shape === undefined) {
    lodStats.shapes++;
    root.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const parts = [], glassParts = [];
    const m = new THREE.Matrix4();
    let pid = 0;
    lodParts(root, (o, mat, glass, grp) => {
      let g = grp ? groupGeometry(o.geometry, grp) : o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k);
      if (!g.attributes.normal) g.computeVertexNormals();
      m.multiplyMatrices(inv, o.matrixWorld);
      g.applyMatrix4(m);
      // الإزاز لازق في الجسم: بعد التبسيط كان بيتبلع جوه الدهان (عربية من غير شبابيك من بعيد) → نطلّعه 3 سم لبرا
      if (glass) { const P = g.attributes.position, N = g.attributes.normal; for (let i = 0; i < P.count; i++) P.setXYZ(i, P.getX(i) + N.getX(i) * 0.03, P.getY(i) + N.getY(i) * 0.03, P.getZ(i) + N.getZ(i) * 0.03); }
      const n = g.attributes.position.count;
      // base = لون الرؤوس الأصلي (لو موجود) — بيتضرب في لون القطعة بعدين؛ pid = رقم القطعة
      const base = new Float32Array(n * 3).fill(1);
      if (g.attributes.color && !glass) { const src = g.attributes.color; for (let i = 0; i < n; i++) { base[i * 3] = src.getX(i); base[i * 3 + 1] = src.getY(i); base[i * 3 + 2] = src.getZ(i); } }
      g.deleteAttribute('color');
      g.setAttribute('color', new THREE.BufferAttribute(base, 3));
      g.setAttribute('pid', new THREE.BufferAttribute(new Float32Array(n).fill(pid++), 1));
      (glass ? glassParts : parts).push(g);
    });
    // الإزاز والجسم كل واحد بيتبسط لوحده: لو مع بعض، رؤوس الإزاز اللي لازقة في الجسم بتتدمج معاه = عربية من غير شبابيك
    const simplify = (list) => {
      if (!list.length) return null;
      let geo = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      // نفس الرؤوس المكررة (من التحويل لـ non-indexed) بتتدمج → ذاكرة أقل بحوالي 3 مرات
      const ix = mergeVertices(geo, 1e-4); geo.dispose(); geo = ix;
      // تبسيط سريع (vertex clustering): الرؤوس اللي في نفس خانة 11سم بتبقى رأس واحد، والمثلثات اللي اتقفلت بتتشال.
      // الـ LOD بيتشاف من 30م وأبعد → التفاصيل الأصغر من 11سم مش باينة أصلًا (المثلثات بتقل للنص أو أكتر)
      const sg = clusterSimplify(geo, 0.11); geo.dispose(); return sg;
    };
    const body = simplify(parts), gls = simplify(glassParts);
    // groups: 0 = الجسم، 1 = الإزاز (خامة غامقة لوحدها — مع الدهان اللامع كان بيبان رمادي فاتح)
    let geo = body && gls ? mergeGeometries([body, gls], true) : body || gls;
    if (body && gls) { body.dispose(); gls.dispose(); }
    if (geo) geo.computeBoundingSphere();
    shape = geo ? { geo, nParts: pid } : null;
    cache.set('shape:' + shapeKey, shape);
  }
  if (!shape) { cache.set(key, null); return null; }
  // ألوان القطع للعربية دي (نفس ترتيب الخَبز)
  const cols = []; const c = new THREE.Color();
  lodParts(root, (o, mat, glass) => { partColor(mat, glass, c); cols.push(c.r, c.g, c.b); });
  const S = shape.geo, base = S.attributes.color.array, pidA = S.attributes.pid.array, n = pidA.length;
  const carr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const k = pidA[i] * 3; carr[i * 3] = base[i * 3] * (cols[k] ?? 1); carr[i * 3 + 1] = base[i * 3 + 1] * (cols[k + 1] ?? 1); carr[i * 3 + 2] = base[i * 3 + 2] * (cols[k + 2] ?? 1); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', S.attributes.position); geo.setAttribute('normal', S.attributes.normal);
  geo.setIndex(S.index);
  geo.setAttribute('color', new THREE.BufferAttribute(carr, 3));
  geo.boundingSphere = S.boundingSphere; geo.boundingBox = S.boundingBox;
  for (const gr of S.groups) geo.addGroup(gr.start, gr.count, gr.materialIndex);
  cache.set(key, geo);
  lodStats.variants++; lodStats.ms += performance.now() - t0;
  return geo;
}

function clusterSimplify(geo, cell) {
  const P = geo.attributes.position, N = geo.attributes.normal, C = geo.attributes.color, D = geo.attributes.pid, I = geo.index;
  const map = new Int32Array(P.count), keys = new Map();
  const pos = [], nor = [], col = [], pid = [];
  for (let i = 0; i < P.count; i++) {
    // الـ normal جزء من المفتاح (مقرّب): الأوش المختلفة الاتجاه ماتتدمجش (عشان الإضاءة تفضل صح)
    const k = Math.round(P.getX(i) / cell) + ',' + Math.round(P.getY(i) / cell) + ',' + Math.round(P.getZ(i) / cell) + ',' +
      Math.round(N.getX(i) * 2) + Math.round(N.getY(i) * 2) * 5 + Math.round(N.getZ(i) * 2) * 25;
    let j = keys.get(k);
    if (j === undefined) {
      j = pos.length / 3; keys.set(k, j);
      pos.push(P.getX(i), P.getY(i), P.getZ(i)); nor.push(N.getX(i), N.getY(i), N.getZ(i)); col.push(C.getX(i), C.getY(i), C.getZ(i)); if (D) pid.push(D.getX(i));
    }
    map[i] = j;
  }
  const src = I ? I.array : null, n = I ? I.count : P.count, idx = [];
  for (let t = 0; t < n; t += 3) {
    const a = map[src ? src[t] : t], b = map[src ? src[t + 1] : t + 1], c = map[src ? src[t + 2] : t + 2];
    if (a !== b && b !== c && a !== c) idx.push(a, b, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  if (D) g.setAttribute('pid', new THREE.Float32BufferAttribute(pid, 1));
  g.setIndex(idx);
  return g;
}

/** Mesh الـ LOD لعربية (بتتحط في المشهد جنب العربية الكاملة) */
export function makeLodMesh(root) {
  // مفتاح التخزين: نفس القطع + نفس الألوان/الصور = نفس الـ geometry (حتى لو الخامة نسخة منفصلة)
  // مفتاح الشكل = محتوى الهندسة نفسه (عدد الرؤوس + الصندوق + مكان القطعة جوه العربية لأقرب سم):
  // كل عربية بتعمل geometries بتاعتها (uuid مختلف) فالـ uuid عمره ما بيتكرر
  root.updateMatrixWorld(true);
  const inv = _inv.copy(root.matrixWorld).invert();
  const sig = [], shp = [];
  root.traverse((o) => {
    if (!o.isMesh || o.userData.role === 'shadow') return;
    const mt = Array.isArray(o.material) ? o.material[0] : o.material, g = o.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    const b = g.boundingBox, e = _m.multiplyMatrices(inv, o.matrixWorld).elements, r = (v) => Math.round(v * 100);
    let vis = ''; for (let q = o; q && q !== root; q = q.parent) if (!q.visible) { vis = 'h'; break; }
    const k = `${g.attributes.position.count}:${g.index?.count || 0}:${r(b.min.x)},${r(b.min.y)},${r(b.min.z)},${r(b.max.x)},${r(b.max.y)},${r(b.max.z)}:${e.map(r).join(',')}${vis}`;
    shp.push(k);
    sig.push(k + (mt?.color?.getHexString() || '') + (mt?.map?.uuid.slice(0, 6) || '') + (mt?.transparent ? 't' + mt.opacity : ''));
  });
  const geo = bakeLod(root, sig.join('|'), shp.join('|'));
  if (!geo) return null;
  const mesh = new THREE.Mesh(geo, geo.groups.length ? lodMaterials() : lodMaterial());
  mesh.name = 'traffic-lod';
  mesh.matrixAutoUpdate = true;
  // نفس الضل والإضاءة زي العربية الحقيقية: الضل اللي تحتها + ضل العمارات عليها (من غيرهم كانت بتبان أفتح ولونها "بيتغير" لما تقرب)
  mesh.receiveShadow = true;
  root.traverse((o) => { if (o.isMesh && o.userData.role === 'shadow' && !mesh.userData.blob) { const b = new THREE.Mesh(o.geometry, o.material); _inv.copy(root.matrixWorld).invert(); b.applyMatrix4(_m.multiplyMatrices(_inv, o.matrixWorld)); b.renderOrder = o.renderOrder; mesh.add(b); mesh.userData.blob = b; } });
  mesh.visible = false;
  return mesh;
}
