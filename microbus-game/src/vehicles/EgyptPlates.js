// =====================================================================
//  لوح أرقام مصرية بدل لوح الموديل الأصلي (الهاي إس جاي بلوحة يابانية "品川 303" — مش مكانها في شبين)
//  + أماكن فوانيس الفرامل من جسم العربية الفعلي (مش من الصندوق اللي حوالين المرايات)
// =====================================================================
import * as THREE from 'three';
import { makePlate } from '../render/textures.js';

// لوح نقل/أجرة (ميكروباص) — حروف وأرقام عربي عشوائية، مش لوحة عربية حقيقية بعينها
const LET = ['ن ق ل', 'أ ج ر', 'ق ط ع', 'م ن ف', 'ب ص ر', 'ع ل م', 'م ط ر', 'ن د ل'];
const DIG = '٠١٢٣٤٥٦٧٨٩';
const texCache = [];
function plateTex(i) {
  if (!texCache[i]) {
    let n = ''; let s = (i * 7919 + 13) % 9973;
    for (let k = 0; k < 4; k++) { n += DIG[s % 10]; s = Math.floor(s / 10) + (i + k) * 3; }
    texCache[i] = makePlate(`${LET[i % LET.length]} ${n}`);
  }
  return texCache[i];
}
const plateMats = [];
const plateMat = (i) => (plateMats[i] ||= new THREE.MeshStandardMaterial({ map: plateTex(i), roughness: 0.45, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));

/**
 * بيخبي ميش اللوحة الأصلية (خامة "material" في الهاي إس) وبيحط لوحتين مصريتين مكانهم بالظبط (قدام وورا).
 * parent = الجروب اللي اللوح تتحط فيه (نفس إحداثيات الموديل بعد updateMatrixWorld)
 */
export function replacePlates(model, parent, seed = 0) {
  model.updateMatrixWorld(true); parent.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(parent.matrixWorld).invert();
  const v = new THREE.Vector3();
  let done = 0;
  model.traverse((o) => {
    if (!o.isMesh || (o.userData.matName || '').toLowerCase() !== 'material') return;
    const P = o.geometry.attributes.position, sides = { f: new THREE.Box3(), r: new THREE.Box3() };
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(o.matrixWorld).applyMatrix4(inv);
      (v.z < 0 ? sides.f : sides.r).expandByPoint(v);
    }
    o.visible = false;
    for (const [k, b] of Object.entries(sides)) {
      if (b.isEmpty()) continue;
      const w = Math.max(0.3, b.max.x - b.min.x), h = Math.min(w / 2, Math.max(0.12, b.max.y - b.min.y));
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), plateMat((seed + (k === 'r' ? 1 : 0)) % LET.length));
      m.position.set((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, k === 'f' ? b.min.z - 0.006 : b.max.z + 0.006);
      if (k === 'f') m.rotation.y = Math.PI;
      m.userData.role = 'plate';
      parent.add(m); done++;
    }
  });
  return done;
}

/** نص عرض ضهر العربية الفعلي عند ارتفاع الفوانيس (y0..y1) — من رؤوس الصاج نفسه (من غير المرايات) */
export function rearHalfWidth(model, parent, y0 = 0.6, y1 = 1.1) {
  model.updateMatrixWorld(true); parent.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(parent.matrixWorld).invert();
  const v = new THREE.Vector3();
  let zMax = -Infinity;
  const pts = [];
  model.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    const n = (o.userData.matName || '').toLowerCase();
    if (n !== 'paint' && n !== 'lights') return;
    const P = o.geometry.attributes.position;
    for (let i = 0; i < P.count; i += 1) { v.fromBufferAttribute(P, i).applyMatrix4(o.matrixWorld).applyMatrix4(inv); if (v.y > y0 && v.y < y1) { pts.push(v.x, v.z); if (v.z > zMax) zMax = v.z; } }
  });
  let hx = 0;
  for (let i = 0; i < pts.length; i += 2) if (pts[i + 1] > zMax - 0.12) hx = Math.max(hx, Math.abs(pts[i]));
  return { hx, zMax };
}
