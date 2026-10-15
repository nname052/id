import * as THREE from 'three';

// تركيب موديل GLB حقيقي (توكتوك/تاكسي) على "ريج" عربية اللاعب:
// - بنكبّره/نصغّره عشان المسافة بين العجل تبقى نفس الفيزياء بالظبط، ونحطه بحيث عجله ييجي على عجل الفيزياء
// - عجل الموديل بيتقسم لكل عجلة لوحدها (حتى لو الموديل دامجهم في قطعة واحدة) وبيتركب في مكان العجلة اللي بتلف
// - أجزاء الريج الإجرائي اللي ليها وظيفة (الدركسيون، العدادات، المرايات، الكراسي، عين السواق) بتفضل زي ما هي

const _v = new THREE.Vector3();

/** نسخة Float32 عادية (الموديلات المضغوطة بتخزن النقط كأرقام صحيحة 16-bit ومينفعش نعمل عليها تحويلات) */
export function toFloat(geo) {
  const src = geo.index ? geo.toNonIndexed() : geo;
  const out = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(src.attributes)) {
    const arr = new Float32Array(a.count * a.itemSize);
    // getComponent بيحوّل الأرقام المضغوطة (normalized) لكسور لوحده
    for (let i = 0; i < a.count; i++) for (let d = 0; d < a.itemSize; d++) arr[i * a.itemSize + d] = a.getComponent(i, d);
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  return out;
}

/** كل مثلثات العجل (في إحداثيات الموديل) مع مركز كل مثلث */
function collectWheelTris(root, re) {
  const parts = [];
  root.updateMatrixWorld(true);
  // إحداثيات أبو الموديل (يعني شاملة تحجيم الموديل نفسه): لو قسنا جوه الموديل كان التحجيم بيتلغي
  // والعجل كان بيطلع أكبر من الجسم بنسبة 1/k ومكانه مزحزح عن الرفارف
  const inv = root.parent ? new THREE.Matrix4().copy(root.parent.matrixWorld).invert() : new THREE.Matrix4();
  root.traverse((o) => {
    if (!o.isMesh || !re.test(o.name)) return;
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    const g = toFloat(o.geometry).applyMatrix4(m);
    parts.push({ mesh: o, geo: g });
  });
  return parts;
}

/** بنقسم العجل لمجموعات: قدام/ورا (بالـ z) وبعدين شمال/يمين لو المحور فيه عجلتين */
function clusterWheels(parts) {
  const pts = [];
  for (const { geo } of parts) {
    const P = geo.attributes.position;
    for (let i = 0; i < P.count; i += 3) pts.push((P.getZ(i) + P.getZ(i + 1) + P.getZ(i + 2)) / 3);
  }
  const zMin = Math.min(...pts), zMax = Math.max(...pts), zMid = (zMin + zMax) / 2;
  const boxes = {};
  const key = (cx, cz, split) => `${cz < zMid ? 'F' : 'R'}${split ? (cx < 0 ? 'L' : 'R') : 'C'}`;
  // هل المحور ده فيه عجلتين؟ (انتشار كبير في x)
  const spread = { F: [Infinity, -Infinity], R: [Infinity, -Infinity] };
  for (const { geo } of parts) {
    const P = geo.attributes.position;
    for (let i = 0; i < P.count; i++) { const a = P.getZ(i) < zMid ? 'F' : 'R'; spread[a][0] = Math.min(spread[a][0], P.getX(i)); spread[a][1] = Math.max(spread[a][1], P.getX(i)); }
  }
  const split = { F: spread.F[1] - spread.F[0] > 0.7, R: spread.R[1] - spread.R[0] > 0.7 };
  const tris = []; // [partIndex, triStart, key]
  parts.forEach(({ geo }, pi) => {
    const P = geo.attributes.position;
    for (let i = 0; i < P.count; i += 3) {
      const cx = (P.getX(i) + P.getX(i + 1) + P.getX(i + 2)) / 3, cz = (P.getZ(i) + P.getZ(i + 1) + P.getZ(i + 2)) / 3;
      const axle = cz < zMid ? 'F' : 'R';
      const k = key(cx, cz, split[axle]);
      tris.push([pi, i, k]);
      const b = (boxes[k] ||= new THREE.Box3());
      for (let j = 0; j < 3; j++) b.expandByPoint(_v.fromBufferAttribute(P, i + j));
    }
  });
  const centers = {};
  for (const [k, b] of Object.entries(boxes)) { const c = b.getCenter(new THREE.Vector3()); centers[k] = { c, r: (b.max.y - b.min.y) / 2 }; }
  return { tris, centers };
}

/**
 * rig: ريج اللاعب، spec: مواصفات الفيزياء، asset: الموديل من AssetManager
 * opts.wheelRe: أسماء قطع العجل جوه الموديل
 * بيرجّع الموديل اللي اتركب (Group) أو null
 */
export function fitModelToRig(rig, spec, asset, { wheelRe }) {
  const model = asset.instantiate().root;
  model.updateMatrixWorld(true);
  // 1) نقيس العجل في الموديل
  let parts = collectWheelTris(model, wheelRe);
  if (!parts.length) return null;
  let { centers } = clusterWheels(parts);
  const axle = (a) => Object.entries(centers).filter(([k]) => k[0] === a).map(([, v]) => v);
  const avgZ = (a) => axle(a).reduce((s, v) => s + v.c.z, 0) / axle(a).length;
  // 2) نظبط الحجم: المسافة بين العجل = فرق العجل في الفيزياء
  const wbModel = avgZ('R') - avgZ('F');
  const k = spec.wheelBase / wbModel;
  model.scale.multiplyScalar(k);
  model.updateMatrixWorld(true);
  for (const p of parts) p.geo.dispose();
  parts = collectWheelTris(model, wheelRe);
  const cl = clusterWheels(parts);
  centers = cl.centers;
  // 3) نحرّكه: العجل القدام على محور الفيزياء القدام، ومركز العجل على ارتفاع نص قطر عجلة الفيزياء
  const zF = -spec.cgToFront;
  const fC = axle('F'), yC = fC.reduce((s, v) => s + v.c.y, 0) / fC.length;
  const dz = zF - avgZ('F'), dy = spec.wheelRadius - yC;
  model.position.z += dz; model.position.y += dy;
  // للفحص: مكان ونص قطر كل عجلة في الموديل (بعد التحجيم والتحريك) — في إحداثيات الـ shell
  rig.fitInfo = { scale: k, pos: model.position.toArray(), wheels: Object.fromEntries(Object.entries(centers).map(([key, v]) => [key, { x: v.c.x, y: v.c.y + dy, z: v.c.z + dz, r: v.r }])) };
  // 4) العجل: كل مجموعة مثلثات → Mesh متمركزة على نص العجلة، جوه الجزء اللي بيلف من عجلة الفيزياء
  const targetFor = (key) => {
    const front = key[0] === 'F';
    const cand = rig.wheels.filter((w) => w.front === front && w.spin && w.spin.parent);
    if (key[1] === 'C') return cand.find((w) => Math.abs(w.group.position.x) < 0.2) || cand[0];
    const left = key[1] === 'L';
    return cand.find((w) => (w.group.position.x < 0) === left) || cand[0];
  };
  const byKey = {};
  for (const [pi, i, key] of cl.tris) ((byKey[key] ||= {})[pi] ||= []).push(i);
  const hidden = new Set();
  for (const [key, perPart] of Object.entries(byKey)) {
    const w = targetFor(key);
    if (!w) continue;
    if (!hidden.has(w)) { for (const c of w.spin.children) c.visible = false; hidden.add(w); }
    const c = centers[key].c;
    for (const [pi, list] of Object.entries(perPart)) {
      const src = parts[pi].geo, out = new THREE.BufferGeometry();
      for (const name of ['position', 'normal', 'uv']) {
        const a = src.attributes[name]; if (!a) continue;
        const arr = new Float32Array(list.length * 3 * a.itemSize);
        let o = 0;
        for (const i of list) for (let j = 0; j < 3; j++) for (let d = 0; d < a.itemSize; d++) arr[o++] = a.getComponent(i + j, d);
        out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
      }
      out.translate(-c.x, -c.y, -c.z);
      const mesh = new THREE.Mesh(out, parts[pi].mesh.material);
      mesh.castShadow = true;
      w.spin.add(mesh);
    }
  }
  for (const p of parts) { p.mesh.visible = false; p.geo.dispose(); }
  model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  rig.shell.add(model);
  rig.model = model;
  return model;
}

/** التوكتوك المصري (زي الصورة): جسم أسود، والجزء اللي فوق قدام (حوالين الزجاج) أصفر */
export function tuktukColors(model) {
  model.updateMatrixWorld(true);
  model.traverse((o) => {
    if (!o.isMesh || !/body/i.test(o.material.name || '')) return;
    const g = o.geometry; g.computeBoundingBox();
    const bb = g.boundingBox;
    const mat = (o.material = o.material.clone());
    const U = { uBMin: { value: bb.min.clone() }, uBSize: { value: bb.getSize(new THREE.Vector3()) } };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uBMin, uBSize;\nvarying vec3 vTk;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTk = (position - uBMin) / uBSize;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTk;')
        .replace('#include <map_fragment>', `#include <map_fragment>
{
  vec3 c = diffuseColor.rgb;
  float yellow = smoothstep(0.08, 0.2, (c.r + c.g) * 0.5 - c.b) * smoothstep(0.15, 0.35, c.r);
  // إحداثيات الموديل الأصلية (قبل اللفة): قدام = z الكبيرة، وفوق = y الكبيرة
  float front = smoothstep(0.8, 0.83, vTk.z);
  float top = smoothstep(0.5, 0.53, vTk.y);
  float keep = front * top;
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  vec3 black = vec3(0.012) + lum * 0.025;
  // الأصفر اللي فوق: دهان نضيف (من غير صدا الخامة الأصلية) بنفس درجة تابلوه الكابينة
  vec3 clean = vec3(0.875, 0.46, 0.002) * mix(0.82, 1.04, smoothstep(0.08, 0.5, lum));
  float warm = max(yellow, smoothstep(0.02, 0.09, c.r - c.b)); // بقع الصدا الغامقة برضه
  diffuseColor.rgb = mix(mix(c, clean, warm * keep), black, warm * (1.0 - keep));
}`);
    };
    mat.customProgramCacheKey = () => 'tuktuk-colors3';
    // دهان عادي مش معدني (المعدني بيعكس السما فيبان رمادي)
    mat.metalnessMap = null; mat.metalness = 0.05; mat.roughness = 0.42; mat.envMapIntensity = 0.6;
    mat.needsUpdate = true;
  });
}

/**
 * نسخة خفيفة لعربيات المرور: كل القطع المصمتة في Mesh واحدة (كل قطعة بلونها)، والزجاج في واحدة تانية
 * → 2 draw calls للعربية بدل ~20. بتتعمل مرة واحدة وكل العربيات بتشاركها.
 */
export function bakeTrafficVersion(asset) {
  if (asset._traffic) return asset._traffic;
  const h = asset.holder; h.updateMatrixWorld(true);
  const solid = [], glass = [];
  h.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    const g = toFloat(o.geometry).applyMatrix4(o.matrixWorld);
    if (!g.attributes.normal) g.computeVertexNormals();
    const isGlass = o.material.transparent || /glass|gls/i.test(o.material.name || '');
    const c = o.material.color || new THREE.Color(1, 1, 1);
    // الخامات اللي ليها صورة: لونها الأساسي غالبًا أبيض، فناخدها أغمق شوية (عجل/بلاستيك)
    const col = o.material.map && !/paint/i.test(o.material.name || '') ? c.clone().multiplyScalar(0.25) : c;
    const n = g.attributes.position.count, arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
    (isGlass ? glass : solid).push(g);
  });
  const merge = (list) => {
    if (!list.length) return null;
    let total = 0; for (const g of list) total += g.attributes.position.count;
    const out = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'color']) {
      const arr = new Float32Array(total * 3); let o = 0;
      for (const g of list) { arr.set(g.attributes[name].array, o); o += g.attributes[name].array.length; }
      out.setAttribute(name, new THREE.BufferAttribute(arr, 3));
    }
    out.computeBoundingSphere();
    return out;
  };
  asset._traffic = {
    solid: merge(solid), glass: merge(glass),
    solidMat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.1 }),
    glassMat: new THREE.MeshStandardMaterial({ color: 0x1d262b, transparent: true, opacity: 0.6, roughness: 0.05, depthWrite: false }),
  };
  return asset._traffic;
}
