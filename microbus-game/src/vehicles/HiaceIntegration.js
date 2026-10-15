import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GeoBuilder } from '../render/GeoBuilder.js';
import { addEyeCharm, addBobbleDog } from './CabAccessories.js';
import { DashScreen, drawVanLCD, drawNavScreen } from './Cockpits.js';
import { tireGeometry } from './wheel.js';
import { toCreasedNormals, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvas, tex, makeSeatFabric, makeGauge2, makeShiftGate, tileNoise, heightToNormal, rng } from '../render/textures.js';

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
    // الجنط من الموديل (المثلثات اللي جوه نص قطر الجنط) + كاوتش جديد عالي التفاصيل حواليه
    const R = spec.wheelRadius, rimR = R * 0.64;
    const rim = keepInside(g, rimR + 0.012);
    const wid = src.w * 0.98;
    const rm = new THREE.Mesh(rim, src.mesh.material);
    rm.castShadow = true; rm.receiveShadow = true; rm.userData.role = 'rim';
    const tireMat = (rig.mats.hiTire ||= new THREE.MeshStandardMaterial({ color: 0x1d1d1e, roughness: 0.88, normalMap: rig.mats.tire?.normalMap || null, normalScale: new THREE.Vector2(0.45, 0.45) }));
    const tire = new THREE.Mesh(tireGeometry(R, wid, rimR, 48), tireMat);
    tire.castShadow = true; tire.receiveShadow = true; tire.userData.role = 'tire';
    // جوه الجنط غامق (مش فاضي)
    const back = new THREE.Mesh(new THREE.CircleGeometry(rimR, 32).rotateY(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.8, side: THREE.DoubleSide }));
    const sideIn = Math.sign(pos[w.id][0]) * -1; // ناحية جوه العربية
    back.position.x = sideIn * wid * 0.25;
    w.spin.add(tire, rm, back);
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
      mat.color = new THREE.Color(0x5a5a5a); // التلبيس الأسود كان باين رمادي باهت
      mat.side = THREE.DoubleSide; mat.polygonOffset = true; mat.polygonOffsetFactor = 1; mat.polygonOffsetUnits = 2; mat.needsUpdate = true;
    }
    if (n === 'glass2') {
      // الزجاج الأمامي: شفاف جدًا عشان السواق يشوف كويس
      // ده في الحقيقة إطار الزجاج (جلدة سودا)
      o.material = new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.6, side: THREE.DoubleSide });
      o.userData.role = 'trim';
    } else if (n === 'glass') {
      o.material = new THREE.MeshPhysicalMaterial({ color: 0x1c2a2e, transparent: true, opacity: 0.42, roughness: 0.02, metalness: 0, envMapIntensity: 2.2, depthWrite: false, side: THREE.DoubleSide, specularIntensity: 1 });
      o.castShadow = false; o.renderOrder = 2; o.userData.role = 'glass';
    } else if (n === 'paint') {
      // دهان أبيض بطبقة ورنيش (clearcoat) زي العربيات الحقيقية
      const pm = new THREE.MeshPhysicalMaterial({ map: mat.map, color: 0xf3f1ec, roughness: 0.38, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.07, envMapIntensity: 1.25, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
      o.material = pm; o.userData.role = 'paint';
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

  // ===== الزجاج الأمامي: في الموديل هو نفس خامة الشبابيك الغامقة → بنفصله ونخليه شفاف جدًا =====
  {
    const ws = extractRegion(rig, holder, (p, n) => p.z < -(frontF - 1.15) && p.y > 1.0 && Math.abs(n.z) > 0.35, 'windshield', /^glass$/);
    const wsMat = new THREE.MeshPhysicalMaterial({ color: 0xd9ece6, transparent: true, opacity: 0.07, roughness: 0.03, metalness: 0, envMapIntensity: 0.9, depthWrite: false, side: THREE.DoubleSide, specularIntensity: 1 });
    ws.group.traverse((o) => { if (o.isMesh) { o.material = wsMat; o.userData.role = 'windshield'; o.renderOrder = 2; o.castShadow = false; } });
    rig.windshieldGroup = ws.group;
  }

  // ===== الباب الجرار (يمين): بنفصل مثلثاته من الموديل عشان يتفتح ويتقفل بجد =====
  rig.slidingDoor = extractSlidingDoor(rig, holder, HW);
  // الإكصدامات منفصلة عشان تتدلدل لما تتخبط جامد
  rig.bumpers = {
    front: extractRegion(rig, holder, (p) => p.z < -(frontF - 0.3) && p.y < 0.6 && p.y > 0.08, 'bumper-front'),
    rear: extractRegion(rig, holder, (p) => p.z > -rearF - 0.26 && p.y < 0.58 && p.y > 0.08, 'bumper-rear'),
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
    rig.mirrors.push({ holder: holderM, face, side: sx, aspect: w / h, fov: 27 }); // مراية مسطحة بزاوية أوسع شوية زي مرايات الميكروباص الحقيقية
  }

  // ===== الشاسيه من تحت (الموديل مفتوح من تحت: بيبان لما العربية تتقلب) =====
  {
    const u = new GeoBuilder();
    const L0 = -frontF + 0.25, L1 = -rearF - 0.25, y = 0.3;
    u.setColor([0.16, 0.16, 0.17]);
    u.box(-HW + 0.06, y - 0.02, L0, HW - 0.06, y, L1);
    u.setColor([0.08, 0.08, 0.09]);
    for (const x of [-0.42, 0.42]) u.box(x - 0.05, y - 0.12, L0 + 0.1, x + 0.05, y - 0.02, L1 - 0.1); // شاسيه طولي
    u.setColor([0.25, 0.24, 0.23]);
    u.addGeometry(new THREE.CylinderGeometry(0.05, 0.05, frontF - rearF - 1.2, 8).rotateX(Math.PI / 2), new THREE.Matrix4().makeTranslation(0.1, y - 0.12, (L0 + L1) / 2)); // عمود الكردان
    u.addGeometry(new THREE.CylinderGeometry(0.035, 0.04, frontF - rearF - 0.6, 8).rotateX(Math.PI / 2), new THREE.Matrix4().makeTranslation(-0.35, y - 0.1, (L0 + L1) / 2 + 0.2)); // الشكمان
    const under = new THREE.Mesh(u.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.2 }));
    under.name = 'underbody';
    rig.shell.add(under);
  }

  // ===== فوانيس الفرامل (مستطيلات حمرا مضيئة فوق فوانيس الموديل) =====
  const tail = new THREE.MeshStandardMaterial({ color: 0x5a0000, emissive: 0xff1a0a, emissiveIntensity: 0.0, transparent: true, opacity: 0.85, roughness: 0.3, depthWrite: false });
  for (const sx of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.36), tail);
    p.position.set(sx * (HW - 0.07), 0.82, -rearF + 0.012);
    rig.shell.add(p);
    (rig.tailPlanes ||= {})[sx] = p;
  }
  rig.lights = { head: { set emissiveIntensity(v) { for (const m of lightsMats) m.emissiveIntensity = v * 0.35; } }, tail, indicator: null, fog: null };
  rig.lights.head.emissiveIntensity = 0;

  // ضل ناعم تحت العربية على المقاس
  // ضل تلامس (AO) واقعي: مستطيل ناعم على مقاس الأرضية بالظبط + بقعة غامقة تحت كل كاوتش.
  // الضل الحقيقي من الشمس بيجي من shadow map؛ ده بس الضلمة اللي تحت العربية.
  if (rig.contactShadow) {
    const c = canvas(128, 256), x = c.getContext('2d');
    const img = x.createImageData(128, 256);
    for (let j = 0; j < 256; j++) for (let i = 0; i < 128; i++) {
      const u = Math.abs(i / 127 - 0.5) * 2, v = Math.abs(j / 255 - 0.5) * 2;
      const d = Math.max(0, Math.hypot(Math.max(0, u - 0.55) / 0.45, Math.max(0, v - 0.72) / 0.28));
      const a = Math.max(0, 1 - d) ** 1.6;
      img.data.set([255, 255, 255, Math.round(a * 255)], (j * 128 + i) * 4);
    }
    x.putImageData(img, 0, 0);
    const t = tex(c, { srgb: false, repeat: false });
    const m = rig.contactShadow;
    m.geometry.dispose();
    m.geometry = new THREE.PlaneGeometry(HW * 2 - 0.02, frontF - rearF - 0.1).rotateX(-Math.PI / 2);
    m.geometry.translate(0, 0, -(frontF + rearF) / 2 + (-spec._cgZ ? 0 : 0));
    m.material = new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: t, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    m.scale.set(1, 1, 1);
    // تحت الكاوتش
    const blobT = (() => {
      const cc = canvas(64, 64), xx = cc.getContext('2d'), g = xx.createRadialGradient(32, 32, 2, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.5, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      xx.fillStyle = g; xx.fillRect(0, 0, 64, 64); return tex(cc, { srgb: false, repeat: false });
    })();
    const bm = new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: blobT, transparent: true, opacity: 0.75, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -5 });
    rig.wheelShadows = rig.wheels.map((w) => {
      const b = new THREE.Mesh(new THREE.PlaneGeometry(spec.wheelRadius * 0.9 + 0.12, spec.wheelRadius * 1.6).rotateX(-Math.PI / 2), bm.clone());
      b.position.set(w.group.position.x, 0.02, w.group.position.z);
      b.renderOrder = 2;
      rig.root.add(b);
      return b;
    });
  }
  rig.dims = D;
  // تنعيم كل حواف الجسم (بعد ما خلصنا فصل الباب والإكصدامات اللي محتاجة index)
  smoothShell(rig.shell);
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

  // خامات الكابينة (من صورة كابينة الميكروباص المرجعية): تابلوه رمادي بلونين — فوق غامق وتحت فاتح،
  // عمود A رمادي تخين، تجاليد أبواب رمادي، ولمسات فضي (حلقات العدادات وأذرع الدركسيون)
  if (!mats.dashGrain) {
    const N = 128, h = tileNoise(N, [16, 32, 64], rng(77), [0.3, 0.4, 0.3]);
    mats.dashGrain = tex(heightToNormal(h, N, N, 1.6), { srgb: false });
    mats.dashGrain.repeat.set(6, 6);
    const grain = (color, roughness, ns, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, normalMap: mats.dashGrain, normalScale: new THREE.Vector2(ns, ns), ...extra });
    mats.dash = grain(0x2c2d30, 0.82, 0.45, { vertexColors: true });
    mats.dashUp = grain(0x4e5054, 0.8, 0.45);
    mats.dashLow = grain(0x9a9995, 0.74, 0.3);
    mats.pillarTrim = grain(0x7a7975, 0.88, 0.3);
    mats.doorCard = grain(0x8b8a86, 0.86, 0.35, { vertexColors: true });
    mats.silver = new THREE.MeshStandardMaterial({ color: 0x9ba1a7, roughness: 0.36, metalness: 0.85 });
    mats.knob = new THREE.MeshStandardMaterial({ color: 0x1a1b1d, roughness: 0.45 });
    mats.lit = new THREE.MeshStandardMaterial({ color: 0x1a1b1d, roughness: 0.5, emissive: 0x3a8cff, emissiveIntensity: 0 });
    mats.hazard = new THREE.MeshStandardMaterial({ color: 0xc81e1e, roughness: 0.4, emissive: 0xff2a1a, emissiveIntensity: 0.15 });
  }

  // ===== التابلوه: سطح فوق غامق (حرفه طالع ناحية السواق) + وش تحت رمادي فاتح =====
  const dashExtrude = (k, pts) => {
    const sh = new THREE.Shape();
    pts.forEach(([u, v], i) => (i ? sh.lineTo(u, v) : sh.moveTo(u, v)));
    sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: 2 * IW, bevelEnabled: true, bevelSize: 0.01, bevelThickness: 0.01, bevelSegments: 2, curveSegments: 6 });
    g.rotateY(Math.PI / 2); g.translate(-IW, 0, 0);
    K(k).addGeometry(g);
  };
  const lipY = dashTop - 0.12;
  dashExtrude('dashUp', [[dashBackF + 0.03, lipY], [dashBackF - 0.005, lipY + 0.05], [dashBackF - 0.005, dashTop - 0.03], [dashBackF + 0.02, dashTop - 0.003],
    [dashBackF + 0.08, dashTop], [wbF - 0.04, wbY - 0.03], [wbF - 0.02, lipY]]);
  dashExtrude('dashLow', [[dashBackF + 0.075, floorY + 0.2], [dashBackF + 0.03, lipY], [wbF - 0.02, lipY], [wbF - 0.02, floorY + 0.2]]);
  // نقطة على الوش اللي تحت (مايل: فوق أقرب للسواق)
  const lowF = (y) => dashBackF + 0.03 + 0.045 * THREE.MathUtils.clamp((lipY - y) / (lipY - floorY - 0.2), 0, 1);
  const lowTilt = Math.atan2(0.045, lipY - floorY - 0.2);

  // ===== العدادات: عدادين كبار مدورين (لفّات شمال، سرعة يمين) وبينهم شاشة صغيرة، تحت حاجب =====
  const tilt = -0.5;
  const binF = dashBackF + 0.1, binY = dashTop + 0.035;
  const binM = M4(DX, binY, z(binF), tilt);
  K('dashUp').addGeometry(new RoundedBoxGeometry(0.46, 0.18, 0.2, 3, 0.045), binM);
  K('dashUp').addGeometry(new RoundedBoxGeometry(0.47, 0.024, 0.1, 2, 0.01), binM.clone().multiply(M4(0, 0.088, 0.1)));
  K('plasticBlack').addGeometry(new RoundedBoxGeometry(0.42, 0.15, 0.004, 2, 0.002), binM.clone().multiply(M4(0, -0.004, 0.1005)));
  const clusterG = new THREE.Group();
  clusterG.position.set(DX, binY, z(binF)); clusterG.rotation.x = tilt;
  group.add(clusterG);
  const needleMat = new THREE.MeshStandardMaterial({ color: 0xff5a1a, emissive: 0xff3a00, emissiveIntensity: 0.7 });
  const gauges = {};
  for (const [kind, dx, r, max] of [['rpm', -0.112, 0.067, 5000], ['speed', 0.112, 0.067, 180]]) {
    const gm = new THREE.MeshStandardMaterial({ map: makeGauge2(kind), emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.35 });
    gm.emissiveMap = gm.map;
    const h = new THREE.Group();
    h.position.set(dx, -0.004, 0.104);
    h.add(new THREE.Mesh(new THREE.CircleGeometry(r, 40), gm));
    h.add(new THREE.Mesh(new THREE.TorusGeometry(r + 0.005, 0.005, 8, 40), mats.silver));
    const pivot = new THREE.Group(); pivot.position.z = 0.004;
    pivot.add(new THREE.Mesh(new THREE.BoxGeometry(0.004, r * 0.85, 0.002).translate(0, r * 0.38, 0), needleMat));
    h.add(pivot);
    clusterG.add(h);
    gauges[kind] = { pivot, mat: gm, max };
  }
  rig.gauges = gauges;
  const lcd = new DashScreen(128, 160, drawVanLCD, { fps: 8, emissive: 0.8 });
  const lcdMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.0875), lcd.mat);
  lcdMesh.position.set(0, -0.004, 0.104); clusterG.add(lcdMesh);

  // ===== الكونسول اللي في النص: شاشة خريطة + فتحتين تكييف + زرار الانتظار + 3 مفاتيح تكييف + الفتيس =====
  const podX = 0.07, podY = dashTop - 0.2, podF = dashBackF + 0.02, podTilt = -0.22;
  const podM = M4(podX, podY, z(podF), podTilt);
  const onPod = (x, y, d = 0) => podM.clone().multiply(M4(x, y, 0.07 + d));
  const pod = new THREE.Group();
  pod.position.set(podX, podY, z(podF)); pod.rotation.x = podTilt;
  group.add(pod);
  K('dashUp').addGeometry(new RoundedBoxGeometry(0.46, 0.36, 0.14, 3, 0.03), podM);
  K('plasticBlack').addGeometry(new RoundedBoxGeometry(0.25, 0.155, 0.014, 2, 0.006), onPod(0, 0.085, 0.004));
  const nav = new DashScreen(320, 200, (x, W, H, s) => drawNavScreen(x, W, H, s, '#0d8f86', 'ميكروباص شبين', 'مستني ركاب'), { fps: 5, emissive: 0.8 });
  const navMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.224, 0.14), nav.mat);
  navMesh.position.set(0, 0.085, 0.07 + 0.0115); pod.add(navMesh);
  for (const sx of [-1, 1]) {
    K('plasticBlack').addGeometry(new RoundedBoxGeometry(0.075, 0.13, 0.012, 2, 0.006), onPod(sx * 0.185, 0.085, 0.003));
    for (let i = 0; i < 5; i++) K('silver').addGeometry(new THREE.BoxGeometry(0.062, 0.005, 0.006), onPod(sx * 0.185, 0.035 + i * 0.025, 0.01));
  }
  K('hazard').addGeometry(new RoundedBoxGeometry(0.05, 0.026, 0.014, 2, 0.006), onPod(0, -0.02, 0.006));
  for (const sx of [-1, 1]) K('lit').addGeometry(new RoundedBoxGeometry(0.045, 0.022, 0.012, 2, 0.005), onPod(sx * 0.075, -0.02, 0.005));
  {
    const knobGeo = new THREE.CylinderGeometry(0.024, 0.026, 0.024, 20).rotateX(Math.PI / 2);
    const ringGeo = new THREE.TorusGeometry(0.028, 0.003, 6, 24);
    for (const x of [-0.09, 0.01, 0.11]) { K('knob').addGeometry(knobGeo, onPod(x, -0.095, 0.012)); K('silver').addGeometry(ringGeo, onPod(x, -0.095, 0.002)); }
  }
  K('plasticBlack').addGeometry(new THREE.BoxGeometry(0.14, 0.012, 0.006), onPod(0.05, -0.15, 0.002));
  // الفتيس (أوتوماتيك على الكونسول تحت شمال): لوحة P R N D 3 2 L وذراع بيتحرك عليها
  const gateH = 0.13, gateY = -0.09, gateX = -0.185;
  const gate = new THREE.Mesh(new THREE.PlaneGeometry(0.036, gateH), new THREE.MeshStandardMaterial({ map: makeShiftGate(), roughness: 0.6 }));
  gate.position.set(gateX, gateY, 0.0715); pod.add(gate);
  const gearBase = new THREE.Group();
  const gTop = gateY + gateH / 2 - gateH * 26 / 256, gStep = gateH * 33 / 256;
  gearBase.position.set(gateX + 0.006, gTop - 3 * gStep, 0.078);
  const gearLever = new THREE.Group();
  gearLever.add(new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.009, 0.11, 8).rotateX(Math.PI / 2).translate(0, 0, 0.055), mats.chrome));
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.024, 14, 10).scale(0.9, 1.25, 1), mats.knob);
  knob.position.set(0, 0.012, 0.12); gearLever.add(knob);
  gearBase.add(gearLever); pod.add(gearBase);
  rig.gearLever = gearLever;
  rig.gearGate = { base: gearBase, top: gTop, step: gStep };

  // ===== فتحات تكييف مدورة على أطراف التابلوه + مفتاح النور + الدرج =====
  {
    const ring = new THREE.TorusGeometry(0.043, 0.008, 8, 28), disc = new THREE.CircleGeometry(0.042, 24), slat = new THREE.BoxGeometry(0.07, 0.006, 0.006);
    for (const sx of [-1, 1]) {
      const vm = M4(sx * (IW - 0.1), dashTop - 0.062, z(dashBackF - 0.016));
      K('silver').addGeometry(ring, vm);
      K('plasticBlack').addGeometry(disc, vm.clone().multiply(M4(0, 0, -0.004)));
      for (const dy of [-0.02, 0, 0.02]) K('plasticBlack').addGeometry(slat, vm.clone().multiply(M4(0, dy, 0.002)));
    }
    const ly = lipY - 0.12, lm = M4(DX - 0.3, ly, z(lowF(ly)) + 0.008, lowTilt);
    K('knob').addGeometry(new THREE.CylinderGeometry(0.026, 0.028, 0.02, 18).rotateX(Math.PI / 2), lm);
    K('silver').addGeometry(new THREE.TorusGeometry(0.03, 0.003, 6, 24), lm);
    const gy = lipY - 0.13;
    K('dashLow').addGeometry(new RoundedBoxGeometry(0.42, 0.17, 0.02, 2, 0.008), M4(0.47, gy, z(lowF(gy)) + 0.008, lowTilt));
    K('plasticBlack').addGeometry(new RoundedBoxGeometry(0.1, 0.02, 0.016, 2, 0.006), M4(0.47, gy + 0.055, z(lowF(gy + 0.055)) + 0.02, lowTilt));
  }

  // ===== الدركسيون: 4 أذرع فضي (اتنين بالعرض واتنين تحت على شكل V)، مايل زي الفان =====
  const swF = dashBackF - 0.18, swY = dashTop - 0.06;
  const swTilt = new THREE.Group();
  swTilt.position.set(DX, swY, z(swF));
  swTilt.rotation.x = -0.95;
  const steering = new THREE.Group();
  swTilt.add(steering);
  {
    const swMat = (mats.swLeather ||= new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.55 }));
    const dark = new GeoBuilder(), sil = new GeoBuilder();
    dark.addGeometry(new THREE.TorusGeometry(0.19, 0.019, 12, 48));
    dark.addGeometry(new RoundedBoxGeometry(0.135, 0.115, 0.06, 4, 0.03), M4(0, -0.012, 0.025));
    sil.addGeometry(new THREE.CylinderGeometry(0.018, 0.018, 0.006, 20).rotateX(Math.PI / 2), M4(0, -0.008, 0.057));
    sil.addGeometry(new THREE.TorusGeometry(0.03, 0.003, 6, 24), M4(0, -0.008, 0.056));
    const spoke = new RoundedBoxGeometry(0.11, 0.03, 0.016, 2, 0.006);
    for (const a of [-0.1, Math.PI + 0.1, -Math.PI / 2 + 0.55, -Math.PI / 2 - 0.55]) sil.addGeometry(spoke, M4(Math.cos(a) * 0.125, Math.sin(a) * 0.125 - 0.008, 0.012, 0, 0, a));
    const rim = new THREE.Mesh(dark.build(), swMat), arms = new THREE.Mesh(sil.build(), mats.silver);
    rim.castShadow = arms.castShadow = true;
    steering.add(rim, arms);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.34, 12).rotateX(Math.PI / 2), mats.dashUp);
    col.position.z = -0.19; swTilt.add(col);
  }
  group.add(swTilt);
  rig.steering = steering;

  // الشاشات بتتحدّث كام مرة في الثانية بس (مش كل فريم) — من PlayerVehicle.syncVisuals
  const st = { gear: 'D', gearN: 1, fuel: 0.6, odo: 214370, hb: false, mapCanvas: null, navTitle: '', navLine: '' };
  rig.cockpit = {
    lcd, nav,
    update(dt, ph, P) {
      st.odo += Math.abs(ph.speed) * dt / 1000;
      st.gear = ph.gearMode; st.gearN = ph.gear; st.hb = ph.handbrake > 0.1;
      st.fuel = P.fuel ? P.fuel.level / P.fuel.capacity : 0.6;
      st.mapCanvas = P.navCanvas; st.navTitle = P.navTitle; st.navLine = P.navLine;
      lcd.update(dt, st); nav.update(dt, st);
    },
    setNight(on) {
      lcd.mat.emissiveIntensity = on ? 1.0 : 0.8; nav.mat.emissiveIntensity = on ? 0.9 : 0.8;
      mats.lit.emissiveIntensity = on ? 0.7 : 0; mats.hazard.emissiveIntensity = on ? 0.5 : 0.15;
    },
  };

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
  // أماكن قعدة الركاب (للـ Passengers): الكنبة الأمامية 2، وكل صف ورا: كنبة 3 + كرسي 1
  const sy = floorY + 0.42;
  rig.paxSeats = [IW * 0.55 - IW * 0.2, IW * 0.55 + IW * 0.2].map((x) => ({ x, y: sy, z: z(seatF) + 0.05 }));
  K('trim').addGeometry(new RoundedBoxGeometry(0.3, 0.44, 0.7, 3, 0.06), M4(-0.02, floorY + 0.22, z(seatF + 0.05)));
  for (let f = seatF - 0.8; f > D.rearF + 0.55; f -= 0.78) {
    seat(-IW * 0.32, f, IW * 1.3, true, 0.48); seat(IW * 0.74, f, IW * 0.46, true, 0.48);
    for (const dx of [-0.34, 0, 0.34]) rig.paxSeats.push({ x: -IW * 0.32 + dx * IW * 1.3 / 1.04, y: sy, z: z(f) + 0.05 });
    rig.paxSeats.push({ x: IW * 0.74, y: sy, z: z(f) + 0.05 });
  }
  // فرامل اليد
  const hb = new THREE.Group();
  hb.position.set(DX + 0.28, floorY + 0.46, z(seatF + 0.05));
  hb.add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.028, 0.28).translate(0, 0, -0.14), mats.plasticBlack));
  hb.add(new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.1, 8).rotateX(Math.PI / 2).translate(0, 0, -0.24), mats.dash));
  hb.rotation.x = 0.12; group.add(hb); rig.handbrake = hb;

  // ===== زينة خفيفة: سبحة + عين زرقا في المراية (التابلوه نضيف زي الصورة المرجعية) =====
  // مراية جوه
  // (مرفوعة لفوق وأصغر شوية: ماتقفلش جزء كبير من الطريق قدام السواق)
  K('plasticBlack').addGeometry(new THREE.CylinderGeometry(0.008, 0.008, 0.05, 6), M4(0, wtY - 0.035, z(wtF - 0.03)));
  {
    const h = new THREE.Group();
    h.position.set(0, wtY - 0.085, z(wtF - 0.04));
    const house = new THREE.Mesh(new RoundedBoxGeometry(0.22, 0.066, 0.028, 2, 0.012), mats.plasticBlack);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.052), mats.mirrorDark);
    face.position.z = 0.015;
    h.add(house, face); group.add(h);
    rig.mirrors.push({ holder: h, face, side: 0, aspect: 0.2 / 0.052, fov: 13, hiace: true });
  }
  const sebha = new THREE.Group();
  sebha.position.set(0, wtY - 0.12, z(wtF - 0.05));
  {
    const bead = new THREE.SphereGeometry(0.0055, 8, 6), g = new GeoBuilder();
    g.setColor([0.75, 0.42, 0.08]);
    for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; g.addGeometry(bead, M4(Math.sin(a) * 0.026, -0.05 - 0.05 * (1 - Math.cos(a)), 0)); }
    g.setColor([0.12, 0.3, 0.7]); g.addGeometry(new THREE.SphereGeometry(0.01, 12, 8), M4(0, -0.16, 0));
    sebha.add(new THREE.Mesh(g.build(), mats.decor));
  }
  group.add(sebha); rig.sebha = sebha;
  rig.hangers = [{ obj: sebha, L: 0.2 }, addEyeCharm(group, { wtF, wtY, z })];
  // الكلب أبو راس بتتهز: على التابلوه يمين العدادات قدام السواق
  rig.bobbles = [addBobbleDog(group, DX + 0.36, dashTop + 0.004, z(dashBackF + 0.16), 0, 1.35)];
  // شماسات
  // الشماسات مرفوعة لفوق ناحية السقف (زي ما السواق بيسيبها) عشان متغطيش الرؤية
  for (const sx of [-1, 1]) K('beige').addGeometry(new RoundedBoxGeometry(0.42, 0.016, 0.16, 2, 0.007), M4(sx * IW * 0.5, D.roofY - 0.1, z(wtF - 0.16), 0.05));

  // ===== تلبيس العواميد (A-pillar) من جوه + تجاليد الأبواب + المساحات =====
  {
    const beam = (p0, p1, w, t, mat, inward) => {
      const a = new THREE.Vector3(...p0), b = new THREE.Vector3(...p1);
      const len = a.distanceTo(b), mid = a.clone().add(b).multiplyScalar(0.5).add(inward);
      const m = new THREE.Mesh(new RoundedBoxGeometry(w, len, t, 2, Math.min(w, t) * 0.45), mat);
      m.position.copy(mid);
      // الوش العريض متوجه ناحية عين السواق (مش ملفوف عشوائي = كان باين زي لوح مكسور)
      const yA = b.clone().sub(a).normalize(), eyeP = new THREE.Vector3(DX, floorY + 1.09, z(seatF + 0.04) + 0.18);
      const toEye = eyeP.sub(mid), zA = toEye.sub(yA.clone().multiplyScalar(toEye.dot(yA))).normalize(), xA = new THREE.Vector3().crossVectors(yA, zA);
      m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xA, yA, zA));
      m.receiveShadow = true;
      group.add(m);
      return m;
    };
    for (const sx of [-1, 1]) {
      const bot = [sx * (D.wsHalf + 0.03), wbY - 0.02, z(wbF + 0.02)], top = [sx * (D.wsHalf - 0.03), wtY - 0.02, z(wtF - 0.02)];
      beam(bot, top, 0.085, 0.035, mats.pillarTrim, new THREE.Vector3(-sx * 0.03, 0, 0.025));
    }
    // تجاليد الأبواب الأمامية (شمال = السواق، يمين = الراكب)
    const sill = wbY - 0.12, dz0 = z(dashBackF + 0.02), dz1 = z(seatF - 0.38);
    const dc = new GeoBuilder();
    for (const sx of [-1, 1]) {
      // جوه الصاج بمسافة (الصاج الخارجي عند HW) عشان التجليد ميطلعش من برا
      const xin = sx * (IW - 0.1), xo = sx * (IW - 0.05);
      dc.setColor([1, 1, 1]);
      dc.box(Math.min(xin, xo), floorY + 0.02, Math.min(dz0, dz1), Math.max(xin, xo), sill, Math.max(dz0, dz1));
      // مسند الإيد + جيب الباب
      dc.setColor([0.7, 0.68, 0.64]);
      dc.box(Math.min(xin, xin - sx * 0.09), sill - 0.36, z(seatF + 0.25), Math.max(xin, xin - sx * 0.09), sill - 0.31, z(seatF - 0.25));
      dc.setColor([0.35, 0.34, 0.33]);
      dc.box(Math.min(xin, xin - sx * 0.05), floorY + 0.12, z(dashBackF - 0.05), Math.max(xin, xin - sx * 0.05), floorY + 0.3, z(seatF + 0.15));
      // حرف الشباك
      dc.setColor([0.25, 0.25, 0.26]);
      dc.box(Math.min(xin, xin - sx * 0.06), sill - 0.03, Math.min(dz0, dz1), Math.max(xin, xin - sx * 0.06), sill + 0.01, Math.max(dz0, dz1));
    }
    const doors = new THREE.Mesh(dc.build(), mats.doorCard);
    doors.receiveShadow = true;
    group.add(doors);
    // سماعة + أوكرة الباب
    for (const sx of [-1, 1]) {
      const spk = new THREE.Mesh(new THREE.CircleGeometry(0.075, 18), new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.7 }));
      spk.position.set(sx * (IW - 0.102), floorY + 0.42, z(dashBackF + 0.12)); spk.rotation.y = -sx * Math.PI / 2;
      group.add(spk);
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 0.12), mats.chrome);
      h.position.set(sx * (IW - 0.115), sill - 0.18, z(seatF + 0.05));
      group.add(h);
    }
    // المساحات (برا على قاعدة الزجاج) — بتبان من كرسي السواق زي الحقيقة
    const wiperMat = new THREE.MeshStandardMaterial({ color: 0x0d0d0e, roughness: 0.55, metalness: 0.4 });
    const wsDir = new THREE.Vector3(0, wtY - wbY, -(wtF - wbF)).normalize();
    for (const [x0, ang] of [[-0.42, 0.18], [0.18, 0.2]]) {
      const arm = new THREE.Group();
      arm.position.set(x0, wbY + 0.03, z(wbF + 0.06));
      arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), wsDir.clone().multiplyScalar(0.12).add(new THREE.Vector3(0, 0, -0.01)).normalize());
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.018, 0.02), wiperMat);
      blade.position.set(0.31, 0, 0); blade.rotation.z = ang;
      arm.add(blade);
      group.add(arm);
    }
  }

  // ===== عين السواق: ورا الدركسيون وناحية الشمال =====
  const eye = new THREE.Object3D();
  eye.position.set(DX, Math.min(D.roofY - 0.3, floorY + 1.04), z(seatF + 0.04) + 0.02); // أقرب للزجاج = الزجاج باين أكبر
  group.add(eye);
  rig.eye = eye;
  rig.eyePitch = -0.17; // السقف مايقفلش الرؤية من فوق والتابلوه باين
  rig.eyeBase = eye.position.clone();

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

/** الباب الجرار في الهاي إس (ناحية الرصيف): مقاسه متقاس من الموديل (إحداثيات الـ shell، قدام = -z) */
const DOOR = { z0: -0.52, z1: 0.77, y0: 0.27, y1: 1.64, inset: 0.16 };

/** بيفصل مثلثات منطقة من الموديل في group لوحدها (الباب الجرار، الإكصدامات) */
function extractRegion(rig, holder, inRegion, name, only = null) {
  rig.shell.updateMatrixWorld(true);
  const toShell = new THREE.Matrix4().copy(rig.shell.matrixWorld).invert();
  const group = new THREE.Group();
  group.name = name;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  let moved = 0;
  holder.traverse((o) => {
    if (!o.isMesh || !o.visible || !o.geometry.index) return;
    const name = (o.userData.matName || '').toLowerCase();
    if (only ? !only.test(name) : /wheel|lights|glass2|logo/.test(name)) return;
    o.updateWorldMatrix(true, false);
    const rel = new THREE.Matrix4().multiplyMatrices(toShell, o.matrixWorld);
    const nm = new THREE.Matrix3().getNormalMatrix(rel);
    const g = o.geometry, P = g.attributes.position, N = g.attributes.normal, UV = g.attributes.uv, idx = g.index.array;
    const keep = [], pos = [], nor = [], uv = [];
    for (let i = 0; i < idx.length; i += 3) {
      a.fromBufferAttribute(P, idx[i]).applyMatrix4(rel); b.fromBufferAttribute(P, idx[i + 1]).applyMatrix4(rel); c.fromBufferAttribute(P, idx[i + 2]).applyMatrix4(rel);
      const m = new THREE.Vector3().add(a).add(b).add(c).multiplyScalar(1 / 3);
      const fn = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
      if (!inRegion(m, fn)) { keep.push(idx[i], idx[i + 1], idx[i + 2]); continue; }
      for (const [k, v] of [[idx[i], a], [idx[i + 1], b], [idx[i + 2], c]]) {
        pos.push(v.x, v.y, v.z);
        if (N) { n.fromBufferAttribute(N, k).applyMatrix3(nm).normalize(); nor.push(n.x, n.y, n.z); }
        if (UV) uv.push(UV.getX(k), UV.getY(k));
      }
    }
    if (!pos.length) return;
    moved += pos.length / 9;
    g.setIndex(keep);
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    if (nor.length) dg.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); else dg.computeVertexNormals();
    if (uv.length) dg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const mesh = new THREE.Mesh(dg, o.material);
    mesh.castShadow = o.castShadow; mesh.receiveShadow = true; mesh.renderOrder = o.renderOrder;
    mesh.userData = { ...o.userData };
    group.add(mesh);
  });
  rig.shell.add(group);
  return { group, moved };
}

function extractSlidingDoor(rig, holder, HW) {
  const { group, moved } = extractRegion(rig, holder, (p) => p.x > HW - DOOR.inset && p.z > DOOR.z0 && p.z < DOOR.z1 && p.y > DOOR.y0 && p.y < DOOR.y1, 'sliding-door');
  console.info('[HiAce] الباب الجرار:', moved, 'مثلث');
  // open: 0 مقفول → 1 مفتوح (بيطلع لبره شوية وبعدين يتزحلق لورا)
  return {
    group, open: 0, target: 0, moved,
    center: new THREE.Vector3(HW, 0.9, (DOOR.z0 + DOOR.z1) / 2),
    update(dt) {
      const sp = this.target > this.open ? 1.4 : 1.2;
      this.open += Math.sign(this.target - this.open) * Math.min(Math.abs(this.target - this.open), dt * sp);
      const out = Math.min(1, this.open * 5) * 0.075, slide = Math.max(0, (this.open - 0.12) / 0.88) * (DOOR.z1 - DOOR.z0 - 0.2);
      group.position.set(out, 0, slide);
    },
  };
}

/** يرجّع هندسة فيها المثلثات اللي كل نقطها جوه نص قطر معين حوالين المحور X (الجنط) */
function keepInside(g, r) {
  const P = g.attributes.position, idx = g.index ? g.index.array : null, n = idx ? idx.length : P.count;
  const keep = [];
  const rad = (i) => Math.hypot(P.getY(i), P.getZ(i));
  for (let k = 0; k < n; k += 3) {
    const a = idx ? idx[k] : k, b = idx ? idx[k + 1] : k + 1, c = idx ? idx[k + 2] : k + 2;
    if (rad(a) < r && rad(b) < r && rad(c) < r) keep.push(a, b, c);
  }
  const out = g.clone();
  out.setIndex(keep);
  out.computeBoundingBox(); out.computeBoundingSphere();
  return out;
}

/** تنعيم الصاج: normals ناعمة لحد زاوية معينة (الحواف الحادة الحقيقية بتفضل حادة) */
export function smoothShell(root, crease = 42) {
  const ang = THREE.MathUtils.degToRad(crease);
  root.traverse((o) => {
    if (!o.isMesh) return;
    const n = (o.userData.matName || '').toLowerCase();
    if (!/paint|black|parts|chrome/.test(n) || o.userData.role === 'rim') return;
    try {
      let g = o.geometry;
      if (g.index) g = g.toNonIndexed();
      g = toCreasedNormals(mergeVertices(g, 1e-4), ang);
      o.geometry.dispose?.();
      o.geometry = g;
    } catch { /* سيبها زي ما هي */ }
  });
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
