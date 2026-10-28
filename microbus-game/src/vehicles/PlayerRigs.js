import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GeoBuilder } from '../render/GeoBuilder.js';
import { vehicleMaterials } from '../render/materials.js';
import { canvas, tex, makeSeatFabric } from '../render/textures.js';
import { buildCar, contactShadow } from './CarModels.js';
import { buildWheel } from './wheel.js';
import { fitModelToRig, tuktukColors } from './ModelFit.js';
import { buildSedan, SEDAN } from './SedanModel.js';
import { buildTaxiCockpit, buildTuktukCockpit } from './Cockpits.js';
import { addBobbleDog } from './CabAccessories.js';

// عربيات اللاعب التانية (غير الميكروباص): تاكسي وتوكتوك.
// كل واحدة بترجع "rig" بنفس شكل rig الهاي إس عشان PlayerVehicle والكاميرا والمرايات والركاب يشتغلوا عليها:
// { root, body, shell, wheels, eye, eyePitch, mirrors, steering, gauges, lights, dims, contactShadow, paxSeats, slidingDoor }
// الإحداثيات جوه shell: x يمين، y من الأرض، z = -المسافة لقدام (مركز الثقل عند 0)

const M4 = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(
  new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(1, 1, 1));

function baseRig(spec) {
  const root = new THREE.Group(), body = new THREE.Group(), shell = new THREE.Group();
  root.add(body); body.add(shell);
  shell.position.y = -spec.cgHeight;
  return { root, body, shell, wheels: [], mirrors: [], hangers: [], mats: {} };
}

/** باب وهمي للركاب (التاكسي/التوكتوك مفيهمش باب جرار): بيتفتح بسرعة عشان الركوب يمشي */
function fakeDoor(center) {
  return {
    group: null, open: 0, target: 0, center,
    update(dt) { this.open += Math.sign(this.target - this.open) * Math.min(Math.abs(this.target - this.open), dt * 4); },
  };
}

/** يمسح المثلثات اللي مركزها بيحقق شرط (geometry مش indexed أو indexed) */
function clipTris(g, test) {
  if (g.index) { const ng = g.toNonIndexed(); g.copy(ng); }
  const P = g.attributes.position, n = P.count;
  const keep = [];
  for (let i = 0; i < n; i += 3) {
    const x = (P.getX(i) + P.getX(i + 1) + P.getX(i + 2)) / 3, y = (P.getY(i) + P.getY(i + 1) + P.getY(i + 2)) / 3, z = (P.getZ(i) + P.getZ(i + 1) + P.getZ(i + 2)) / 3;
    if (!test(x, y, z)) keep.push(i);
  }
  for (const name of Object.keys(g.attributes)) {
    const A = g.attributes[name], sz = A.itemSize, out = new Float32Array(keep.length * 3 * sz);
    keep.forEach((i, k) => { for (let j = 0; j < 3 * sz; j++) out[k * 3 * sz + j] = A.array[i * sz + j]; });
    g.setAttribute(name, new THREE.BufferAttribute(out, sz));
  }
  g.computeBoundingSphere();
}

function mirrorFace(w, h) {
  const holder = new THREE.Group();
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: 0x223344 }));
  holder.add(face);
  return { holder, face };
}

/** مكان جسم الـ Seal اللي اتظبطت عليه الكابينة والفوانيس (قبل تصليح التحجيم) */
const SEAL_POS_LEGACY = new THREE.Vector3(0, -0.0251, 0.2074);

/** ألوان تاكسي شبين على الـ Seal: أخضر + شريطة صفرا مايلة قدام وورا على الجناب + دايرة سودا على الباب */
function sealShibinLivery(o, shell) {
  shell.updateMatrixWorld(true);
  const M = { value: new THREE.Matrix4().copy(shell.matrixWorld).invert().multiply(o.matrixWorld) };
  const mat = (o.material = o.material.clone());
  mat.color.set(0x19b82a);
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uSM = M;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform mat4 uSM; varying vec3 vSP; varying vec3 vSN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSP = (uSM * vec4(position, 1.0)).xyz; vSN = normalize(mat3(uSM) * normal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vSP; varying vec3 vSN;
float bandL(vec2 p, vec2 a, vec2 b, float w) { vec2 d = normalize(b - a); vec2 n = vec2(-d.y, d.x); float t = dot(p - a, d); return step(abs(dot(p - a, n)), w) * step(0.0, t) * step(t, length(b - a)); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float side = smoothstep(0.35, 0.6, abs(vSN.x));
  vec2 sz = vec2(vSP.z, vSP.y);
  float m = max(bandL(sz, vec2(-0.55, 0.92), vec2(-1.75, 0.3), 0.12), bandL(sz, vec2(1.3, 0.9), vec2(1.95, 0.35), 0.09)) * side;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.96, 0.82, 0.0), m);
  float r = length(sz - vec2(0.05, 0.62));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03), (1.0 - smoothstep(0.1, 0.104, r)) * side);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.8), (1.0 - smoothstep(0.004, 0.008, abs(r - 0.075))) * side * 0.8);
}`);
  };
  mat.customProgramCacheKey = () => 'seal-shibin-1';
  mat.needsUpdate = true;
}

// =====================================================================
//  التاكسي (سيدان أبيض بشريط شطرنج — نفس شكل تاكسي المرور)
// =====================================================================
export function buildTaxiRig(spec, assets = null) {
  // تاكسي شبين الكوم (سيدان BYD F3 بنفس ألوان الصورة) + كابينة سيدان حديثة (الصورة المرجعية)
  const rig = baseRig(spec);
  const car = buildSedan({ livery: 'taxi', lod: 0, seeThrough: true, uniqueMat: true });
  // محاور السيدان متظبطة على الفيزياء (العجل القدام على -cgToFront)
  const shift = -spec.cgToFront - SEDAN.axleF;
  for (const o of [...car.body.children]) { o.position.z += shift; rig.shell.add(o); }
  car.wheels.forEach((w) => { w.group.removeFromParent(); w.group.position.z += shift; rig.root.add(w.group); rig.wheels.push(w); });
  const sh = car.root.children.find((o) => o.userData.role === 'shadow' || o.material?.transparent);
  if (sh) { sh.removeFromParent(); sh.position.z += shift; rig.root.add(sh); rig.contactShadow = sh; }
  const U = car.U;
  rig.mats = { paint: car.paint };
  rig.lights = {
    head: { set emissiveIntensity(v) { U.uHead.value = v > 0.1 ? 1 : 0; } },
    tail: { set emissiveIntensity(v) { U.uBrake.value = v > 2 ? 1 : 0; U.uTail.value = v > 0.5 ? 0.6 : 0.12; } },
    fog: null,
  };
  rig.setReverse = (v) => { U.uRev.value = v; };
  rig.lamps = { head: car.lamps.head.map(([x, y, z]) => [x, y, z + shift]), tail: car.lamps.tail.map(([x, y, z]) => [x, y, z + shift]) };
  const ck = buildTaxiCockpit(rig, { mirrorFace });
  ck.group.position.z += shift;
  for (const mm of ck.mirrors) if (mm.side) mm.holder.position.z += shift;
  rig.steering = ck.steering; rig.mirrors = ck.mirrors; rig.cockpit = ck.cockpit; rig.bobbles = [ck.dog];
  rig.eye = ck.eye; rig.eyePitch = ck.eyePitch; rig.eyeBase = ck.eye.position.clone();
  rig.gauges = null;
  rig.dims = { HW: SEDAN.halfWidth, frontF: -(SEDAN.zFront + shift), rearF: -(SEDAN.zRear + shift), roofY: SEDAN.roof };
  // الركاب: جنب السواق + 3 ورا (الكراسي في الكابينة)
  rig.paxSeats = [{ x: 0.37, y: 0.38, z: -0.05 + shift }, ...[-0.4, 0, 0.4].map((x) => ({ x, y: 0.38, z: 0.86 + shift }))]; rig.paxScale = 0.9; // على قد الكراسي الواطية (السقف واطي)
  rig.slidingDoor = fakeDoor(new THREE.Vector3(SEDAN.halfWidth, 0.8, 0.45 + shift));
  rig.kind = 'taxi';
  rig.root.traverse((o) => { if (o.isMesh && o.userData.role !== 'glass' && o.userData.role !== 'shadow' && !o.material?.transparent) o.castShadow = true; });
  // التاكسي الأبيض الحقيقي (BYD Seal): بيبقى هو الجسم من برا، والسيدان الإجرائي بيستخبى
  const a = assets?.get('car_taxi');
  if (a) {
    const sedanParts = rig.shell.children.filter((o) => o !== ck.group && !ck.mirrors.some((mm) => mm.holder === o));
    if (fitModelToRig(rig, spec, a, { wheelRe: /tyre|tire|rim|disk/i })) {
      for (const o of sedanParts) o.visible = false;
      rig.contactShadow && (rig.contactShadow.visible = true);
      // الكابينة والفوانيس واليافطة اتظبطوا على مكان الجسم القديم (قبل تصليح تحجيم العجل في fitModelToRig):
      // بنحركهم بنفس فرق مكان الجسم عشان يفضلوا في مكانهم بالنسبة للعربية
      const d = rig.model.position.clone().sub(SEAL_POS_LEGACY);
      ck.group.position.add(d);
      for (const mm of ck.mirrors) if (mm.side) mm.holder.position.add(d);
      // فوانيس الموديل نفسه: الفرامل/الوقوف (أحمر) والكشافات
      const tailMats = [], headMats = [];
      rig.model.traverse((o) => {
        if (!o.isMesh) return;
        const n = o.material.name || '';
        if (/red_emis|tail_light/i.test(n)) { o.material = o.material.clone(); o.material.emissive = new THREE.Color(0xff1a10); o.material.emissiveIntensity = 0.12; tailMats.push(o.material); }
        else if (/HL_Mat|HL_CHR/i.test(n)) { o.material = o.material.clone(); o.material.emissive = new THREE.Color(0xfff2d8); o.material.emissiveIntensity = 0; headMats.push(o.material); }
        else if (/corner/i.test(n)) { o.material = o.material.clone(); o.material.color.set(0x1a1b1d); } // الحواف اللي تحت: أسود مش أزرق
        else if (o.userData.role === 'paint') sealShibinLivery(o, rig.shell);
        // زجاج الموديل كان بـ transmission: ده بيعمل رسمة زيادة للمشهد كله كل فريم (كان سبب اللاج من جوه التاكسي)
        if (o.material.transmission > 0) { o.material = o.material.clone(); o.material.transmission = 0; o.material.transparent = true; o.material.opacity = Math.min(o.material.opacity, 0.35); o.material.depthWrite = false; }
      });
      rig.lights = {
        head: { set emissiveIntensity(v) { for (const m of headMats) m.emissiveIntensity = v > 0.1 ? 1.4 : 0; } },
        tail: { set emissiveIntensity(v) { for (const m of tailMats) m.emissiveIntensity = v > 2 ? 2.4 : v > 0.5 ? 0.9 : 0.12; } },
        fog: null,
      };
      rig.setReverse = () => {};
      rig.lamps = { head: [[-0.62, 0.64, -1.78], [0.62, 0.64, -1.78]], tail: [[-0.66, 0.8, 2.25], [0.66, 0.8, 2.25]] };
      for (const l of [...rig.lamps.head, ...rig.lamps.tail]) { l[1] += d.y; l[2] += d.z; }
      rig.dims = { HW: 0.96, frontF: 1.95 - d.z, rearF: -2.36 - d.z, roofY: 1.29 + d.y };
      for (const p of rig.paxSeats) { p.y += d.y; p.z += d.z; }
      rig.slidingDoor.center.add(d);
      // يافطة تاكسي صغيرة على السقف (منورة بالليل)
      {
        const c = canvas(256, 64), x = c.getContext('2d');
        x.fillStyle = '#f7d21c'; x.fillRect(0, 0, 256, 64);
        x.fillStyle = '#111'; x.font = 'bold 40px Cairo, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.direction = 'rtl';
        x.fillText('تاكسي', 128, 34);
        const tm = new THREE.MeshStandardMaterial({ map: tex(c, { repeat: false }), emissive: 0xffffff, roughness: 0.4 });
        tm.emissiveMap = tm.map; tm.emissiveIntensity = 0.15;
        const sign = new THREE.Group(); sign.position.set(0, 1.29, 0.45).add(d);
        const box = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.13, 0.16, 2, 0.03), new THREE.MeshStandardMaterial({ color: 0xf7d21c, roughness: 0.4 }));
        box.position.y = 0.07; box.castShadow = true; sign.add(box);
        for (const sz of [-1, 1]) { const f = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.11), tm); f.position.set(0, 0.07, sz * 0.081); if (sz < 0) f.rotation.y = Math.PI; sign.add(f); }
        rig.shell.add(sign);
        rig.taxiSignMat = tm;
      }
    }
  }
  return rig;
}

// =====================================================================
//  التوكتوك (باجاج 3 عجلات، جادون، سقف قماش، كنبة ورا)
// =====================================================================
function tuktukDecal() {
  const c = canvas(512, 128), x = c.getContext('2d');
  x.clearRect(0, 0, 512, 128);
  x.fillStyle = '#f2c230'; x.font = 'bold 54px "Aref Ruqaa", Cairo, serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.direction = 'rtl';
  x.fillText('يا رب توبة', 256, 64);
  return tex(c, { repeat: false });
}

export function buildTuktukRig(spec, assets = null) {
  const rig = baseRig(spec);
  const paint = new THREE.MeshPhysicalMaterial({ color: 0x7a1020, roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.15 });
  const black = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.7 });
  const canvasMat = new THREE.MeshStandardMaterial({ color: 0x1b1d1c, roughness: 0.95, side: THREE.DoubleSide });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.15, metalness: 1 });
  const seatMat = new THREE.MeshStandardMaterial({ map: makeSeatFabric(), roughness: 0.95 });
  const head = new THREE.MeshStandardMaterial({ color: 0xf8f8f0, emissive: 0xfff4d8, emissiveIntensity: 0, roughness: 0.1, metalness: 0.4 });
  const tail = new THREE.MeshStandardMaterial({ color: 0x8a0a0a, emissive: 0xff1a10, emissiveIntensity: 0.15, roughness: 0.2 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xcfe0dc, transparent: true, opacity: 0.12, roughness: 0.02, depthWrite: false, side: THREE.DoubleSide });
  const S = rig.shell;
  const add = (geo, mat, m, shadow = true) => { const mesh = new THREE.Mesh(geo, mat); if (m) mesh.applyMatrix4(m); mesh.castShadow = shadow; mesh.receiveShadow = true; S.add(mesh); return mesh; };
  const tube = (a, b, r, mat) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 8), mat);
    placeTube(m, a, b);
    m.castShadow = true; S.add(m); return m;
  };
  // (العصاية بتتحط من جديد لو العربية اتعرّضت: كانت بتتنقل من نصها بس فطرفها مابيوصلش للمراية/الكابينة)
  const placeTube = (m, a, b) => {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
    m.scale.set(1, A.distanceTo(B), 1);
    m.position.copy(A).add(B).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  };
  const zF = -spec.cgToFront, zR = spec.wheelBase - spec.cgToFront; // z العجلة القدام/الورا
  // الشاسيه والأرضية
  add(new RoundedBoxGeometry(1.22, 0.07, 2.2, 2, 0.03), black, M4(0, 0.31, 0.0));
  // البوز (الكابوت القدام) — شكل مدوّر
  add(new RoundedBoxGeometry(0.86, 0.6, 0.5, 4, 0.18), paint, M4(0, 0.63, zF - 0.1));
  // تابلوه صغير ورا البوز (تحت مستوى النظر)
  add(new RoundedBoxGeometry(0.9, 0.08, 0.28, 2, 0.03), black, M4(0, 0.93, zF + 0.22, 0.25));
  // الرفارف القدام فوق العجلة
  add(new THREE.CylinderGeometry(0.26, 0.26, 0.2, 18, 1, true, -Math.PI / 2, Math.PI).rotateZ(Math.PI / 2), black, M4(0, spec.wheelRadius + 0.03, zF));
  // كشاف قدام + غماز
  const headLamp = add(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 20).rotateX(Math.PI / 2), head, M4(0, 0.86, zF - 0.36));
  const headRing = add(new THREE.TorusGeometry(0.105, 0.012, 8, 24), chrome, M4(0, 0.86, zF - 0.37));
  for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.08, 0.05, 0.03), new THREE.MeshStandardMaterial({ color: 0xd08010, emissive: 0xff9010, emissiveIntensity: 0.15 }), M4(sx * 0.33, 0.95, zF - 0.33));
  // جوانب واطية (مفتوحة من فوق)
  for (const sx of [-1, 1]) {
    add(new RoundedBoxGeometry(0.05, 0.42, 2.0, 2, 0.02), paint, M4(sx * 0.63, 0.55, 0.05));
    // زينة: كتابة على الجنب
    const d = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.22), new THREE.MeshStandardMaterial({ map: tuktukDecal(), transparent: true, depthWrite: false }));
    d.position.set(sx * 0.66, 0.6, 0.45); d.rotation.y = sx * Math.PI / 2; S.add(d);
  }
  // الضهر (الموتور + الشنطة) وفوانيس ورا
  add(new RoundedBoxGeometry(1.26, 0.7, 0.32, 3, 0.06), paint, M4(0, 0.68, zR + 0.32));
  const tails = [-1, 1].map((sx) => add(new THREE.BoxGeometry(0.14, 0.1, 0.02), tail, M4(sx * 0.48, 0.82, zR + 0.49)));
  rig.lamps = { head: [[0, 0.86, zF - 0.39]], tail: tails.map((t) => [t.position.x, t.position.y, t.position.z + 0.012]) };
  // عمدان + سقف قماش
  const roofY = 1.7;
  for (const sx of [-1, 1]) {
    tube([sx * 0.4, 1.05, zF + 0.08], [sx * 0.6, roofY, zF + 0.3], 0.022, black);      // عمود الزجاج
    tube([sx * 0.62, 0.75, -0.18], [sx * 0.62, roofY, -0.18], 0.022, chrome);          // عمود نص
    tube([sx * 0.62, 0.95, zR + 0.45], [sx * 0.62, roofY, zR + 0.45], 0.025, black);     // ورا
  }
  add(new RoundedBoxGeometry(1.36, 0.07, 2.35, 3, 0.03), canvasMat, M4(0, roofY + 0.03, 0.0));
  add(new THREE.BoxGeometry(1.3, 0.55, 0.02), canvasMat, M4(0, roofY - 0.3, zR + 0.47)); // ضهر قماش
  // شرّابة على حرف السقف
  {
    const f = new GeoBuilder();
    for (let x = -0.64; x <= 0.64; x += 0.05) { f.setColor(Math.round(x * 20) % 2 ? [0.95, 0.75, 0.1] : [0.1, 0.55, 0.25]); f.addGeometry(new THREE.CylinderGeometry(0.004, 0.009, 0.06, 5), M4(x, roofY - 0.03, -1.15)); }
    add(f.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), null, false);
  }
  // الزجاج القدام
  add(new THREE.PlaneGeometry(0.82, 0.62), glass, M4(0, 1.36, zF + 0.19, -0.38), false).renderOrder = 2;
  // كرسي السواق (نص) + الكنبة ورا
  add(new RoundedBoxGeometry(0.5, 0.1, 0.42, 3, 0.04), seatMat, M4(0, 0.72, -0.45));
  add(new RoundedBoxGeometry(0.5, 0.42, 0.08, 3, 0.03), seatMat, M4(0, 0.97, -0.2, 0.15));
  add(new RoundedBoxGeometry(1.16, 0.12, 0.5, 3, 0.04), seatMat, M4(0, 0.66, 0.42));
  add(new RoundedBoxGeometry(1.16, 0.5, 0.09, 3, 0.04), seatMat, M4(0, 0.97, 0.72, 0.12));
  // الكابينة (صورة 3): تابلوه أصفر مقوّس + عداد في النص + جادون أزرق + إيدين السواق
  const ck = buildTuktukCockpit(rig);
  rig.steering = ck.steering;
  rig.hands = ck.hands;
  rig.cockpit = ck.cockpit;
  rig.gauges = null;
  rig.bobbles = [addBobbleDog(S, 0.26, 0.99, -1.0, 0, 1.1)];
  // السواق قاعد على كرسي التوكتوك العالي ورجله ممدودة لقدام على الأرضية (مش نازلة من تحت)
  rig.driverSeat = { y: 0.8, dz: 0.12, knee: -1.0 };
  // العجل: واحدة قدام (FL) والتانية مخفية، واتنين ورا
  const wm = vehicleMaterials(0xffffff);
  const mk = (x, z, side) => { const w = buildWheel({ radius: spec.wheelRadius, width: 0.12, rimRadius: 0.115, mats: wm, style: 'steel', side }); w.group.position.set(x, spec.wheelRadius, z); rig.root.add(w.group); return w; };
  const fw = mk(0, zF, 1);
  // شوكة العجلة القدام (بتلف معاها) — للتوكتوك الإجرائي بس (الموديل فيه رفرف بيغطيها)
  const fork = [];
  for (const sx of [-1, 1]) { const fk = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.42, 0.03), chrome); fk.position.set(sx * 0.08, 0.2, 0.02); fk.rotation.x = 0.15; fw.group.add(fk); fork.push(fk); }
  const ghost = { group: new THREE.Group(), spin: new THREE.Group() }; ghost.group.add(ghost.spin); ghost.group.position.set(0, spec.wheelRadius, zF); rig.root.add(ghost.group);
  const t = spec.track / 2;
  const rl = mk(-t, zR, -1), rr = mk(t, zR, 1);
  rig.wheels.push({ id: 'FL', front: true, ...fw }, { id: 'FR', front: true, ...ghost }, { id: 'RL', front: false, ...rl }, { id: 'RR', front: false, ...rr });
  // المرايات: مدورة على عصيان قدام
  // العصاية من حرف الكابينة لضهر المراية بالظبط (زي البجاج: المراية قريبة من الكابينة، مش طايرة بعيد)
  const mirrorSticks = [];
  const stickEnds = (sx, WX = 1) => [[sx * 0.44 * WX, 1.12, zF + 0.3], [sx * 0.6 * WX, 1.27, zF + 0.2]];
  for (const sx of [-1, 1]) {
    const [a, b] = stickEnds(sx);
    const st = tube(a, b, 0.01, black); st.userData.sx = sx; mirrorSticks.push(st);
    const { holder, face } = mirrorFace(0.12, 0.09);
    holder.position.set(sx * 0.62, 1.31, zF + 0.185);
    const back = new THREE.Mesh(new RoundedBoxGeometry(0.135, 0.105, 0.03, 2, 0.02), black); back.position.z = -0.018; holder.add(back);
    face.position.z = 0.002;
    S.add(holder);
    rig.mirrors.push({ holder, face, side: sx, aspect: 0.12 / 0.09, fov: 30 });
  }
  // عين السواق
  const eye = new THREE.Object3D(); eye.position.set(0, 1.36, -0.4); S.add(eye);
  rig.eye = eye; rig.eyePitch = -0.25; // باصّة لتحت شوية: الجادون والإيدين والعداد باينين زي الصورة rig.eyeBase = eye.position.clone();
  rig.lights = { head, tail, fog: null };
  rig.dims = { HW: 0.66, frontF: -(zF - 0.36), rearF: -(zR + 0.49), roofY: roofY + 0.05 };
  rig.contactShadow = contactShadow(1.5, 2.9);
  rig.root.add(rig.contactShadow);
  rig.paxSeats = [-0.38, 0, 0.38].map((x) => ({ x, y: 0.72, z: 0.42 }));
  rig.slidingDoor = fakeDoor(new THREE.Vector3(0.66, 0.8, 0.42));
  rig.kind = 'tuktuk';
  // موديل التوكتوك الحقيقي لو موجود: بيبقى هو الجسم، ونخفي الجسم الإجرائي (الدركسيون والمرايات والعين بيفضلوا)
  const a = assets?.get('tuktuk_model');
  if (a) {
    const keep = new Set([head, tail]);
    const procedural = S.children.filter((o) => o.isMesh && !keep.has(o.material) && o !== headRing && !mirrorSticks.includes(o));
    if (fitModelToRig(rig, spec, a, { wheelRe: /rin/i })) {
      for (const o of procedural) o.visible = false;
      for (const o of fork) o.visible = false;
      tuktukColors(rig.model);
      // الفوانيس على جسم الموديل بالظبط (مش طايرة قدامه/وراه): الكشاف في نص الوش فوق الرفرف، والفوانيس على الضهر
      // (المقاسات من قياس سطح الموديل: الوش اللي قدام عند z≈-1.30، والضهر عند z≈1.01)
      headLamp.geometry = new THREE.CylinderGeometry(0.075, 0.075, 0.04, 24).rotateX(Math.PI / 2);
      headLamp.position.set(0, 0.7, -1.315);
      headRing.geometry = new THREE.TorusGeometry(0.079, 0.01, 8, 28);
      headRing.position.set(0, 0.7, -1.335);
      for (const t of tails) { t.geometry = new THREE.BoxGeometry(0.12, 0.08, 0.02); t.position.set(Math.sign(t.position.x) * 0.36, 0.8, 1.02); }
      rig.lamps = { head: [[0, 0.7, -1.34]], tail: tails.map((t) => [t.position.x, t.position.y, 1.035]) };
      // التوكتوك كان باين رفيع من برا: بنعرّضه (الجسم + الكابينة + المرايات) على قد العجل اللي ورا
      const WX = spec.track / 1.0;
      rig.model.scale.x *= WX;
      ck.group.scale.x = WX;
      for (const m of rig.mirrors) m.holder.position.x *= WX;
      for (const o of mirrorSticks) placeTube(o, ...stickEnds(o.userData.sx, WX));
      for (const t of tails) t.position.x *= WX;
      rig.lamps.tail = tails.map((t) => [t.position.x, t.position.y, 1.035]);
      rig.dims.HW *= WX;
      for (const p of rig.paxSeats) p.x *= WX;
      rig.slidingDoor.center.x *= WX;
    }
  }
  return rig;
}
