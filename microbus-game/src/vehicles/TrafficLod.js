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
export function lodMaterial() {
  return (lodMat ||= new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.1 }));
}

/**
 * بيخبز rig عربية لـ geometry واحدة (في إحداثيات root). key = نوع+لون للتخزين.
 * العناصر اللي userData.role بتاعها shadow (ضل التلامس) بتفضل برا (هي أصلًا رخيصة ومنفصلة).
 */
export function bakeLod(root, key) {
  if (cache.has(key)) return cache.get(key);
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const parts = [];
  const m = new THREE.Matrix4();
  const col = new THREE.Color();
  root.traverse((o) => {
    if (!o.isMesh || o.userData.role === 'shadow' || o.isInstancedMesh || o.isSkinnedMesh && !o.geometry) return;
    // مخفي عن قصد (قطع اتشالت/اتبدلت) — بس العجل بتتحسب حتى لو مخفية عشان المسافة
    let hidden = false; for (let p = o; p && p !== root; p = p.parent) if (!p.visible && !p.userData?.lodKeep) { hidden = true; break; }
    if (hidden) return;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!mat || mat.visible === false) return;
    const role = o.userData.role;
    const glass = role === 'glass' || /glass|gls/i.test(mat.name || '') || (mat.transparent && mat.opacity < 0.7 && !mat.map);
    if (mat.transparent && !glass && (mat.opacity ?? 1) < 0.3) return; // ملصقات شبه شفافة
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    m.multiplyMatrices(inv, o.matrixWorld);
    g.applyMatrix4(m);
    // اللون: لون الخامة × متوسط الصورة (أو اللون اللي على الرؤوس لو موجود)
    if (glass) col.setRGB(0.06, 0.08, 0.09);
    else {
      col.copy(mat.color || col.setRGB(1, 1, 1));
      const a = averageColor(mat.map);
      if (a) col.multiply(a);
      if (mat.emissive && mat.emissiveIntensity > 0.5 && !mat.map) col.lerp(mat.emissive, 0.3);
    }
    const n = g.attributes.position.count;
    let carr;
    if (g.attributes.color && !glass) {
      const src = g.attributes.color; carr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { carr[i * 3] = src.getX(i) * col.r; carr[i * 3 + 1] = src.getY(i) * col.g; carr[i * 3 + 2] = src.getZ(i) * col.b; }
    } else { carr = new Float32Array(n * 3); for (let i = 0; i < n; i++) { carr[i * 3] = col.r; carr[i * 3 + 1] = col.g; carr[i * 3 + 2] = col.b; } }
    g.setAttribute('color', new THREE.BufferAttribute(carr, 3));
    parts.push(g);
  });
  let geo = parts.length ? mergeGeometries(parts, false) : null;
  for (const g of parts) g.dispose();
  // نفس الرؤوس المكررة (من التحويل لـ non-indexed) بتتدمج → ذاكرة أقل بحوالي 3 مرات
  if (geo) { const ix = mergeVertices(geo, 1e-4); geo.dispose(); geo = ix; }
  if (geo) geo.computeBoundingSphere();
  cache.set(key, geo);
  return geo;
}

/** Mesh الـ LOD لعربية (بتتحط في المشهد جنب العربية الكاملة) */
export function makeLodMesh(root) {
  // مفتاح التخزين: نفس القطع + نفس الألوان/الصور = نفس الـ geometry (حتى لو الخامة نسخة منفصلة)
  const sig = [];
  root.traverse((o) => { if (o.isMesh && o.userData.role !== 'shadow') { const mt = Array.isArray(o.material) ? o.material[0] : o.material; sig.push(o.geometry.uuid.slice(0, 8) + (mt?.color?.getHexString() || '') + (mt?.map?.uuid.slice(0, 6) || '')); } });
  const key = sig.join('|');
  const geo = bakeLod(root, key);
  if (!geo) return null;
  const mesh = new THREE.Mesh(geo, lodMaterial());
  mesh.name = 'traffic-lod';
  mesh.matrixAutoUpdate = true;
  mesh.visible = false;
  return mesh;
}
