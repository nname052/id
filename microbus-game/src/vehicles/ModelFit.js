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
  const built = [];
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
      mesh.userData.ring = ringCenter(out);
      w.spin.add(mesh);
      built.push(mesh);
    }
    // كل أجزاء العجلة على نفس المحور: مركز دايرة كل جزء (مش الـ bbox) يتظبط على مركز الكاوتش.
    // في موديل التاكسي وش الجنط (rim_map) معمول مزحزح ~2سم → بيترقّص على الجنط وهو بيلف ("الكاوتش منفصل")
    // التصحيح للإزاحات الصغيرة بس (أقل من 3.5سم): الأجزاء اللي برا المحور بقصد (زي الكاليبر) مابتتلمسش
    const ref = built.reduce((m, o) => (!m || o.userData.ring.r > m.userData.ring.r ? o : m), null);
    if (ref) for (const o of built) {
      if (o === ref) continue;
      const dy = o.userData.ring.y - ref.userData.ring.y, dz = o.userData.ring.z - ref.userData.ring.z, off = Math.hypot(dy, dz);
      if (off > 0.002 && off < 0.035 && o.userData.ring.rms < 0.03) o.geometry.translate(0, -dy, -dz);
    }
    built.length = 0;
  }
  for (const p of parts) { p.mesh.visible = false; p.geo.dispose(); }
  model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  polishMaterials(model);
  rig.shell.add(model);
  rig.model = model;
  return model;
}

/**
 * تشطيب الخامات (من غير ما نلمس أي لون): كاوتش مطفي، زجاج لامع، كروم/جنوط معدن، بلاستيك نص مطفي.
 * الموديلات جاية بقيم غلط (كاوتش معدني 0.37، زجاج التوكتوك خشن 1.0، جنط التوكتوك 0.98) → بيبان بلاستيك/رمادي.
 */
export function polishMaterials(root) {
  const done = new Set();
  root.traverse((o) => {
    const m = o.isMesh && o.material;
    if (!m || done.has(m) || !('roughness' in m)) return;
    done.add(m);
    const n = m.name || '';
    if (/^(tire|tyre|llanta)$/i.test(n)) { m.metalness = 0; m.roughness = Math.max(m.roughness, 0.88); m.envMapIntensity = 0.35; }
    else if (/^(glass\d*|gls)$/i.test(n)) { m.roughness = 0.04; m.metalness = 0; m.envMapIntensity = 1.4; }
    else if (/^metal_rin$/i.test(n)) { m.roughness = 0.38; m.envMapIntensity = 1.0; }
    else if (/chrome/i.test(n)) { m.metalness = Math.max(m.metalness, 0.9); m.roughness = Math.min(m.roughness, 0.14); m.envMapIntensity = 1.15; }
    else if (/plas|^under$/i.test(n)) { m.metalness = Math.min(m.metalness, 0.1); m.roughness = Math.max(m.roughness, 0.55); }
    m.needsUpdate = true;
  });
}

/**
 * مركز دايرة الجزء في مستوى العجلة (y,z): fit دايرة بالمربعات الصغرى (Kasa) على نقط الحافة الخارجية، مرتين.
 * بيرجّع كمان مدى "دايرية" الجزء (rms/R): الأجزاء اللي مش دايرة (كاليبر الفرامل) مابتتظبطش.
 */
function ringCenter(geo) {
  const P = geo.attributes.position, n = P.count;
  let cy = 0, cz = 0, R = 0, rms = 1;
  for (let pass = 0; pass < 2; pass++) {
    let rmax = 0;
    for (let i = 0; i < n; i++) rmax = Math.max(rmax, Math.hypot(P.getY(i) - cy, P.getZ(i) - cz));
    // x² + y² + D x + E y + F = 0
    let a11 = 0, a12 = 0, a13 = 0, a22 = 0, a23 = 0, a33 = 0, b1 = 0, b2 = 0, b3 = 0, m = 0;
    for (let i = 0; i < n; i++) {
      const y = P.getY(i), z = P.getZ(i);
      const r = Math.hypot(y - cy, z - cz);
      if (pass === 0 ? r < rmax * 0.88 : Math.abs(r - R) > R * 0.08) continue;
      const q = -(y * y + z * z);
      a11 += y * y; a12 += y * z; a13 += y; a22 += z * z; a23 += z; a33 += 1; b1 += y * q; b2 += z * q; b3 += q; m++;
    }
    if (m < 6) break;
    const M = [[a11, a12, a13, b1], [a12, a22, a23, b2], [a13, a23, a33, b3]];
    for (let i = 0; i < 3; i++) {
      let pv = i; for (let r = i + 1; r < 3; r++) if (Math.abs(M[r][i]) > Math.abs(M[pv][i])) pv = r;
      [M[i], M[pv]] = [M[pv], M[i]];
      for (let r = 0; r < 3; r++) if (r !== i) { const f = M[r][i] / M[i][i]; for (let c = i; c < 4; c++) M[r][c] -= f * M[i][c]; }
    }
    const D = M[0][3] / M[0][0], E = M[1][3] / M[1][1], F = M[2][3] / M[2][2];
    cy = -D / 2; cz = -E / 2; R = Math.sqrt(Math.max(0, cy * cy + cz * cz - F));
    let s2 = 0, k = 0;
    for (let i = 0; i < n; i++) { const r = Math.hypot(P.getY(i) - cy, P.getZ(i) - cz); if (Math.abs(r - R) < R * 0.08) { s2 += (r - R) ** 2; k++; } }
    rms = k ? Math.sqrt(s2 / k) / (R || 1) : 1;
  }
  return { y: cy, z: cz, r: R, rms };
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
// لون الصورة عند كل نقطة (للتوكتوك المخبوز: من غير كده بيطلع رمادي)
function texSampler(map) {
  const img = map?.image;
  if (!img || !img.width || typeof document === 'undefined') return null;
  const W = Math.min(256, img.width), H = Math.min(256, img.height);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  try { cx.drawImage(img, 0, 0, W, H); } catch { return null; }
  const d = cx.getImageData(0, 0, W, H).data, lin = (v) => Math.pow(v / 255, 2.2);
  return (u, v, out) => {
    u -= Math.floor(u); v -= Math.floor(v);
    const i = ((Math.min(H - 1, Math.floor((map.flipY ? 1 - v : v) * H)) * W) + Math.min(W - 1, Math.floor(u * W))) * 4;
    return out.setRGB(lin(d[i]), lin(d[i + 1]), lin(d[i + 2]));
  };
}

// نفس قاعدة ألوان tuktukColors (أسود + أصفر نضيف فوق قدام) بس على الـ CPU لكل نقطة
function tuktukTint(c, tk) {
  const yellow = THREE.MathUtils.smoothstep((c.r + c.g) * 0.5 - c.b, 0.08, 0.2) * THREE.MathUtils.smoothstep(c.r, 0.15, 0.35);
  const keep = THREE.MathUtils.smoothstep(tk.z, 0.8, 0.83) * THREE.MathUtils.smoothstep(tk.y, 0.5, 0.53);
  const lum = c.r * 0.299 + c.g * 0.587 + c.b * 0.114, bl = 0.012 + lum * 0.025;
  const k = 0.82 + 0.22 * THREE.MathUtils.smoothstep(lum, 0.08, 0.5);
  const warm = Math.max(yellow, THREE.MathUtils.smoothstep(c.r - c.b, 0.02, 0.09));
  const a = warm * keep, b = warm * (1 - keep);
  c.setRGB(c.r + (0.875 * k - c.r) * a, c.g + (0.46 * k - c.g) * a, c.b + (0.002 * k - c.b) * a);
  c.setRGB(c.r + (bl - c.r) * b, c.g + (bl - c.g) * b, c.b + (bl - c.b) * b);
}

export function bakeTrafficVersion(asset, { tuktuk = false, wheelRe = null } = {}) {
  if (asset._traffic) return asset._traffic;
  const h = asset.holder; h.updateMatrixWorld(true);
  const solid = [], glass = [], wheels = new Map();
  h.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    // العجل لوحده (بيلف): كل اسم قطعة (من غير لاحقة الخامة) = عجلة/محور واحد، في مكانها بالظبط
    if (wheelRe && wheelRe.test(o.name)) {
      const key = o.name.replace(/_.*$/, '');
      const g = toFloat(o.geometry).applyMatrix4(o.matrixWorld);
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!wheels.has(key)) wheels.set(key, []);
      wheels.get(key).push({ g, mat: o.material });
      return;
    }
    const loc = toFloat(o.geometry), g = loc.clone().applyMatrix4(o.matrixWorld);
    if (!g.attributes.normal) g.computeVertexNormals();
    const isGlass = o.material.transparent || /glass|gls/i.test(o.material.name || '');
    const c = o.material.color || new THREE.Color(1, 1, 1);
    // الخامات اللي ليها صورة: لونها الأساسي غالبًا أبيض، فناخدها أغمق شوية (عجل/بلاستيك)
    const col = o.material.map && !/paint/i.test(o.material.name || '') ? c.clone().multiplyScalar(0.25) : c;
    const n = g.attributes.position.count, arr = new Float32Array(n * 3);
    const smp = tuktuk && g.attributes.uv ? texSampler(o.material.map) : null;
    if (smp) {
      const uv = g.attributes.uv, lp = loc.attributes.position, tmp = new THREE.Color(), tk = new THREE.Vector3();
      loc.computeBoundingBox();
      const bb = loc.boundingBox, sz = bb.getSize(new THREE.Vector3()).max(new THREE.Vector3(1e-6, 1e-6, 1e-6));
      const body = /body/i.test(o.material.name || '');
      for (let i = 0; i < n; i++) {
        smp(uv.getX(i), uv.getY(i), tmp).multiply(c);
        if (body) tuktukTint(tmp, tk.fromBufferAttribute(lp, i).sub(bb.min).divide(sz));
        arr[i * 3] = tmp.r; arr[i * 3 + 1] = tmp.g; arr[i * 3 + 2] = tmp.b;
      }
    } else for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
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
  // كل عجلة: pivot في مركزها + القطع بتاعتها متحركة للمركز (عشان اللفة حوالين المحور)
  const wheelParts = [...wheels.values()].map((parts) => {
    const bb = new THREE.Box3(); for (const { g } of parts) { g.computeBoundingBox(); bb.union(g.boundingBox); }
    const c = bb.getCenter(new THREE.Vector3());
    for (const { g } of parts) g.translate(-c.x, -c.y, -c.z);
    return { center: c, parts };
  });
  asset._traffic = {
    solid: merge(solid), glass: merge(glass), wheels: wheelParts,
    solidMat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.1 }),
    glassMat: new THREE.MeshStandardMaterial({ color: 0x1d262b, transparent: true, opacity: 0.6, roughness: 0.05, depthWrite: false }),
  };
  return asset._traffic;
}
