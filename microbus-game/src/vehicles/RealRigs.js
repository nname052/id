// =====================================================================
//  عربيات اللاعب من الموديلات الحقيقية (CC BY — CREDITS.md): ملاكي، ربع نقل، نقل خفيف، أتوبيس.
//  - المقاس (فرق العجل، العرض، نص القطر) بيتقاس من الموديل نفسه → الفيزياء على قد الشكل بالظبط
//  - الكابينة: مكان الزجاج الأمامي بيتقاس من مثلثات الزجاج في الموديل، وعليه بيتبني التابلوه والدركسيون والكراسي
//    على قد نوع العربية (ملاكي واطي بدركسيون مايل، نقل/أتوبيس عالي بدركسيون شبه نايم وزجاج كبير)
//  - جوه الموديل في منطقة السواق بيتشال (عشان مايبقاش فيه تابلوهين/دركسيونين)، والصاج بيترسم من الناحيتين
//  بيرجّع rig بنفس شكل rig التاكسي (PlayerVehicle/الكاميرا/المرايات/الركاب بيشتغلوا عليه زي ما هما)
// =====================================================================
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { toFloat, findWheelsGeo, cutWheels } from './ModelFit.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { contactShadow } from './CarModels.js';
import { mats as cockpitMats, extrudeAcross, DashScreen, beam } from './Cockpits.js';
import { mirrorFace, fakeDoor } from './PlayerRigs.js';
import { addBobbleDog } from './CabAccessories.js';
import { CAR_SPEC_BASE, PICKUP_SPEC_BASE, TRUCK_SPEC_BASE, BUS_SPEC_BASE } from '../physics/VehiclePhysics.js';

const M4 = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(
  new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(1, 1, 1));

// لكل نوع: الموديل، لون الصاج، الفيزياء، ومقاسات قعدة السواق (بالمتر، من الزجاج الأمامي)
//  eyeBack: عين السواق ورا حافة الزجاج اللي فوق · eyeAbove: العين فوق حافة الزجاج اللي تحت (الحد الأقصى)
//  wheelR / wheelTilt: الدركسيون (الملاكي مايل لقدام، النقل والأتوبيس شبه نايم) · reach/drop: مكانه من العين
export const REAL_KINDS = {
  car: { r: 0.29, model: 'car_logan', paint: 0xc9cbcc, base: CAR_SPEC_BASE, cgFrac: 0.42, eyeBack: 0.2, eyeAbove: 0.3, headroom: 0.16, floorBelow: 0.8,
    wheelR: 0.185, wheelTilt: -1.12, reach: 0.42, drop: 0.25, dashDist: 0.6, style: 'car', mode: 'free', label: 'ملاكي', mirrorIn: true },
  pickup: { r: 0.36, model: 'pickup_90s', paint: 0xe9e7e0, base: PICKUP_SPEC_BASE, cgFrac: 0.45, eyeBack: 0.22, eyeAbove: 0.26, headroom: 0.15, floorBelow: 0.84,
    wheelR: 0.19, wheelTilt: -1.05, reach: 0.42, drop: 0.27, dashDist: 0.58, style: 'car', mode: 'free', label: 'ربع نقل', mirrorIn: true },
  truck: { r: 0.36, model: 'truck_canter', paint: undefined, base: TRUCK_SPEC_BASE, cgFrac: 0.38, eyeBack: 0.62, eyeAbove: 0.5, headroom: 0.2, floorBelow: 1.15,
    wheelR: 0.22, wheelTilt: -0.6, reach: 0.4, drop: 0.36, dashDist: 0.62, style: 'truck', mode: 'free', label: 'نقل', mirrorIn: false },
  bus: { r: 0.5, model: 'bus_karosa', paint: undefined, base: BUS_SPEC_BASE, cgFrac: 0.62, eyeBack: 0.72, eyeAbove: 0.55, headroom: 0.25, floorBelow: 1.2,
    wheelR: 0.25, wheelTilt: -0.45, reach: 0.42, drop: 0.38, dashDist: 0.75, style: 'bus', mode: 'line', label: 'أتوبيس', mirrorIn: false },
};

function baseRig(spec) {
  const root = new THREE.Group(), body = new THREE.Group(), shell = new THREE.Group();
  root.add(body); body.add(shell);
  shell.position.y = -spec.cgHeight;
  return { root, body, shell, wheels: [], mirrors: [], hangers: [], mats: {} };
}

const PAINT_RE = /paint|body|carpaint|kuzov|кузов/i;
// كاميرا كرسي السواق شغالة؟ (CameraSystem بيظبطه). الصاج الخارجي من جوه (الوش الخلفي للمثلثات) بيترسم رمادي غامق
// زي كسوة العواميد والأبواب بدل لون العربية المكسّر — ومن برا مفيش أي تغيير
export const COCKPIT_VIEW = { value: 0 };
function insideTrim(mat) {
  if (mat.userData.insideTrim) return;
  mat.userData.insideTrim = true;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    sh.uniforms.uCockpitView = COCKPIT_VIEW;
    // (والعواميد اللي مثلثاتها متلفّة لجوه: أي صاج أقرب من 90سم لعين السواق = جوه الكابينة)
    // لازم كمان نشيل المعدني والورنيش (clearcoat) — من غيرهم الصاج الغامق كان بيعكس السما وبيفضل باين فضي
    sh.fragmentShader = 'uniform float uCockpitView;\n' + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
  bool inTrim = uCockpitView > 0.5 && (!gl_FrontFacing || length(vViewPosition) < 0.9);
  if (inTrim) diffuseColor.rgb = vec3(0.075, 0.075, 0.08);`)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n  if (inTrim) metalnessFactor = 0.0;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  if (inTrim) roughnessFactor = 0.85;')
      .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\n  if (inTrim) material.clearcoat = 0.0;\n#endif');
  };
  const key = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => (key ? key() : '') + '|insideTrim';
}

/** يمسح المثلثات اللي مركزها جوه الصندوق (geometry مش indexed) */
function clipBox(g, box) {
  const P = g.attributes.position, keep = [];
  for (let i = 0; i < P.count; i += 3) {
    const x = (P.getX(i) + P.getX(i + 1) + P.getX(i + 2)) / 3, y = (P.getY(i) + P.getY(i + 1) + P.getY(i + 2)) / 3, z = (P.getZ(i) + P.getZ(i + 1) + P.getZ(i + 2)) / 3;
    if (!(x > box.min.x && x < box.max.x && y > box.min.y && y < box.max.y && z > box.min.z && z < box.max.z)) keep.push(i);
  }
  if (keep.length * 3 === P.count) return g;
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(g.attributes)) {
    const A = g.attributes[name], sz = A.itemSize, arr = new Float32Array(keep.length * 3 * sz);
    keep.forEach((i, k) => { for (let j = 0; j < 3 * sz; j++) arr[k * 3 * sz + j] = A.array[i * sz + j]; });
    out.setAttribute(name, new THREE.BufferAttribute(arr, sz));
  }
  return out;
}

/** العداد الأنالوج (سرعة + لفات) — بيترسم على canvas */
function drawDials(x, W, H, s) {
  x.fillStyle = '#0b0c0e'; x.fillRect(0, 0, W, H);
  const dial = (cx, val, max, step, label) => {
    const r = H * 0.42, cy = H * 0.52, a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    x.strokeStyle = '#d8d8d0'; x.lineWidth = 3; x.beginPath(); x.arc(cx, cy, r, a0, a1); x.stroke();
    x.fillStyle = '#e8e8e0'; x.font = `bold ${Math.round(H * 0.09)}px sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
    for (let v = 0; v <= max; v += step) {
      const a = a0 + (a1 - a0) * (v / max);
      x.beginPath(); x.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); x.lineTo(cx + Math.cos(a) * (r - 10), cy + Math.sin(a) * (r - 10)); x.stroke();
      x.fillText(String(label(v)), cx + Math.cos(a) * (r - 24), cy + Math.sin(a) * (r - 24));
    }
    const a = a0 + (a1 - a0) * Math.min(1, Math.max(0, val / max));
    x.strokeStyle = '#ff5a1f'; x.lineWidth = 5; x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.cos(a) * (r - 6), cy + Math.sin(a) * (r - 6)); x.stroke();
    x.fillStyle = '#222'; x.beginPath(); x.arc(cx, cy, 9, 0, Math.PI * 2); x.fill();
  };
  dial(W * 0.27, s.kmh, s.vmax, s.vmax > 140 ? 20 : 10, (v) => v);
  dial(W * 0.73, s.rpm, s.rmax, 1000, (v) => v / 1000);
  x.fillStyle = s.hb ? '#ff3b30' : '#331010'; x.fillRect(W * 0.47, H * 0.8, W * 0.06, H * 0.08);
  x.fillStyle = s.lights ? '#3aa0ff' : '#0d1a2a'; x.fillRect(W * 0.47, H * 0.12, W * 0.06, H * 0.08);
  x.fillStyle = '#ffd34d'; x.font = `bold ${Math.round(H * 0.13)}px sans-serif`; x.fillText(s.gear, W * 0.5, H * 0.5);
}

// موديلات الملاكي اللي تتختار من الجراج (نص قطر الكاوتش الحقيقي لكل واحدة)
export const CAR_MODELS = {
  car_logan: { r: 0.29, label: 'رينو لوجان' },
  car_lada: { r: 0.28, label: 'لادا 2101' },
  car_corolla_ke80: { r: 0.28, label: 'كورولا 80' },
  car_corolla_e70: { r: 0.28, label: 'كورولا 70' },
};

/** null لو الموديل مش موجود. opts.model / opts.paint: موديل الملاكي ولون الصاج (من الجراج) */
export function buildRealRig(kind, assets, opts = {}) {
  let C = REAL_KINDS[kind];
  if (C && kind === 'car' && CAR_MODELS[opts.model]) C = { ...C, model: opts.model, r: CAR_MODELS[opts.model].r, glassEst: !!CAR_MODELS[opts.model].glassEst };
  if (C && opts.paint !== undefined) C = { ...C, paint: opts.paint };
  const asset = C && assets?.get(C.model);
  if (!asset) return null;
  // ===== كل مثلثات الموديل (بإحداثياته بعد التحجيم)، متجمعة بالخامة =====
  const h = asset.holder; h.updateMatrixWorld(true);
  const byMat = new Map();
  h.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    const g = toFloat(o.geometry).applyMatrix4(o.matrixWorld);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!byMat.has(o.material)) byMat.set(o.material, []);
    byMat.get(o.material).push(g);
  });
  let parts = [...byMat].map(([mat, gs]) => ({ g: mergeGeometries(gs), mat, glass: (mat.transparent && mat.opacity < 0.6) || /glass|window|стекл/i.test(mat.name || '') })); // (الفوانيس شفافة شوية بس مش زجاج)
  // ===== العجل من الشكل نفسه (أغلب الموديلات العجل فيها مخبوز في الجسم — ModelFit.findWheelsGeo) =====
  const F = findWheelsGeo(parts);
  if (!F) return null;
  const [FL, FR, RL, RR] = F.W, minY = F.minY, r = C.r;
  const zF = (FL.z + FR.z) / 2, zR = (RL.z + RR.z) / 2, xMid = (FL.x + FR.x) / 2;
  const track = FR.x - FL.x;
  const wheelBase = zR - zF, cgToFront = wheelBase * C.cgFrac;
  // من إحداثيات الموديل → الـ shell (الأرض y=0، مركز الثقل z=0، القدام -z)
  const off = new THREE.Vector3(-xMid, -minY, -zF - cgToFront);
  for (const p of parts) p.g.translate(off.x, off.y, off.z);
  // المثلثات اللي جوه أسطوانة كل عجلة → بتتشال من الجسم وتبقى العجلة اللي بتلف
  const W4 = F.W.map((w) => ({ ...w, x: w.x + off.x, z: w.z + off.z }));
  cutWheels(parts, W4, r, r);
  const bb = new THREE.Box3();
  for (const p of parts) { p.g.computeBoundingBox(); bb.union(p.g.boundingBox); }
  const HW = Math.max(-bb.min.x, bb.max.x), frontZ = bb.min.z, rearZ = bb.max.z;
  const spec = {
    ...C.base, wheelBase, cgToFront, track, wheelRadius: r,
    halfWidth: HW - 0.02, halfLength: (rearZ - frontZ) / 2, boxOffset: -(rearZ + frontZ) / 2, roofHeight: bb.max.y,
  };
  const rig = baseRig(spec);
  // ===== الجسم: خامات خاصة باللاعب (من الناحيتين)، والصاج بلون العربية =====
  const own = new Map();
  const ownMat = (m) => {
    if (!own.has(m)) {
      const c = m.clone(); c.side = THREE.DoubleSide;
      // خامة الصالون (جوه العربية — "Salon" بالروسي) في بعض الموديلات بيضا ومن غير صورة: كسوة رمادي غامق زي الحقيقة
      if (/salon|interior|inter_/i.test(m.name || '')) c.color.multiplyScalar(0.22);
      if (C.paint !== undefined && PAINT_RE.test(m.name || '')) { c.color = new THREE.Color(C.paint); c.map = null; rig.mats.paint = c; }
      own.set(m, c);
    }
    return own.get(m);
  };
  const bodyMeshes = [];
  for (const p of parts) {
    if (!p.g.attributes.position.count) continue;
    const m = new THREE.Mesh(p.g, ownMat(p.mat));
    if (!p.glass) insideTrim(m.material);
    if (p.glass) { m.userData.role = 'glass'; m.renderOrder = 2; const gm = m.material; gm.depthWrite = false; if (!gm.transparent || gm.opacity > 0.5) { gm.transparent = true; gm.opacity = 0.28; gm.map = null; gm.color.set(0x8fa3ad); gm.roughness = 0.05; } } else m.castShadow = true;
    m.receiveShadow = true;
    rig.shell.add(m); bodyMeshes.push(m);
  }
  // موديل خامته كلها صورة واحدة (مفيش خامة صاج منفصلة): لون الجراج بيتضرب في الصورة على أكبر خامة
  if (!rig.mats.paint && C.paint !== undefined && kind === 'car') {
    const big = bodyMeshes.filter((m) => m.userData.role !== 'glass').sort((a, b) => b.geometry.attributes.position.count - a.geometry.attributes.position.count)[0];
    if (big) { big.material.color = new THREE.Color(C.paint).lerp(new THREE.Color(0xffffff), 0.25); rig.mats.paint = big.material; }
  }
  // ===== العجل: بنفس ترتيب عجل الفيزياء (FL, FR, RL, RR) =====
  rig.wheels = W4.map((w) => {
    const group = new THREE.Group(), spin = new THREE.Group(); group.add(spin);
    group.position.set(w.x, r, w.z);
    for (const q of w.parts) { const mm = new THREE.Mesh(q.g, ownMat(q.mat)); mm.castShadow = true; spin.add(mm); }
    rig.root.add(group);
    return { group, spin, front: w.front, id: w.id };
  });
  // (الفيزياء: العجل في مكانها الحقيقي في الموديل — مزدوج ورا للنقل/الأتوبيس بيتحسب عجلة واحدة)
  spec.track = (Math.abs(W4[0].x) + Math.abs(W4[1].x));
  // ===== الزجاج الأمامي (من مثلثات الزجاج اللي وشها لقدام) =====
  let ws = null;
  {
    const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    const zMid = (frontZ + rearZ) / 2, cand = [];
    for (const m of bodyMeshes) {
      if (m.userData.role !== 'glass') continue;
      const P = m.geometry.attributes.position;
      for (let i = 0; i < P.count; i += 3) {
        for (let k = 0; k < 3; k++) v[k].fromBufferAttribute(P, i + k);
        n.crossVectors(e1.subVectors(v[1], v[0]), e2.subVectors(v[2], v[0])); const A = n.length(); if (A < 1e-6) continue; n.divideScalar(A);
        const cz = (v[0].z + v[1].z + v[2].z) / 3, cx = (v[0].x + v[1].x + v[2].x) / 3;
        const cy = (v[0].y + v[1].y + v[2].y) / 3;
        // (الفوانيس زجاج برضه بس تحت: الزجاج الأمامي فوق نص ارتفاع العربية تقريبًا)
        if (cz > zMid || cy < bb.max.y * (C.style === 'car' ? 0.48 : 0.42) || Math.abs(n.y) > 0.9 || Math.abs(cx) > HW * 0.75) continue;
        if (n.z > -0.45) continue; // وشه لقدام (الزجاج الخلفي وشه لورا)
        if (C.style === 'car' && Math.abs(n.y) < 0.3) continue; // زجاج الملاكي مايل لورا (الفوانيس رأسية)
        cand.push(v.map((p) => [p.y, p.z]));
      }
    }
    // (أوطى/أعلى 5% بيتشالوا: حتت زجاج صغيرة شاردة)
    const pts = cand.flat().sort((a, b) => a[0] - b[0]);
    if (pts.length >= 6) {
      const lo = pts[Math.floor(pts.length * 0.05)], hi = pts[Math.min(pts.length - 1, Math.floor(pts.length * 0.97))];
      ws = { yMin: lo[0], zAtMin: lo[1], yMax: hi[0], zAtMax: hi[1] };
    }
  }
  // (موديل من غير زجاج متعلّم: تقدير من نسب الجسم)
  if (C.glassEst) ws = null;
  const noGlass = !ws || ws.yMax - ws.yMin < 0.2;
  if (noGlass) {
    const H = bb.max.y;
    ws = C.style === 'car' ? { yMin: H * 0.62, zAtMin: frontZ + (rearZ - frontZ) * 0.3, yMax: H * 0.9, zAtMax: frontZ + (rearZ - frontZ) * 0.45 }
      : { yMin: H * 0.55, zAtMin: frontZ + 0.15, yMax: H * 0.88, zAtMax: frontZ + 0.25 };
  }
  rig.windshield = ws;
  // ===== قعدة السواق =====
  const cabHW = HW - (C.style === 'car' ? 0.14 : 0.12);
  const eye = new THREE.Vector3(-cabHW * (C.style === 'bus' ? 0.62 : 0.5), Math.min(ws.yMax - C.headroom, ws.yMin + C.eyeAbove + (C.style === 'car' ? 0 : 0.1)), ws.zAtMax + C.eyeBack);
  if (C.style !== 'car') eye.y = Math.max(eye.y, ws.yMin + C.eyeAbove);
  const floorY = eye.y - C.floorBelow, dashY = ws.yMin - 0.015, dashBack = eye.z - C.dashDist;
  rig.floorY = floorY;
  // جوه الموديل في منطقة السواق والكرسي اللي جنبه بيتشال (تابلوه/دركسيون/كراسي الموديل)
  const cut = new THREE.Box3(new THREE.Vector3(-cabHW + 0.16, floorY + 0.03, ws.zAtMin + 0.03), new THREE.Vector3(cabHW - 0.16, ws.yMin + 0.4, eye.z + 0.45));
  for (const m of bodyMeshes) if (m.userData.role !== 'glass') { const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry; m.geometry = clipBox(g, cut); }
  // ===== الكابينة =====
  const M = cockpitMats(C.paint ?? 0x9a9a96);
  const g = new THREE.Group(); g.name = `${kind}-cockpit`; rig.shell.add(g);
  const add = (geo, mat, mtx, shadow = false) => { const o = new THREE.Mesh(geo, mat); if (mtx) o.applyMatrix4(mtx); o.receiveShadow = true; o.castShadow = shadow; g.add(o); return o; };
  const W = cabHW * 2;
  if (C.style === 'car') {
    M.dashLow.color.set(0x4a4b4d);
    add(extrudeAcross([[ws.zAtMin - 0.04, dashY], [dashBack + 0.1, dashY + 0.015], [dashBack, dashY - 0.04], [dashBack + 0.02, dashY - 0.32], [dashBack - 0.12, floorY + 0.1], [ws.zAtMin, floorY + 0.12]], W), M.dashTop);
  } else {
    // نقل/أتوبيس: تابلوه عريض مسطح تحت الزجاج الكبير + وش رأسي
    M.dashTop.color.set(0x2c2e31); M.dashLow.color.set(0x3a3c3f);
    add(extrudeAcross([[ws.zAtMin - 0.05, dashY], [dashBack + 0.08, dashY + 0.01], [dashBack, dashY - 0.05], [dashBack + 0.03, floorY + 0.3], [ws.zAtMin, floorY + 0.25]], W), M.dashTop);
    if (C.style === 'bus') add(new RoundedBoxGeometry(0.5, 0.06, 0.45, 2, 0.02), M.dashLow, M4(cabHW - 0.4, dashY - 0.02, dashBack + 0.1)); // درج التذاكر
  }
  // غطا العداد + العداد الأنالوج
  const cw = C.style === 'car' ? 0.34 : 0.4;
  add(extrudeAcross([[dashBack + 0.12, dashY], [dashBack + 0.08, dashY + 0.08], [dashBack + 0.0, dashY + 0.085], [dashBack + 0.0, dashY + 0.07], [dashBack + 0.06, dashY + 0.065], [dashBack + 0.09, dashY]], cw + 0.04, 0.01), M.dashTop, M4(eye.x, 0, 0));
  const dials = new DashScreen(512, 220, drawDials, { fps: 8, emissive: 0.75 });
  add(new THREE.PlaneGeometry(cw, cw * 0.43), dials.mat, M4(eye.x, dashY + 0.035, dashBack + 0.035, -0.32));
  // راديو/تكييف في النص
  add(new RoundedBoxGeometry(0.2, 0.06, 0.03, 2, 0.008), M.trim, M4(0.02, dashY - 0.12, dashBack - 0.005, 0.1));
  for (const vx of [-0.12, 0.16]) add(new RoundedBoxGeometry(0.11, 0.05, 0.02, 2, 0.01), M.vent, M4(vx, dashY - 0.05, dashBack - 0.01, 0.1));
  // الدركسيون
  const tilt = new THREE.Group(); tilt.position.set(eye.x, eye.y - C.drop, eye.z - C.reach); tilt.rotation.x = C.wheelTilt; g.add(tilt);
  const steering = new THREE.Group(); tilt.add(steering);
  steering.add(new THREE.Mesh(new THREE.TorusGeometry(C.wheelR, 0.017, 10, 44), M.leather));
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.05, 16).rotateX(Math.PI / 2), M.leather); hub.position.z = 0.02; steering.add(hub);
  for (const a of C.style === 'car' ? [0, Math.PI] : [Math.PI / 2 * 3, Math.PI / 6, Math.PI * 5 / 6]) {
    const sp = new THREE.Mesh(new RoundedBoxGeometry(C.wheelR - 0.04, 0.03, 0.014, 2, 0.006), M.leather);
    sp.position.set(Math.cos(a) * C.wheelR * 0.52, Math.sin(a) * C.wheelR * 0.52, 0.01); sp.rotation.z = a; steering.add(sp);
  }
  const colL = Math.max(0.2, Math.min(0.6, (eye.z - C.reach) - dashBack + 0.25));
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, colL, 10).rotateX(Math.PI / 2), M.dashTop); col.position.z = -colL / 2 - 0.02; tilt.add(col);
  // الأرضية + تابلوه الأبواب
  const cabRear = C.style === 'bus' ? rearZ - 0.3 : C.style === 'car' && kind === 'car' ? eye.z + 1.5 : eye.z + 0.5;
  add(new THREE.BoxGeometry(W + 0.04, 0.03, cabRear - dashBack + 0.2), M.carpet, M4(0, floorY, (cabRear + dashBack) / 2));
  for (const sx of [-1, 1]) {
    add(new RoundedBoxGeometry(0.05, Math.max(0.2, dashY - floorY - 0.05), Math.min(1.6, cabRear - dashBack), 2, 0.02), M.trim, M4(sx * (cabHW + 0.01), (dashY + floorY) / 2, dashBack + Math.min(1.6, cabRear - dashBack) / 2));
  }
  // الكراسي
  const seat = (x, z, w, y = floorY + 0.36) => {
    add(new RoundedBoxGeometry(w, 0.12, 0.5, 3, 0.05), M.seat, M4(x, y, z), true);
    add(new RoundedBoxGeometry(w, 0.58, 0.11, 3, 0.05), M.seat, M4(x, y + 0.33, z + 0.27, 0.12), true);
    add(new RoundedBoxGeometry(w * 0.55, 0.14, 0.1, 3, 0.04), M.seat, M4(x, y + 0.67, z + 0.31, 0.1));
  };
  const seatZ = eye.z + 0.02, seatY = Math.max(floorY + 0.3, eye.y - 0.8);
  seat(eye.x, seatZ, 0.5, seatY);
  rig.paxSeats = [];
  if (C.style === 'bus') {
    // صفوف كراسي الأتوبيس (2+2 وممر في النص) — من ورا الباب الأمامي لآخر العربية
    const rowY = floorY + 0.42;
    for (let z = ws.zAtMin + 2.2; z < rearZ - 0.8; z += 0.82) for (const x of [-cabHW + 0.27, -cabHW + 0.71, cabHW - 0.71, cabHW - 0.27]) {
      seat(x, z, 0.42, rowY);
      rig.paxSeats.push({ x, y: rowY + 0.02, z });
    }
    rig.paxScale = 1;
    rig.slidingDoor = fakeDoor(new THREE.Vector3(HW, floorY + 0.6, ws.zAtMin + 0.9));
  } else {
    seat(-eye.x, seatZ, kind === 'car' ? 0.5 : 0.55, seatY);
    rig.paxSeats.push({ x: -eye.x, y: seatY + 0.02, z: seatZ });
    if (kind === 'car') { seat(0, seatZ + 0.9, cabHW * 1.7, seatY - 0.02); for (const x of [-0.42, 0, 0.42]) rig.paxSeats.push({ x, y: seatY, z: seatZ + 0.9 }); }
    if (C.style === 'truck') { seat(0, seatZ, 0.4, seatY); rig.paxSeats.push({ x: 0, y: seatY + 0.02, z: seatZ }); } // الكنبة اللي في نص الكابينة
    rig.paxScale = 0.92;
    rig.slidingDoor = fakeDoor(new THREE.Vector3(HW, floorY + 0.5, seatZ));
  }
  // موديل من غير زجاج (الشبابيك فاضية): إطار الزجاج الأمامي (العواميد + الحلق اللي فوق وتحت) + زجاج خفيف
  if (noGlass && !C.glassEst) {
    const fm = new THREE.MeshStandardMaterial({ color: 0xe6e6e2, roughness: 0.5 });
    const zb = ws.zAtMin + 0.02, zt = ws.zAtMax + 0.02, xs = HW - 0.06;
    for (const sx of [-1, 1]) g.add(beam([sx * xs, ws.yMin, zb], [sx * xs, ws.yMax, zt], 0.09, 0.07, fm));
    g.add(beam([-xs, ws.yMax + 0.04, zt], [xs, ws.yMax + 0.04, zt], 0.1, 0.07, fm));
    g.add(beam([-xs, ws.yMin - 0.02, zb], [xs, ws.yMin - 0.02, zb], 0.07, 0.06, fm));
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(xs * 2, Math.hypot(ws.yMax - ws.yMin, zt - zb)), new THREE.MeshStandardMaterial({ color: 0x9fb3bb, transparent: true, opacity: 0.16, roughness: 0.05, depthWrite: false, side: THREE.DoubleSide }));
    glass.position.set(0, (ws.yMin + ws.yMax) / 2, (zb + zt) / 2); glass.rotation.x = -Math.atan2(zt - zb, ws.yMax - ws.yMin); glass.userData.role = 'glass'; glass.renderOrder = 2;
    g.add(glass);
  }
  // الشماسات + بطانة السقف فوق السواق
  const roofIn = Math.min(bb.max.y - 0.07, ws.yMax + 0.05);
  for (const sx of [-1, 1]) add(new RoundedBoxGeometry(0.34, 0.02, 0.16, 2, 0.01), M.headliner, M4(sx * cabHW * 0.5, roofIn - 0.03, ws.zAtMax + 0.1, 0.12));
  // ===== المرايات =====
  const mirrors = [];
  if (C.mirrorIn) {
    const { holder, face } = mirrorFace(0.25, 0.07);
    holder.position.set(0.02, roofIn - 0.1, ws.zAtMax + 0.08);
    const house = new THREE.Mesh(new RoundedBoxGeometry(0.27, 0.085, 0.03, 3, 0.02), M.mirrorBack); house.position.z = -0.018; holder.add(house);
    g.add(holder); mirrors.push({ holder, face, side: 0, aspect: 0.25 / 0.07, fov: 14 });
  }
  const big = C.style !== 'car';
  for (const sx of [-1, 1]) {
    const w = big ? 0.2 : 0.15, h = big ? 0.34 : 0.085;
    const { holder, face } = mirrorFace(w, h);
    holder.position.set(sx * (HW + (big ? 0.2 : 0.05)), big ? ws.yMin + 0.25 : ws.yMin + 0.05, ws.zAtMin + (big ? -0.05 : 0.18));
    const house = new THREE.Mesh(new RoundedBoxGeometry(w + 0.03, h + 0.03, 0.04, 2, 0.01), M.mirrorBack); house.position.z = -0.025; holder.add(house);
    rig.shell.add(holder);
    if (big) { // دراع المراية من جسم العربية
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.24, 6).rotateZ(Math.PI / 2), M.mirrorBack);
      arm.position.set(sx * (HW + 0.08), holder.position.y + h * 0.4, holder.position.z); rig.shell.add(arm);
    }
    mirrors.push({ holder, face, side: sx, aspect: w / h, fov: big ? 30 : 26 });
  }
  rig.mirrors = mirrors;
  // ===== العين والحاجات اللي بتتحرك =====
  const eyeObj = new THREE.Object3D(); eyeObj.position.copy(eye); g.add(eyeObj);
  rig.eye = eyeObj; rig.eyeBase = eye.clone(); rig.eyePitch = C.style === 'car' ? -0.08 : -0.13;
  rig.steering = steering;
  rig.bobbles = C.style === 'car' ? [addBobbleDog(g, 0.25, dashY + 0.01, dashBack + 0.1, 0, 0.75)] : [];
  const st = { kmh: 0, rpm: 0, gear: 'N', hb: false, lights: false, vmax: C.style === 'bus' ? 100 : C.style === 'truck' ? 120 : 180, rmax: Math.ceil(spec.maxRpm / 1000) * 1000 };
  rig.cockpit = {
    update(dt, ph, P) { st.kmh = Math.abs(ph.speed) * 3.6; st.rpm = ph.rpm; st.gear = ph.gearMode === 'D' ? String(ph.gear || 1) : ph.gearMode; st.hb = ph.handbrake > 0.1; st.lights = P.headOn; dials.update(dt, st); },
    setNight(on) { dials.mat.emissiveIntensity = on ? 1 : 0.75; },
  };
  rig.gauges = null;
  // ===== الفوانيس (مكانها بس، للكشافات) + الضل =====
  const lampY = C.style === 'car' ? Math.min(0.75, ws.yMin - 0.2) : Math.min(1.1, ws.yMin - 0.45);
  rig.lamps = { head: [[-HW * 0.72, lampY, frontZ + 0.04], [HW * 0.72, lampY, frontZ + 0.04]], tail: [[-HW * 0.8, lampY, rearZ - 0.04], [HW * 0.8, lampY, rearZ - 0.04]] };
  rig.lights = { head: { set emissiveIntensity(v) {} }, tail: { set emissiveIntensity(v) {} }, fog: null };
  rig.setReverse = () => {};
  const sh = contactShadow(HW * 2 + 0.3, rearZ - frontZ + 0.4); sh.position.z = (rearZ + frontZ) / 2; rig.root.add(sh); rig.contactShadow = sh;
  rig.dims = { HW, frontF: -frontZ, rearF: -rearZ, roofY: bb.max.y };
  rig.kind = kind; rig.real = C.model;
  return { rig, spec };
}
