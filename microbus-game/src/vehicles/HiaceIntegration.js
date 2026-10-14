import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GeoBuilder } from '../render/GeoBuilder.js';
import { addCabAccessories } from './CabAccessories.js';
import { canvas, tex, makeSeatFabric, makeGauge2, makeShiftGate } from '../render/textures.js';

// =====================================================================
//  دمج موديل GLB حقيقي (Toyota HiAce 2005) كعربية اللاعب:
//  - اكتشاف العجل الأربعة وتسنيترها وربطها بالتوجيه والدوران
//  - قياس الأبعاد الحقيقية (محاور، عجل، عرض) وضبط الفيزياء عليها
//  - صالون داخلي مقاسه على كابينة الموديل + غلاف داخلي (أعمدة وإطارات الأبواب من جوه)
//  - مرايات حقيقية على مكان مرايات الموديل
// =====================================================================

const _b = new THREE.Box3(), _c = new THREE.Vector3();

/** يقيس الموديل ويرجع الأبعاد والعجل (كل حاجة في إحداثيات الـ holder) */
export function analyzeVehicle(holder) {
  holder.updateMatrixWorld(true);
  const meshes = [];
  holder.traverse((o) => { if (o.isMesh) meshes.push(o); });
  const wheels = meshes.filter((m) => /wheel|tire|tyre/i.test(m.userData.matName || m.material?.name || ''));
  const body = new THREE.Box3();
  // جسم العربية = الصاج الملوّن بس (المرايات والحاجات الطالعة مش داخلة)
  const paint = meshes.filter((m) => /paint/i.test(m.userData.matName || ''));
  for (const m of (paint.length ? paint : meshes)) if (!wheels.includes(m)) body.union(_b.setFromObject(m));
  const ws = wheels.map((m) => { _b.setFromObject(m); return { mesh: m, c: _b.getCenter(new THREE.Vector3()), r: (_b.max.y - _b.min.y) / 2, w: _b.max.x - _b.min.x }; });
  if (ws.length !== 4) return { ok: false, body, meshes };
  const zMid = ws.reduce((a, w) => a + w.c.z, 0) / 4, xMid = ws.reduce((a, w) => a + w.c.x, 0) / 4;
  for (const w of ws) w.id = (w.c.z < zMid ? 'F' : 'R') + (w.c.x < xMid ? 'L' : 'R');
  const front = ws.filter((w) => w.id[0] === 'F'), rear = ws.filter((w) => w.id[0] === 'R');
  const zF = (front[0].c.z + front[1].c.z) / 2, zR = (rear[0].c.z + rear[1].c.z) / 2;
  return {
    ok: true, meshes, wheels: ws, body,
    wheelBase: Math.abs(zR - zF), track: Math.abs(front[0].c.x - front[1].c.x),
    radius: ws.reduce((a, w) => a + w.r, 0) / 4, wheelY: ws.reduce((a, w) => a + w.c.y, 0) / 4,
    zF, zR, xMid,
  };
}

/** يرجع إعدادات فيزياء مناسبة لمقاس الموديل */
export function specFromModel(base, A) {
  const wb = A.wheelBase;
  const cgToFront = wb * 0.47; // الموتور تحت الكراسي الأمامية → الوزن قدام شوية
  const bodyLen = A.body.max.z - A.body.min.z, bodyW = A.body.max.x - A.body.min.x;
  const bodyMidZ = (A.body.max.z + A.body.min.z) / 2;
  // الأصل (مركز الثقل) = المحور الأمامي + cgToFront لورا
  const cgZ = A.zF + cgToFront;
  return {
    ...base,
    mass: 2250, inertiaYaw: 4700, inertiaPitch: 4400, inertiaRoll: 1150, cgHeight: 0.82,
    wheelBase: wb, cgToFront, track: A.track, wheelRadius: A.radius,
    springK: 47000, damperBump: 3300, damperRebound: 4400, maxCompression: 0.21, // ~10سم مشوار للمساعد
    halfWidth: bodyW / 2 - 0.01, halfLength: bodyLen / 2, boxOffset: -(bodyMidZ - cgZ),
    _cgZ: cgZ,
  };
}

export function integrateHiace(rig, asset, spec, A) {
  const cfg = asset.cfg;
  const holder = asset.holder;
  // نحرّك الموديل بحيث مركز الثقل = (0,0,0) والعجل لامسة الأرض بالظبط
  holder.position.set(-A.xMid, spec.wheelRadius - A.wheelY, -spec._cgZ);
  rig.shell.add(holder);
  holder.updateMatrixWorld(true);
  // الميكروباص القديم (المكعبات) بيتشال من المشهد خالص — مش بس بيستخبى
  rig.exterior.removeFromParent();
  rig.interiorGroup.removeFromParent();

  // ===== العجل: نشيلها من الموديل ونحطها في مجموعات التوجيه/الدوران =====
  const FA = spec.cgToFront, RA = -(spec.wheelBase - spec.cgToFront), t = spec.track / 2;
  const pos = { FL: [-t, FA], FR: [t, FA], RL: [-t, RA], RR: [t, RA] };
  for (const w of rig.wheels) {
    const src = A.wheels.find((x) => x.id === w.id);
    w.group.position.set(pos[w.id][0], spec.wheelRadius, -pos[w.id][1]);
    if (!src) continue;
    for (const ch of [...w.spin.children]) ch.removeFromParent();
    // نطبّق تحويل العجلة الكامل (تحجيم + دوران) بالنسبة للـ holder، وبعدين نسنترها
    src.mesh.updateWorldMatrix(true, false);
    const rel = new THREE.Matrix4().copy(holder.matrixWorld).invert().multiply(src.mesh.matrixWorld);
    const g = src.mesh.geometry.clone().applyMatrix4(rel);
    g.translate(-src.c.x, -src.c.y, -src.c.z);
    g.computeBoundingBox(); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, src.mesh.material);
    m.castShadow = true; m.receiveShadow = true;
    m.userData.role = 'tire';
    w.spin.add(m);
    src.mesh.visible = false;
  }

  // ===== شيل الصالون الأصلي (يمين = ياباني) عشان صالوننا (شمال = مصري) =====
  // بنمسح المثلثات اللي جوه الكابينة بس، والصاج الخارجي والشبكة والمرايات زي ما هي
  {
    const bb = A.body;
    // holder: الأمام = z الأصغر. (1) منطقة التابلوه الأصلي تحت الزجاج الأمامي
    // (2) منطقة الكراسي الأصلية تحت خط الشبابيك. الأعمدة والإطارات والصاج فوق/بره الصناديق دي
    let wsBaseY = 1.28;
    holder.traverse((o) => { if (o.isMesh && (o.userData.matName || '') === 'glass2') wsBaseY = new THREE.Box3().setFromObject(o).min.y; });
    const boxes = [
      new THREE.Box3(new THREE.Vector3(bb.min.x + 0.12, bb.min.y + 0.36, bb.min.z + 0.16), new THREE.Vector3(bb.max.x - 0.12, wsBaseY + 0.1, bb.min.z + 1.05)),
      new THREE.Box3(new THREE.Vector3(bb.min.x + 0.1, bb.min.y + 0.36, bb.min.z + 1.05), new THREE.Vector3(bb.max.x - 0.1, wsBaseY - 0.06, bb.max.z - 0.12)),
    ];
    let removed = 0;
    holder.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      const n = (o.userData.matName || '').toLowerCase();
      if (/wheel|glass|light|chrome|paint/.test(n)) return; // الصاج الخارجي مايتلمسش
      removed += clipInside(o, holder, boxes);
    });
    console.info('[HiAce] شلت', removed, 'مثلث من الصالون الأصلي');
  }

  // ===== تصحيح اتجاه الأسطح لبره (الموديل فيه أسطح مقلوبة) =====
  {
    const bc = A.body.getCenter(new THREE.Vector3()), bh = A.body.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    holder.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      const n = (o.userData.matName || '').toLowerCase();
      if (n !== 'paint') return; // الصاج الخارجي بس (عشان الإضاءة تبقى صح)
      void bc; void bh;
    });
  }

  // ===== تحسين الخامات (زي الصور المرجعية) =====
  const lightsMats = [];
  holder.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true;
    const n = (o.userData.matName || '').toLowerCase();
    const mat = o.material;
    // بعد تصحيح اتجاه المثلثات: الصاج وش واحد بس (من جوه بيبان التلبيس الغامق)
    if (n === 'paint') {
      // الصاج لبره بس، وله أولوية على أي سطح لازق فيه (زي التلبيس الأسود)
      mat.side = THREE.DoubleSide; mat.polygonOffset = true; mat.polygonOffsetFactor = -1; mat.polygonOffsetUnits = -2; mat.needsUpdate = true;
    } else if (n === 'black') {
      mat.side = THREE.DoubleSide; mat.polygonOffset = true; mat.polygonOffsetFactor = 1; mat.polygonOffsetUnits = 2; mat.needsUpdate = true;
    }
    if (n === 'glass2') {
      // الزجاج الأمامي: شفاف جدًا عشان السواق يشوف كويس
      o.material = new THREE.MeshPhysicalMaterial({ color: 0x9fb4b8, transparent: true, opacity: 0.12, roughness: 0.02, metalness: 0, envMapIntensity: 1.2, depthWrite: false, side: THREE.DoubleSide });
      o.castShadow = false; o.renderOrder = 2; o.userData.role = 'windshield';
    } else if (n === 'glass') {
      o.material = new THREE.MeshPhysicalMaterial({ color: 0x1a2328, transparent: true, opacity: 0.5, roughness: 0.03, metalness: 0, envMapIntensity: 1.8, depthWrite: false, side: THREE.DoubleSide });
      o.castShadow = false; o.renderOrder = 2; o.userData.role = 'glass';
    } else if (n === 'paint') {
      mat.roughness = 0.22; mat.envMapIntensity = 1.1; o.userData.role = 'paint';
    } else if (n === 'lights') {
      mat.emissive = new THREE.Color(0xffffff); mat.emissiveMap = mat.map; mat.emissiveIntensity = 0; lightsMats.push(mat);
    } else if (n.includes('chrome')) {
      mat.metalness = 0.9; mat.roughness = 0.15;
    }
  });

  // ===== الأبعاد بعد التحريك (في إحداثيات الـ shell) =====
  const toShell = (v) => v.clone().add(holder.position);
  const body = new THREE.Box3(toShell(A.body.min), toShell(A.body.max));
  const HW = (body.max.x - body.min.x) / 2;
  const frontF = -body.min.z, rearF = -body.max.z, roofY = body.max.y;
  // الزجاج الأمامي والمرايات من الموديل
  let ws = null;
  const mirrorBoxes = { [-1]: new THREE.Box3(), [1]: new THREE.Box3() };
  holder.traverse((o) => {
    if (!o.isMesh) return;
    const n = (o.userData.matName || '').toLowerCase();
    if (n === 'glass2') ws = new THREE.Box3().setFromObject(o);
    if (n === 'chrome') {
      // المرايات: الجزء اللي طالع بره الجسم
      const p = o.geometry.attributes.position, v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
        rig.shell.worldToLocal(v);
        if (Math.abs(v.x) > HW + 0.04) mirrorBoxes[Math.sign(v.x)].expandByPoint(v);
      }
    }
  });
  if (ws) { ws = new THREE.Box3(rig.shell.worldToLocal(ws.min.clone()), rig.shell.worldToLocal(ws.max.clone())); }
  const D = {
    HW, frontF, rearF, roofY,
    wsBase: ws ? [-ws.min.z, ws.min.y] : [frontF - 0.2, 1.28],
    wsTop: ws ? [-ws.max.z, ws.max.y] : [frontF - 0.9, 1.78],
    wsHalf: ws ? (ws.max.x - ws.min.x) / 2 : HW - 0.1,
  };

  // ===== الصالون الجديد =====
  const rigInt = new THREE.Group();
  rigInt.name = 'hiace-interior';
  rig.shell.add(rigInt);
  buildHiaceInterior(rigInt, rig, D);
  rig.interiorGroup = rigInt;

  // ===== المرايات الحقيقية (على مرايات الموديل) =====
  for (const m of rig.mirrors) if (!m.hiace) m.holder.visible = false;
  const keep = rig.mirrors.filter((m) => m.side === 0 && m.hiace);
  rig.mirrors = keep;
  for (const sx of [-1, 1]) {
    const b = mirrorBoxes[sx];
    if (b.isEmpty()) continue;
    const c = b.getCenter(new THREE.Vector3());
    const h = (b.max.y - b.min.y) * 0.86, w = Math.min(0.17, (b.max.x - b.min.x) * 0.8);
    const holderM = new THREE.Group();
    holderM.position.set(c.x, c.y, b.max.z + 0.004); // الوش ناحية ورا
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: 0x223344 }));
    face.userData.role = 'mirrorDark';
    holderM.add(face);
    rig.shell.add(holderM);
    rig.mirrors.push({ holder: holderM, face, side: sx, aspect: w / h, fov: 26 });
  }

  // ===== فوانيس الفرامل (مستطيلات حمرا مضيئة فوق فوانيس الموديل) =====
  const tail = new THREE.MeshStandardMaterial({ color: 0x5a0000, emissive: 0xff1a0a, emissiveIntensity: 0.0, transparent: true, opacity: 0.85, roughness: 0.3, depthWrite: false });
  for (const sx of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.36), tail);
    p.position.set(sx * (HW - 0.07), 0.82, -rearF + 0.012);
    rig.shell.add(p);
  }
  rig.lights = { head: { set emissiveIntensity(v) { for (const m of lightsMats) m.emissiveIntensity = v * 0.35; } }, tail, indicator: null, fog: null };
  rig.lights.head.emissiveIntensity = 0;

  // ضل ناعم تحت العربية على المقاس
  if (rig.contactShadow) { rig.contactShadow.scale.set((HW * 2 + 0.3) / 2.2, 1, (frontF - rearF + 0.3) / 5.7); }
  rig.dims = D;
  return D;
}

// =====================================================================
//  الصالون: مقاس على كابينة الهاي إس (كابينة فوق الموتور)
// =====================================================================
const M4 = (x = 0, y = 0, zz = 0, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(
  new THREE.Vector3(x, y, zz), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(1, 1, 1));
const z = (f) => -f;

function buildHiaceInterior(group, rig, D) {
  const mats = rig.mats;
  const kit = new Map();
  const K = (k) => { if (!kit.has(k)) kit.set(k, new GeoBuilder()); return kit.get(k); };
  const box = (k, x0, y0, z0, x1, y1, z1) => K(k).box(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1), Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1));
  const IW = D.HW - 0.06;
  const DX = -IW * 0.5;                      // السواق شمال
  const [wbF, wbY] = D.wsBase, [wtF, wtY] = D.wsTop;
  const dashTop = wbY - 0.05, dashBackF = wbF - 0.56;
  const floorY = 0.6;
  // الأرضية والسقف من جوه
  box('floor', -IW, floorY - 0.1, z(D.frontF - 0.2), IW, floorY, z(D.rearF + 0.05));
  K('beige').box(-IW, D.roofY - 0.08, z(wtF - 0.05), IW, D.roofY - 0.05, z(D.rearF + 0.08), { skip: 'py' });

  // ===== التابلوه =====
  const sh = new THREE.Shape();
  sh.moveTo(dashBackF + 0.06, floorY + 0.2);
  sh.lineTo(dashBackF, dashTop - 0.14);
  sh.quadraticCurveTo(dashBackF, dashTop, dashBackF + 0.08, dashTop);
  sh.lineTo(wbF - 0.04, wbY - 0.03);
  sh.lineTo(wbF - 0.02, floorY + 0.2);
  sh.lineTo(dashBackF + 0.06, floorY + 0.2);
  {
    const g = new THREE.ExtrudeGeometry(sh, { depth: 2 * IW, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2, curveSegments: 6 });
    g.rotateY(Math.PI / 2); g.translate(-IW, 0, 0);
    K('dash').addGeometry(g);
  }
  // غطا العدادات
  const tilt = -0.5;
  const binF = dashBackF + 0.1, binY = dashTop + 0.03;
  K('dash').addGeometry(new RoundedBoxGeometry(0.52, 0.17, 0.2, 3, 0.04), M4(DX, binY, z(binF), tilt));
  const faceY = binY + 0.1 * Math.sin(-tilt) + 0.004, faceZ = z(binF) + 0.1 * Math.cos(tilt) + 0.004;
  const gauges = {};
  for (const [kind, dx, r] of [['rpm', -0.15, 0.05], ['speed', 0, 0.066], ['fuel', 0.145, 0.042]]) {
    const gm = new THREE.MeshStandardMaterial({ map: makeGauge2(kind), emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.35 });
    gm.emissiveMap = gm.map;
    const h = new THREE.Group();
    h.position.set(DX + dx, faceY, faceZ); h.rotation.x = tilt;
    h.add(new THREE.Mesh(new THREE.CircleGeometry(r, 32), gm));
    h.add(new THREE.Mesh(new THREE.TorusGeometry(r + 0.004, 0.004, 6, 32), mats.chrome));
    const pivot = new THREE.Group(); pivot.position.z = 0.004;
    pivot.add(new THREE.Mesh(new THREE.BoxGeometry(0.004, r * 0.85, 0.002).translate(0, r * 0.38, 0), new THREE.MeshStandardMaterial({ color: 0xff4a10, emissive: 0xff3a00, emissiveIntensity: 0.7 })));
    h.add(pivot);
    group.add(h);
    gauges[kind] = { pivot, mat: gm };
  }
  rig.gauges = gauges;
  // شاشة D/N/R
  {
    const c = canvas(64, 32), gt = tex(c, { repeat: false });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.045, 0.022), new THREE.MeshBasicMaterial({ map: gt }));
    const h = new THREE.Group(); h.position.set(DX, faceY - 0.05, faceZ + 0.025); h.rotation.x = tilt; h.add(plane); group.add(h);
    rig.gearDisplay = { set(mode) { const ctx = c.getContext('2d'); ctx.fillStyle = '#0a1a10'; ctx.fillRect(0, 0, 64, 32); ctx.fillStyle = mode === 'R' ? '#ff6040' : '#70ff90'; ctx.font = 'bold 26px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(mode, 32, 17); gt.needsUpdate = true; } };
    rig.gearDisplay.set('D');
  }
  // كونسول + شاشة + تكييف + زرار انتظار
  const CF = dashBackF - 0.005;
  box('dash', -0.06, floorY + 0.25, z(CF + 0.03), 0.30, dashTop - 0.02, z(CF));
  {
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.1), new THREE.MeshStandardMaterial({ color: 0x0b1a2a, emissive: 0x3070c0, emissiveIntensity: 0.35, roughness: 0.15 }));
    scr.position.set(0.12, dashTop - 0.12, z(CF) + 0.002); group.add(scr); rig.screen = scr.material;
  }
  for (const x of [-0.03, 0.27]) for (let i = 0; i < 3; i++) box('plasticBlack', x - 0.025, dashTop - 0.16 + i * 0.03, z(CF - 0.002), x + 0.025, dashTop - 0.145 + i * 0.03, z(CF - 0.008));
  box('tail', 0.105, dashTop - 0.2, z(CF - 0.002), 0.135, dashTop - 0.18, z(CF - 0.01));
  for (const x of [0.04, 0.12, 0.2]) K('plasticBlack').addGeometry(new THREE.CylinderGeometry(0.02, 0.02, 0.02, 14).rotateX(Math.PI / 2), M4(x, dashTop - 0.27, z(CF - 0.01)));
  // الفتيس على التابلوه
  const gate = new THREE.Mesh(new THREE.PlaneGeometry(0.045, 0.18), new THREE.MeshStandardMaterial({ map: makeShiftGate(), roughness: 0.6 }));
  gate.position.set(-0.11, dashTop - 0.2, z(CF) + 0.004); gate.rotation.x = -0.2; group.add(gate);
  const gearBase = new THREE.Group();
  gearBase.position.set(-0.105, dashTop - 0.2, z(CF) + 0.012);
  const gearLever = new THREE.Group();
  gearLever.add(new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.13, 8).rotateX(Math.PI / 2).translate(0, 0, 0.065), mats.chrome));
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.026, 14, 10).scale(0.9, 1.25, 1), new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.35 }));
  knob.position.set(0, 0.014, 0.14); gearLever.add(knob);
  gearBase.add(gearLever); group.add(gearBase);
  rig.gearLever = gearLever;
  rig.gearGate = { base: gearBase, top: dashTop - 0.2 + 0.08, step: 0.025 };

  // ===== الدركسيون (مايل زي الأتوبيس، كابينة فوق الموتور) =====
  const swF = dashBackF - 0.18, swY = dashTop - 0.06;
  const swTilt = new THREE.Group();
  swTilt.position.set(DX, swY, z(swF));
  swTilt.rotation.x = -0.95;
  const steering = new THREE.Group();
  swTilt.add(steering);
  {
    const swMat = new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.6 });
    steering.add(new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.018, 12, 48), swMat));
    const hub = new THREE.Mesh(new RoundedBoxGeometry(0.14, 0.11, 0.06, 4, 0.03), swMat); hub.position.set(0, -0.01, 0.025); steering.add(hub);
    for (const [x, y, w, h, rz] of [[-0.12, -0.02, 0.09, 0.034, 0.08], [0.12, -0.02, 0.09, 0.034, -0.08], [0, -0.12, 0.04, 0.1, 0]]) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.02), swMat); sp.position.set(x, y, 0.012); sp.rotation.z = rz; steering.add(sp);
    }
    const mark = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.028, 0.04), new THREE.MeshStandardMaterial({ color: 0xc8a050, roughness: 0.4, metalness: 0.5 }));
    mark.position.set(0, 0.19, 0); steering.add(mark);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.34, 10).rotateX(Math.PI / 2), mats.dash);
    col.position.z = -0.19; swTilt.add(col);
    steering.traverse((o) => { o.castShadow = true; });
  }
  group.add(swTilt);
  rig.steering = steering;

  // ===== الدواسات =====
  const pedals = {};
  const pm = new THREE.MeshStandardMaterial({ color: 0x2d2d2d, roughness: 0.6, metalness: 0.4 });
  for (const [name, x, w, h] of [['brake', DX - 0.04, 0.11, 0.08], ['gas', DX + 0.15, 0.06, 0.14]]) {
    const p = new THREE.Group();
    p.position.set(x, floorY + 0.35, z(dashBackF + 0.22));
    p.add(new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.26, 0.018).translate(0, -0.13, 0), pm));
    const pad = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.02), pm); pad.position.set(0, -0.27, -0.01); p.add(pad);
    p.rotation.x = -0.4; group.add(p); pedals[name] = p;
  }
  rig.pedals = pedals;

  // ===== الكراسي + غطا الموتور =====
  if (!mats.seat) { mats.seat = new THREE.MeshStandardMaterial({ map: makeSeatFabric(), roughness: 0.95 }); }
  const seatF = swF - 0.42;
  const seat = (x, f, w, back = true, bh = 0.62) => {
    const m = M4(x, 0, z(f));
    K('seat').addGeometry(new RoundedBoxGeometry(w, 0.12, 0.46, 3, 0.04), new THREE.Matrix4().multiplyMatrices(m, M4(0, floorY + 0.36, 0)));
    if (back) K('seat').addGeometry(new RoundedBoxGeometry(w, bh, 0.1, 3, 0.04), new THREE.Matrix4().multiplyMatrices(m, M4(0, floorY + 0.41 + bh / 2, 0.25, 0.14)));
    K('dash').addGeometry(new THREE.BoxGeometry(w * 0.8, 0.3, 0.34), new THREE.Matrix4().multiplyMatrices(m, M4(0, floorY + 0.15, 0)));
  };
  seat(DX, seatF, 0.48);
  K('seat').addGeometry(new RoundedBoxGeometry(0.44, 0.18, 0.08, 3, 0.04), M4(DX, floorY + 1.12, z(seatF - 0.29), 0.14));
  seat(IW * 0.55, seatF, IW * 0.8);
  K('trim').addGeometry(new RoundedBoxGeometry(0.3, 0.44, 0.7, 3, 0.06), M4(-0.02, floorY + 0.22, z(seatF + 0.05)));
  for (let f = seatF - 0.8; f > D.rearF + 0.55; f -= 0.78) { seat(-IW * 0.32, f, IW * 1.3, true, 0.48); seat(IW * 0.74, f, IW * 0.46, true, 0.48); }
  // فرامل اليد
  const hb = new THREE.Group();
  hb.position.set(DX + 0.28, floorY + 0.46, z(seatF + 0.05));
  hb.add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.028, 0.28).translate(0, 0, -0.14), mats.plasticBlack));
  hb.add(new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.1, 8).rotateX(Math.PI / 2).translate(0, 0, -0.24), mats.dash));
  hb.rotation.x = 0.12; group.add(hb); rig.handbrake = hb;

  // ===== زينة: شرّابة فوق الزجاج + سبحة =====
  const fr = new GeoBuilder();
  fr.setColor([0.55, 0.05, 0.08]);
  fr.box(-D.wsHalf + 0.02, wtY - 0.05, z(wtF + 0.03), D.wsHalf - 0.02, wtY - 0.015, z(wtF));
  for (let x = -D.wsHalf + 0.04; x < D.wsHalf - 0.03; x += 0.06) {
    fr.setColor(Math.round(x * 16) % 3 === 0 ? [0.85, 0.65, 0.15] : [0.6, 0.05, 0.1]);
    fr.addGeometry(new THREE.CylinderGeometry(0.004, 0.008, 0.04, 5), M4(x, wtY - 0.07, z(wtF + 0.02)));
  }
  group.add(new THREE.Mesh(fr.build(), mats.decor));
  // مراية جوه
  K('plasticBlack').addGeometry(new THREE.CylinderGeometry(0.008, 0.008, 0.08, 6), M4(0, wtY - 0.05, z(wtF - 0.03)));
  {
    const h = new THREE.Group();
    h.position.set(0, wtY - 0.12, z(wtF - 0.04));
    const house = new THREE.Mesh(new RoundedBoxGeometry(0.25, 0.075, 0.028, 2, 0.012), mats.plasticBlack);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.23, 0.06), mats.mirrorDark);
    face.position.z = 0.015;
    h.add(house, face); group.add(h);
    rig.mirrors.push({ holder: h, face, side: 0, aspect: 0.23 / 0.06, fov: 13, hiace: true });
  }
  const sebha = new THREE.Group();
  sebha.position.set(0, wtY - 0.16, z(wtF - 0.05));
  {
    const bead = new THREE.SphereGeometry(0.0055, 8, 6), g = new GeoBuilder();
    g.setColor([0.75, 0.42, 0.08]);
    for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; g.addGeometry(bead, M4(Math.sin(a) * 0.026, -0.05 - 0.05 * (1 - Math.cos(a)), 0)); }
    g.setColor([0.12, 0.3, 0.7]); g.addGeometry(new THREE.SphereGeometry(0.01, 12, 8), M4(0, -0.16, 0));
    sebha.add(new THREE.Mesh(g.build(), mats.decor));
  }
  group.add(sebha); rig.sebha = sebha;
  // حاجات التابلوه + العين الزرقا
  const acc = addCabAccessories(group, { DX, IW, dashTop, dashBackF, wbF, wbY, wtF, wtY, floorY, z });
  rig.hangers = [{ obj: sebha, L: 0.2 }, ...acc.hangers];
  rig.phoneScreen = acc.phoneScreen;
  // شماسات
  for (const sx of [-1, 1]) K('beige').addGeometry(new RoundedBoxGeometry(0.42, 0.018, 0.16, 2, 0.008), M4(sx * IW * 0.5, wtY - 0.04, z(wtF - 0.1), 0.4));

  // ===== عين السواق: ورا الدركسيون وناحية الشمال =====
  const eye = new THREE.Object3D();
  eye.position.set(DX, Math.min(D.roofY - 0.3, floorY + 1.04), z(seatF + 0.04));
  group.add(eye);
  rig.eye = eye;
  rig.eyePitch = -0.24;

  if (!mats.beige) mats.beige = new THREE.MeshStandardMaterial({ color: 0xcfc6b2, roughness: 0.9, vertexColors: true });
  for (const [k, gb] of kit) {
    if (gb.empty) continue;
    const mesh = new THREE.Mesh(gb.build(), mats[k]);
    mesh.name = k; mesh.castShadow = k !== 'beige'; mesh.receiveShadow = true;
    group.add(mesh);
  }
}

/** يخلّي كل مثلث وشه لبره (بالنسبة لمركز العربية) ويصحح الـ normals على كده */
function orientOutward(mesh, holder, c, h) {
  const g = mesh.geometry;
  if (!g.index) return;
  mesh.updateWorldMatrix(true, false);
  const rel = new THREE.Matrix4().copy(holder.matrixWorld).invert().multiply(mesh.matrixWorld);
  const P = g.attributes.position, N = g.attributes.normal;
  const idx = g.index.array;
  const W = new Float32Array(P.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i).applyMatrix4(rel); W[i * 3] = v.x; W[i * 3 + 1] = v.y; W[i * 3 + 2] = v.z; }
  const det = rel.determinant() < 0 ? -1 : 1;
  const out = new Float32Array(P.count * 3);
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, cc = idx[i + 2] * 3;
    const ux = W[b] - W[a], uy = W[b + 1] - W[a + 1], uz = W[b + 2] - W[a + 2];
    const vx = W[cc] - W[a], vy = W[cc + 1] - W[a + 1], vz = W[cc + 2] - W[a + 2];
    let fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    // اتجاه "لبره": من مركز العربية (شكل صندوق ناعم)
    const mx = (W[a] + W[b] + W[cc]) / 3 - c.x, my = (W[a + 1] + W[b + 1] + W[cc + 1]) / 3 - c.y, mz = (W[a + 2] + W[b + 2] + W[cc + 2]) / 3 - c.z;
    const ox = Math.sign(mx) * Math.pow(Math.abs(mx) / h.x, 6), oy = Math.sign(my) * Math.pow(Math.abs(my) / h.y, 6), oz = Math.sign(mz) * Math.pow(Math.abs(mz) / h.z, 6);
    if ((fx * ox + fy * oy + fz * oz) * det < 0) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; fx = -fx; fy = -fy; fz = -fz; }
    for (const k of [idx[i] * 3, idx[i + 1] * 3, idx[i + 2] * 3]) { out[k] += fx; out[k + 1] += fy; out[k + 2] += fz; }
  }
  g.index.needsUpdate = true;
  // الـ normals: نخليها في نفس اتجاه الأسطح (بنقلبها لو كانت لجوه)
  const inv = new THREE.Matrix3().getNormalMatrix(rel).invert();
  const nn = new THREE.Vector3(), fo = new THREE.Vector3();
  for (let i = 0; i < P.count; i++) {
    nn.fromBufferAttribute(N, i).applyMatrix3(new THREE.Matrix3().getNormalMatrix(rel));
    fo.set(out[i * 3], out[i * 3 + 1], out[i * 3 + 2]);
    if (fo.lengthSq() > 0 && nn.dot(fo) * det < 0) N.setXYZ(i, -N.getX(i), -N.getY(i), -N.getZ(i));
  }
  void inv;
  N.needsUpdate = true;
}

/** يمسح المثلثات اللي مركزها جوه صندوق (في إحداثيات الـ holder) */
function clipInside(mesh, holder, box) {
  const g = mesh.geometry;
  if (!g.index) return 0;
  mesh.updateWorldMatrix(true, false);
  const rel = new THREE.Matrix4().copy(holder.matrixWorld).invert().multiply(mesh.matrixWorld);
  const P = g.attributes.position, idx = g.index.array, keep = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let removed = 0;
  for (let i = 0; i < idx.length; i += 3) {
    a.fromBufferAttribute(P, idx[i]).applyMatrix4(rel); b.fromBufferAttribute(P, idx[i + 1]).applyMatrix4(rel); c.fromBufferAttribute(P, idx[i + 2]).applyMatrix4(rel);
    a.add(b).add(c).multiplyScalar(1 / 3);
    if (box.some((bx) => bx.containsPoint(a))) { removed++; continue; }
    keep.push(idx[i], idx[i + 1], idx[i + 2]);
  }
  if (removed) g.setIndex(keep);
  return removed;
}
