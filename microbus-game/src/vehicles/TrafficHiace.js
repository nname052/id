import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { contactShadow } from './CarModels.js';
import { replacePlates, rearHalfWidth } from './EgyptPlates.js';

// ميكروباصات المرور بنفس موديل الهاي إس الحقيقي (نسخة منفصلة من الملف، من غير صالون مصري).
// العجل بتلف، وفيه فوانيس فرامل ونور بالليل. الخامات مشتركة بين كل النسخ (أداء).

// ميكروباصات شبين: أغلبها تركواز (زي الصورة الحقيقية) وشوية بيض
// ألوان ميكروباصات مصر: أبيض كتير، بيج/كريمي، لبني، كحلي، فضي، نبيتي، تركواز، زيتوني
const PAINTS = [0xf4f2ee, 0xeeeae0, 0x109f95, 0x0b968b, 0xe3d6b8, 0x8fb7d6, 0x2c4a7a, 0xb9bec4, 0x7a2430, 0xd9c79b, 0x5f6b4a, 0xf4f2ee];
let shared = null;

function prepare(asset) {
  if (shared) return shared;
  const paint = PAINTS.map((c) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.6, clearcoat: 0, envMapIntensity: 0.25, /* (كانت لامعة على الآخر: من بعيد بتعكس السما وتبان بيضا، ولونها الحقيقي يظهر لما تقرب) */ side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
  let lights = null;
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x1c2a2e, transparent: true, opacity: 0.55, roughness: 0.02, envMapIntensity: 2, depthWrite: false, side: THREE.DoubleSide });
  const swap = new Map();
  asset.holder.traverse((o) => {
    if (!o.isMesh) return;
    const n = (o.userData.matName || '').toLowerCase();
    if (n === 'paint') { paint.forEach((p) => { p.map = o.material.map; }); }
    if (n === 'black' && !swap.has(o.material)) { const m = o.material.clone(); m.side = THREE.DoubleSide; m.polygonOffset = true; m.polygonOffsetFactor = 1; m.polygonOffsetUnits = 2; swap.set(o.material, m); }
    if (n === 'lights' && !lights) { lights = o.material.clone(); lights.emissive = new THREE.Color(0xffffff); lights.emissiveMap = lights.map; lights.emissiveIntensity = 0; }
  });
  shared = { paint, lights, glass, swap };
  return shared;
}

export function buildTrafficHiace(asset, R = Math.random) {
  const S = prepare(asset);
  const model = SkeletonUtils.clone(asset.holder);
  const variant = S.paint[Math.floor(R() * S.paint.length)];
  const wheelMeshes = [];
  model.traverse((o) => {
    if (!o.isMesh) return;
    const n = (o.userData.matName || '').toLowerCase();
    if (n === 'logo') o.visible = false; // من غير شعار الماركة (للنشر العام)
    if (n === 'paint') o.material = variant;
    else if (n === 'glass' || n === 'glass2') { o.material = S.glass; o.castShadow = false; o.userData.role = 'glass'; }
    else if (n === 'lights') o.material = S.lights;
    else if (S.swap.has(o.material)) o.material = S.swap.get(o.material);
    if (/wheel|tire/.test(n)) wheelMeshes.push(o);
  });
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  body.add(model);
  model.updateMatrixWorld(true);
  // كل عجلة في pivot على مركزها عشان تلف
  const wheels = [];
  const box = new THREE.Box3();
  for (const m of wheelMeshes) {
    box.setFromObject(m);
    const c = box.getCenter(new THREE.Vector3());
    body.worldToLocal(c);
    const pivot = new THREE.Group();
    pivot.position.copy(c);
    body.add(pivot);
    pivot.updateMatrixWorld(true);
    pivot.attach(m);
    wheels.push({ group: pivot, spin: pivot });
  }
  // فوانيس فرامل (مستطيلات حمرا فوق فوانيس الموديل)
  const bb = new THREE.Box3().setFromObject(model);
  // نور الفرامل: توهّج ناعم (additive) بدل مستطيل أحمر لازق — بيدمج مع فانوس الموديل
  const brake = new THREE.MeshBasicMaterial({ map: glowTex(), color: 0xff2a14, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false });
  Object.defineProperty(brake, 'emissiveIntensity', { set(v) { brake.opacity = Math.min(1, 0.1 + v * 0.26); }, get() { return brake.opacity; } });
  const rw = (shared.rw ||= rearHalfWidth(model, body)); // (مرة واحدة: كل النسخ نفس الموديل)
  for (const sx of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.3), brake);
    p.position.set(sx * (rw.hx - 0.08), 0.82, rw.zMax + 0.006);
    p.userData.role = 'tail';
    body.add(p);
  }
  replacePlates(model, body, Math.floor(R() * 8));
  const sh = contactShadow(bb.max.x - bb.min.x + 0.15, bb.max.z - bb.min.z + 0.15);
  sh.material.opacity = 0.55;
  root.add(sh);
  return {
    root, body, wheels, brake,
    length: bb.max.z - bb.min.z, width: bb.max.x - bb.min.x,
    lights: { head: { set emissiveIntensity(v) { if (S.lights) S.lights.emissiveIntensity = v * 0.35; } } },
    wheelRadius: 0.33,
  };
}

let _glow = null;
function glowTex() {
  if (_glow) return _glow;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,0.7)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  return (_glow = new THREE.CanvasTexture(c));
}
