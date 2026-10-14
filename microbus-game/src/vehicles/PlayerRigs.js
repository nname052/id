import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GeoBuilder } from '../render/GeoBuilder.js';
import { vehicleMaterials } from '../render/materials.js';
import { canvas, tex, makeGauge2, makeSeatFabric } from '../render/textures.js';
import { buildCar, contactShadow } from './CarModels.js';
import { buildWheel } from './wheel.js';
import { fitModelToRig, tuktukColors } from './ModelFit.js';

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

function gauge(kind, r, mat0) {
  const gm = new THREE.MeshStandardMaterial({ map: makeGauge2(kind), emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.35 });
  gm.emissiveMap = gm.map;
  const h = new THREE.Group();
  h.add(new THREE.Mesh(new THREE.CircleGeometry(r, 32), gm));
  if (mat0) h.add(new THREE.Mesh(new THREE.TorusGeometry(r + 0.004, 0.004, 6, 32), mat0));
  const pivot = new THREE.Group(); pivot.position.z = 0.004;
  pivot.add(new THREE.Mesh(new THREE.BoxGeometry(0.004, r * 0.85, 0.002).translate(0, r * 0.38, 0), new THREE.MeshStandardMaterial({ color: 0xff4a10, emissive: 0xff3a00, emissiveIntensity: 0.7 })));
  h.add(pivot);
  return { h, g: { pivot, mat: gm } };
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

// =====================================================================
//  التاكسي (سيدان أبيض بشريط شطرنج — نفس شكل تاكسي المرور)
// =====================================================================
export function buildTaxiRig(spec, assets = null) {
  const rig = baseRig(spec);
  const car = buildCar('taxi', 0xf2f2ee, { profile: 'sedan' });
  const P = car.profile;
  const shift = P.axleF - spec.cgToFront;            // مركز الثقل قدام نص العربية شوية
  car.body.position.z = shift;
  rig.shell.add(car.body);
  rig.mats = car.mats;
  // زجاج: باين من برا وشفاف كفاية من جوه
  // FrontSide: الأسطح وشها لبره، فمن جوه الكابينة مش بتترسم (رؤية صافية) ومن برا الزجاج باين
  car.mats.glass.opacity = 0.55; car.mats.glass.color.set(0x24333a); car.mats.glass.side = THREE.FrontSide;
  // الموديل الخارجي صاج "مصمت": بنفتح الكابينة من فوق عشان الصالون يبان (نشيل غطا الجسم جوه الكابينة)
  const cabF0 = P.cabin[0][0] + 0.02, cabF1 = P.cabin[3][0] - 0.05, hw = P.width / 2 - 0.05;
  car.body.traverse((o) => {
    if (!o.isMesh || o.userData.role !== 'paint') return;
    clipTris(o.geometry, (x, y, z) => Math.abs(x) < hw && y > 0.55 && -z < cabF0 && -z > cabF1);
  });
  // أعمدة A و C (الموديل فيه عمود نص بس)
  {
    const pm = car.mats.paint, [a0, a1, c0, c1] = [P.cabin[0], P.cabin[1], P.cabin[2], P.cabin[3]];
    for (const sx of [-1, 1]) for (const [p0, p1] of [[a0, a1], [c0, c1]]) {
      const A = new THREE.Vector3(sx * (P.width / 2 - 0.1), p0[1], -p0[0]), B = new THREE.Vector3(sx * (P.width / 2 - 0.12), p1[1], -p1[0]);
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.07, A.distanceTo(B), 0.08), pm);
      m.position.copy(A).add(B).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
      m.castShadow = true;
      car.body.add(m);
    }
  }
  const zf = (f) => -(f - shift);                     // f على طول العربية → z في shell
  // العجل: نفس عجل الموديل بس متوصلة بالفيزياء
  const t = spec.track / 2;
  const ids = ['FL', 'FR', 'RL', 'RR'];
  car.wheels.forEach((w, i) => {
    w.group.removeFromParent();
    const rf = i < 2 ? spec.cgToFront : -(spec.wheelBase - spec.cgToFront);
    w.group.position.set(i % 2 ? t : -t, spec.wheelRadius, -rf);
    rig.root.add(w.group);
    rig.wheels.push({ id: ids[i], front: i < 2, group: w.group, spin: w.spin });
  });
  // الضل
  car.root.traverse((o) => { if (o.userData.role === 'shadow') rig.contactShadow = o; });
  if (rig.contactShadow) { rig.contactShadow.removeFromParent(); rig.contactShadow.position.z = shift; rig.root.add(rig.contactShadow); }

  // ===== الصالون =====
  const mats = {
    dash: new THREE.MeshStandardMaterial({ color: 0x232427, roughness: 0.8 }),
    seat: new THREE.MeshStandardMaterial({ map: makeSeatFabric(), roughness: 0.95, color: 0x9a9a9a }),
    trim: new THREE.MeshStandardMaterial({ color: 0x5a5852, roughness: 0.9 }),
    chrome: car.mats.chrome,
  };
  const g = new THREE.Group(); g.name = 'taxi-interior';
  rig.shell.add(g);
  const IW = P.width / 2 - 0.1;
  const add = (geo, mat, m) => { const mesh = new THREE.Mesh(geo, mat); if (m) mesh.applyMatrix4(m); mesh.receiveShadow = true; g.add(mesh); return mesh; };
  // أرضية + تابلوه
  add(new THREE.BoxGeometry(IW * 2, 0.04, 3.0), mats.trim, M4(0, 0.3, zf(-0.3)));
  const dashMain = add(new RoundedBoxGeometry(IW * 2, 0.3, 0.55, 3, 0.06), mats.dash, M4(0, 0.78, zf(0.68)));
  const dashTray = add(new RoundedBoxGeometry(IW * 2 - 0.02, 0.06, 0.4, 2, 0.03), mats.dash, M4(0, 0.93, zf(0.78), -0.18));
  // عدادات
  const gauges = {};
  for (const [kind, dx, r] of [['rpm', -0.09, 0.045], ['speed', 0.06, 0.055]]) {
    const { h, g: gg } = gauge(kind, r, mats.chrome);
    h.position.set(-0.37 + dx, 0.93, zf(0.52)); h.rotation.x = -0.35;
    g.add(h); gauges[kind] = gg;
  }
  add(new RoundedBoxGeometry(0.3, 0.12, 0.12, 2, 0.04), mats.dash, M4(-0.37, 0.95, zf(0.56), -0.35));
  rig.gauges = gauges;
  // الدركسيون
  const swTilt = new THREE.Group();
  swTilt.position.set(-0.37, 0.88, zf(0.36)); swTilt.rotation.x = -1.2;
  const steering = new THREE.Group(); swTilt.add(steering); g.add(swTilt);
  const swMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.6 });
  steering.add(new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.016, 12, 48), swMat));
  const hub = new THREE.Mesh(new RoundedBoxGeometry(0.12, 0.1, 0.05, 3, 0.02), swMat); hub.position.z = 0.02; steering.add(hub);
  for (const a of [0, 2.1, -2.1]) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.17, 0.016), swMat); sp.position.set(Math.sin(a) * 0.09, -Math.cos(a) * 0.09, 0.01); sp.rotation.z = a; steering.add(sp); }
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.3, 10).rotateX(Math.PI / 2), mats.dash); col.position.z = -0.16; swTilt.add(col);
  rig.steering = steering;
  // كراسي
  const seat = (x, f, w) => {
    add(new RoundedBoxGeometry(w, 0.11, 0.5, 3, 0.04), mats.seat, M4(x, 0.46, zf(f)));
    add(new RoundedBoxGeometry(w, 0.58, 0.1, 3, 0.04), mats.seat, M4(x, 0.78, zf(f - 0.27), 0.15));
  };
  seat(-0.37, -0.28, 0.5); seat(0.37, -0.28, 0.5); seat(0, -1.12, IW * 2 - 0.08);
  // فرامل يد + فتيس
  const hb = new THREE.Group(); hb.position.set(0, 0.5, zf(-0.05));
  hb.add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.22).translate(0, 0, -0.11), mats.dash));
  g.add(hb); rig.handbrake = hb;
  // مراية جوه + سبحة
  {
    const { holder, face } = mirrorFace(0.22, 0.06);
    holder.position.set(0, 1.27, zf(0.42));
    const house = new THREE.Mesh(new RoundedBoxGeometry(0.24, 0.075, 0.025, 2, 0.01), mats.dash); house.position.z = -0.015; holder.add(house);
    face.position.z = 0.002;
    g.add(holder);
    rig.mirrors.push({ holder, face, side: 0, aspect: 0.22 / 0.06, fov: 13 });
    const sebha = new THREE.Group(); sebha.position.set(0.02, 1.22, zf(0.42));
    const bg = new GeoBuilder(); bg.setColor([0.1, 0.3, 0.7]);
    for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI * 2; bg.addGeometry(new THREE.SphereGeometry(0.006, 6, 4), M4(Math.sin(a) * 0.022, -0.04 - 0.04 * (1 - Math.cos(a)), 0)); }
    sebha.add(new THREE.Mesh(bg.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4 })));
    g.add(sebha); rig.hangers.push({ obj: sebha, L: 0.15 });
  }
  // المرايات الجانبية (على مكان جراب المراية في الموديل)
  for (const sx of [-1, 1]) {
    const { holder, face } = mirrorFace(0.14, 0.09);
    holder.position.set(sx * (P.width / 2 + 0.04), 1.0, zf(P.cabin[0][0] - 0.23));
    rig.shell.add(holder);
    rig.mirrors.push({ holder, face, side: sx, aspect: 0.14 / 0.09, fov: 26 });
  }
  // عين السواق
  const eye = new THREE.Object3D(); eye.position.set(-0.37, 1.12, zf(-0.36)); g.add(eye);
  rig.eye = eye; rig.eyePitch = -0.12; rig.eyeBase = eye.position.clone();
  // الأنوار
  rig.lights = { head: car.mats.headlight, tail: car.mats.taillight, fog: null };
  // الأبعاد (زي الهاي إس: rearF بالسالب)
  const fF = P.lower[1][0], fR = P.lower[P.lower.length - 2][0];
  rig.dims = { HW: P.width / 2, frontF: fF - shift, rearF: fR - shift, roofY: 1.43 };
  // الركاب: قدام جنب السواق + 3 ورا
  rig.paxSeats = [{ x: 0.37, y: 0.5, z: zf(-0.28) }, ...[-0.4, 0, 0.4].map((x) => ({ x, y: 0.5, z: zf(-1.12) }))];
  rig.slidingDoor = fakeDoor(new THREE.Vector3(P.width / 2, 0.8, zf(-0.8)));
  rig.kind = 'taxi';
  rig.root.traverse((o) => { if (o.isMesh && o.userData.role !== 'glass' && o.userData.role !== 'shadow') o.castShadow = true; });
  // موديل التاكسي الحقيقي (BYD Seal) لو موجود: بيبقى هو شكل العربية من برا، والصالون الإجرائي جواه
  const a = assets?.get('car_taxi');
  if (a && fitModelToRig(rig, spec, a, { wheelRe: /tyre|tire|rim|disk/i })) {
    car.body.visible = false;
    // التابلوه أقصر شوية عشان مايطلعش من الكابوت (كابوت الـ BYD أوطى)
    dashMain.geometry.dispose(); dashMain.geometry = new RoundedBoxGeometry(IW * 2 - 0.06, 0.26, 0.36, 3, 0.06);
    dashMain.position.set(0, 0.76, zf(0.58));
    dashTray.geometry.dispose(); dashTray.geometry = new RoundedBoxGeometry(IW * 2 - 0.08, 0.05, 0.26, 2, 0.03);
    dashTray.position.set(0, 0.9, zf(0.62));
    // المرايات الجانبية: الموديل فيه مراياته؛ بنخفي الإجرائية (الكاميرا بتاعتها بتفضل شغالة للمرايات اللي على الشاشة)
    for (const m of rig.mirrors) if (m.side) m.holder.traverse((o) => { if (o.isMesh) o.visible = false; });
    // سقف الـ BYD أوطى: المراية اللي جوه والسبحة تنزل شوية عشان ماتطلعش من السقف
    for (const m of rig.mirrors) if (!m.side) m.holder.position.y -= 0.12;
    for (const h of rig.hangers) h.obj.position.y -= 0.12;
    // فوانيس الفرامل من الموديل
    rig.model.traverse((o) => {
      if (!o.isMesh) return;
      if (/red_emis|tail_light/i.test(o.material.name || '')) { o.material = o.material.clone(); o.material.emissive = new THREE.Color(0xff1a10); o.material.emissiveIntensity = 0.15; rig.lights.tail = o.material; }
      if (/glass/i.test(o.material.name || '') && o.material.transparent !== true) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.45; o.material.depthWrite = false; o.material.side = THREE.FrontSide; }
    });
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
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), len = A.distanceTo(B);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8), mat);
    m.position.copy(A).add(B).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
    m.castShadow = true; S.add(m); return m;
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
  add(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 20).rotateX(Math.PI / 2), head, M4(0, 0.86, zF - 0.36));
  add(new THREE.TorusGeometry(0.105, 0.012, 8, 24), chrome, M4(0, 0.86, zF - 0.37));
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
  for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.14, 0.1, 0.02), tail, M4(sx * 0.48, 0.82, zR + 0.49));
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
  // الجادون (handlebar): بيلف حوالين عمود شبه رأسي
  const col = new THREE.Group();
  col.position.set(0, 0.95, zF + 0.32);
  col.rotation.x = -Math.PI / 2 + 0.42;      // محور z المحلي = العمود (لفوق ومايل لورا)
  S.add(col);
  const steering = new THREE.Group(); col.add(steering);
  steering.add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.62, 10).rotateZ(Math.PI / 2), chrome));
  for (const sx of [-1, 1]) { const gr = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.12, 10).rotateZ(Math.PI / 2), black); gr.position.x = sx * 0.3; steering.add(gr); }
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.24, 10).rotateX(Math.PI / 2), black); stem.position.z = -0.12; col.add(stem);
  // عداد صغير في نص الجادون
  const gauges = {};
  {
    const { h, g: gg } = gauge('speed', 0.045, chrome);
    h.position.set(0, 0.04, 0.03); h.rotation.x = 0.5; steering.add(h); gauges.speed = gg;
    const { h: h2, g: g2 } = gauge('rpm', 0.025, null);
    h2.position.set(0.1, 0.03, 0.02); h2.rotation.x = 0.5; steering.add(h2); gauges.rpm = g2;
  }
  rig.gauges = gauges;
  rig.steering = steering;
  // العجل: واحدة قدام (FL) والتانية مخفية، واتنين ورا
  const wm = vehicleMaterials(0xffffff);
  const mk = (x, z, side) => { const w = buildWheel({ radius: spec.wheelRadius, width: 0.12, rimRadius: 0.115, mats: wm, style: 'steel', side }); w.group.position.set(x, spec.wheelRadius, z); rig.root.add(w.group); return w; };
  const fw = mk(0, zF, 1);
  // شوكة العجلة القدام (بتلف معاها)
  for (const sx of [-1, 1]) { const fk = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.42, 0.03), chrome); fk.position.set(sx * 0.08, 0.2, 0.02); fk.rotation.x = 0.15; fw.group.add(fk); }
  const ghost = { group: new THREE.Group(), spin: new THREE.Group() }; ghost.group.add(ghost.spin); ghost.group.position.set(0, spec.wheelRadius, zF); rig.root.add(ghost.group);
  const t = spec.track / 2;
  const rl = mk(-t, zR, -1), rr = mk(t, zR, 1);
  rig.wheels.push({ id: 'FL', front: true, ...fw }, { id: 'FR', front: true, ...ghost }, { id: 'RL', front: false, ...rl }, { id: 'RR', front: false, ...rr });
  // المرايات: مدورة على عصيان قدام
  const mirrorSticks = [];
  for (const sx of [-1, 1]) {
    mirrorSticks.push(tube([sx * 0.45, 1.1, zF + 0.12], [sx * 0.74, 1.3, zF + 0.05], 0.01, black));
    const { holder, face } = mirrorFace(0.12, 0.09);
    holder.position.set(sx * 0.76, 1.34, zF + 0.04);
    const back = new THREE.Mesh(new RoundedBoxGeometry(0.135, 0.105, 0.03, 2, 0.02), black); back.position.z = -0.018; holder.add(back);
    face.position.z = 0.002;
    S.add(holder);
    rig.mirrors.push({ holder, face, side: sx, aspect: 0.12 / 0.09, fov: 30 });
  }
  // عين السواق
  const eye = new THREE.Object3D(); eye.position.set(0, 1.36, -0.4); S.add(eye);
  rig.eye = eye; rig.eyePitch = -0.16; rig.eyeBase = eye.position.clone();
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
    const procedural = S.children.filter((o) => o.isMesh && !keep.has(o.material) && !mirrorSticks.includes(o));
    if (fitModelToRig(rig, spec, a, { wheelRe: /rin/i })) {
      for (const o of procedural) o.visible = false;
      tuktukColors(rig.model);
    }
  }
  return rig;
}
