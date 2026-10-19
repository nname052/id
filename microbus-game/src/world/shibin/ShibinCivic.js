// =====================================================================
//  مباني شبين الحقيقية (من OSM بس — مفيش مكان متألف):
//  - المباني اللي ليها footprint في OSM (مدارس، محطة القطر، مولات، فندق الجامعة…): بشكلها الحقيقي
//    + واجهة حسب نوعها (مدرسة حكومي، محطة، مول، سكن) + يافطة باسمها اللي في OSM
//  - دور العبادة اللي في OSM (مسجد سيف، كنيسة السيدة العذراء): مسجد بقبة ومئذنة، كنيسة قبطي ببرجين
//    في مكانها بالظبط (العمارات المولّدة حواليها بتتشال)
// =====================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { canvas, tex } from '../../render/textures.js';

const FLOOR = 3.3;
const _c = new THREE.Color();
const lin = (r, g, b) => { _c.setRGB(r, g, b, THREE.SRGBColorSpace); return [_c.r, _c.g, _c.b]; };
function part(g, rgb, m) {
  g = g.index ? g.toNonIndexed() : g.clone();
  if (m) g.applyMatrix4(m);
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  const n = g.attributes.position.count, c = lin(...rgb), a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set(c, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
const M4 = (x, y, z, ry = 0, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(sx, sy, sz));

// ===================== واجهات حسب النوع (خانة = فتحة 4م × دور) =====================
const STYLES = {
  school: { wall: '#e8d9a8', trim: '#b8a26a', win: '#4a6a80', frame: '#f4f0e6', sign: ['#1d4f91', '#fff'] },     // مدارس حكومي: أصفر فاتح وشبابيك بإطار أبيض
  train_station: { wall: '#e3d3ab', trim: '#c9b78b', win: '#3b2e22', arch: true, sign: ['#11663a', '#fff'] },
  mall: { wall: '#d9dde0', trim: '#9aa3aa', win: '#25445a', glass: true, sign: ['#b3261e', '#fff'] },
  hotel: { wall: '#efe7d6', trim: '#c2b28f', win: '#3d5566', frame: '#ffffff', sign: ['#5b2a6b', '#fff'] },
  apartments: { wall: '#d8c3a5', trim: '#a8916f', win: '#3a3a3a', balcony: true, sign: null },
  default: { wall: '#ddd2bd', trim: '#b0a083', win: '#3c4c58', sign: ['#2d4f6b', '#fff'] },
};
const KIND = (k) => (k === 'yes' ? 'mall' : STYLES[k] ? k : 'default');
const matCache = new Map();
function facadeMat(kind) {
  if (matCache.has(kind)) return matCache.get(kind);
  const S = STYLES[kind];
  const c = canvas(256, 256), x = c.getContext('2d');
  x.fillStyle = S.wall; x.fillRect(0, 0, 256, 256);
  x.fillStyle = S.trim; x.fillRect(0, 0, 256, 18); // بلاطة الدور
  if (S.glass) { x.fillStyle = S.win; x.fillRect(10, 28, 236, 200); x.fillStyle = 'rgba(255,255,255,0.18)'; for (let i = 0; i < 4; i++) x.fillRect(10 + i * 59, 28, 3, 200); x.fillRect(10, 128, 236, 3); }
  else if (S.arch) { x.fillStyle = S.win; x.beginPath(); x.moveTo(78, 236); x.lineTo(78, 110); x.arc(128, 110, 50, Math.PI, 0); x.lineTo(178, 236); x.fill(); x.fillStyle = S.trim; x.fillRect(70, 236, 116, 10); }
  else {
    if (S.frame) { x.fillStyle = S.frame; x.fillRect(58, 58, 140, 130); }
    x.fillStyle = S.win; x.fillRect(66, 66, 124, 114);
    x.fillStyle = 'rgba(255,255,255,0.12)'; x.fillRect(66, 66, 124, 20);
    x.fillStyle = S.frame || S.trim; x.fillRect(125, 66, 6, 114);
    if (S.balcony) { x.fillStyle = S.trim; x.fillRect(40, 180, 176, 30); }
  }
  x.fillStyle = 'rgba(0,0,0,0.08)'; x.fillRect(0, 236, 256, 20);
  const t = tex(c, { repeat: true, aniso: 4 });
  const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.85 });
  matCache.set(kind, m);
  return m;
}
function signMesh(text, colors, w) {
  const c = canvas(1024, 160), x = c.getContext('2d');
  x.fillStyle = colors[0]; x.fillRect(0, 0, 1024, 160);
  x.strokeStyle = 'rgba(255,255,255,0.8)'; x.lineWidth = 6; x.strokeRect(8, 8, 1008, 144);
  x.fillStyle = colors[1]; x.textAlign = 'center'; x.textBaseline = 'middle'; x.direction = 'rtl';
  let fs = 84; x.font = `bold ${fs}px Cairo, sans-serif`;
  while (x.measureText(text).width > 960 && fs > 30) { fs -= 4; x.font = `bold ${fs}px Cairo, sans-serif`; }
  x.fillText(text, 512, 84);
  const h = Math.min(1.4, w / 6.4);
  return new THREE.Mesh(new THREE.PlaneGeometry(Math.min(w * 0.8, 9), h), new THREE.MeshStandardMaterial({ map: tex(c, { repeat: false, aniso: 4 }), roughness: 0.6, emissive: 0xffffff, emissiveIntensity: 0.05 }));
}

/** مبنى OSM حقيقي بواجهة حسب نوعه + يافطة باسمه على أطول حيطة ناحية الشارع */
export function styledRealBuilding(rb, W) {
  const kind = KIND(rb.kind), S = STYLES[kind];
  const floors = Math.max(1, rb.floors || 3), h = floors * FLOOR + 0.6;
  const pos = [], nor = [], uv = [], idx = [];
  let best = null;
  for (const ring of rb.rings) {
    let u = 0;
    // اتجاه الحلقة: نخلي الـ normal لبره (مساحة موجبة = عكس عقارب الساعة في x/z)
    let area = 0; for (let i = 0; i + 3 < ring.length; i += 2) area += ring[i] * ring[i + 3] - ring[i + 2] * ring[i + 1];
    const sg = area > 0 ? 1 : -1;
    for (let i = 0; i + 3 < ring.length; i += 2) {
      const ax = ring[i], az = ring[i + 1], bx = ring[i + 2], bz = ring[i + 3], L = Math.hypot(bx - ax, bz - az);
      if (L < 0.05) continue;
      const nx = sg * (bz - az) / L, nz = -sg * (bx - ax) / L;
      const k = pos.length / 3;
      pos.push(ax, 0, az, bx, 0, bz, bx, h, bz, ax, h, az);
      for (let j = 0; j < 4; j++) nor.push(nx, 0, nz);
      uv.push(u / 4, 0, (u + L) / 4, 0, (u + L) / 4, h / FLOOR, u / 4, h / FLOOR);
      u += L;
      idx.push(k, k + 1, k + 2, k, k + 2, k + 3, k, k + 2, k + 1, k, k + 3, k + 2);
      // الحيطة اللي هتتحط عليها اليافطة: الأطول اللي قدامها شارع
      const mx = (ax + bx) / 2 + nx * 3, mz = (az + bz) / 2 + nz * 3;
      const r = W.nearestRoad(mx, mz, 40);
      const score = L - (r ? r.d * 0.5 : 30);
      if (!best || score > best.score) best = { score, mx: (ax + bx) / 2, mz: (az + bz) / 2, nx, nz, L };
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const group = new THREE.Group(); group.name = 'osm-building';
  const walls = new THREE.Mesh(g, facadeMat(kind)); walls.castShadow = true; walls.receiveShadow = true; group.add(walls);
  // السطح + دروة
  const rp = [], ri = [];
  const k0 = 0; for (let i = 0; i < rb.v.length; i += 2) rp.push(rb.v[i], h, rb.v[i + 1]);
  for (let i = 0; i < rb.i.length; i += 3) ri.push(k0 + rb.i[i], k0 + rb.i[i + 2], k0 + rb.i[i + 1], k0 + rb.i[i], k0 + rb.i[i + 1], k0 + rb.i[i + 2]);
  const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3)); rg.setIndex(ri); rg.computeVertexNormals();
  group.add(new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ color: 0x8f8a82, roughness: 0.95, side: THREE.DoubleSide })));
  // اليافطة باسمها (الاسم من OSM بس؛ من غير اسم = من غير يافطة)
  const name = rb.name || (kind === 'train_station' ? 'محطة قطار' : null);
  if (name && S.sign && best) {
    const s = signMesh(name, S.sign, best.L);
    s.position.set(best.mx + best.nx * 0.06, Math.min(h - 0.9, FLOOR + 0.9), best.mz + best.nz * 0.06);
    s.rotation.y = Math.atan2(best.nx, best.nz);
    group.add(s);
  }
  return { group, h, kind };
}

// ===================== دور العبادة =====================
function mosqueGeo() {
  const wall = [0.93, 0.89, 0.8], trim = [0.75, 0.68, 0.55], dome = [0.86, 0.88, 0.86], green = [0.18, 0.45, 0.32];
  const P = [
    part(new THREE.BoxGeometry(16, 7.5, 16), wall, M4(0, 3.75, 0)),
    part(new THREE.BoxGeometry(16.4, 0.5, 16.4), trim, M4(0, 7.6, 0)),
    part(new THREE.CylinderGeometry(4.2, 4.6, 1.6, 16), wall, M4(0, 8.6, 0)),                        // رقبة القبة
    part(new THREE.SphereGeometry(4.3, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), dome, M4(0, 9.4, 0)), // القبة
    part(new THREE.CylinderGeometry(0.06, 0.06, 1.4, 6), [0.85, 0.72, 0.3], M4(0, 14.3, 0)),          // الهلال (عمود)
    part(new THREE.TorusGeometry(0.45, 0.07, 6, 14, Math.PI * 1.4), [0.85, 0.72, 0.3], M4(0, 15.2, 0)),
  ];
  // المئذنة: قاعدة مربعة → جسم مثمن → شرفتين → راس بتاج
  const mx = 6.5, mz = 6.5;
  P.push(part(new THREE.BoxGeometry(3, 10, 3), wall, M4(mx, 5, mz)));
  P.push(part(new THREE.CylinderGeometry(1.2, 1.35, 12, 8), wall, M4(mx, 16, mz)));
  for (const y of [15, 22.5]) P.push(part(new THREE.CylinderGeometry(1.8, 1.4, 0.7, 8), trim, M4(mx, y, mz)));
  P.push(part(new THREE.CylinderGeometry(0.95, 1.05, 4.5, 8), wall, M4(mx, 25.2, mz)));
  P.push(part(new THREE.ConeGeometry(1.15, 3.2, 8), green, M4(mx, 29.1, mz)));
  P.push(part(new THREE.CylinderGeometry(0.05, 0.05, 1.4, 6), [0.85, 0.72, 0.3], M4(mx, 31.3, mz)));
  // بواكي المدخل (شبابيك غامقة مقوسة)
  for (const sx of [-5, -1.7, 1.7, 5]) P.push(part(new THREE.BoxGeometry(2, 3.4, 0.2), [0.24, 0.3, 0.26], M4(sx, 2.4, 8.05)));
  return mergeGeometries(P);
}
function churchGeo() {
  const wall = [0.92, 0.88, 0.8], trim = [0.62, 0.5, 0.36], dome = [0.88, 0.88, 0.85], dark = [0.24, 0.2, 0.18];
  const P = [
    part(new THREE.BoxGeometry(14, 9, 24), wall, M4(0, 4.5, 0)),
    part(new THREE.BoxGeometry(14.4, 0.5, 24.4), trim, M4(0, 9.2, 0)),
    part(new THREE.SphereGeometry(3.6, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), dome, M4(0, 9.4, 2)), // قبة الهيكل
    part(new THREE.BoxGeometry(2.6, 3.6, 0.2), dark, M4(0, 2.2, -12.05)),                         // الباب
  ];
  for (const sx of [-5, 5]) {
    P.push(part(new THREE.BoxGeometry(3.6, 17, 3.6), wall, M4(sx, 8.5, -10.2)));                      // البرجين
    P.push(part(new THREE.BoxGeometry(4, 0.4, 4), trim, M4(sx, 17.2, -10.2)));
    P.push(part(new THREE.SphereGeometry(1.7, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), dome, M4(sx, 17.4, -10.2)));
    P.push(part(new THREE.BoxGeometry(0.15, 1.6, 0.15), [0.85, 0.72, 0.3], M4(sx, 19.9, -10.2)));     // الصليب
    P.push(part(new THREE.BoxGeometry(0.9, 0.15, 0.15), [0.85, 0.72, 0.3], M4(sx, 20.2, -10.2)));
    for (const y of [11, 14]) P.push(part(new THREE.BoxGeometry(1.1, 1.8, 0.2), dark, M4(sx, y, -12.05)));
  }
  for (let z = -8; z <= 8; z += 4) for (const sx of [-7.05, 7.05]) P.push(part(new THREE.BoxGeometry(0.2, 2.6, 1.2), dark, M4(sx, 5, z)));
  return mergeGeometries(P);
}

/** المسجد والكنيسة في أماكنهم من OSM (الـ POIs) */
export function buildWorship(W, features, group) {
  const out = [];
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  for (const p of features?.pois || []) {
    if (p.kind !== 'place_of_worship') continue;
    const rel = p.tags?.religion;
    if (rel !== 'muslim' && rel !== 'christian') continue;
    const [x, z] = p.p;
    // الواجهة ناحية أقرب شارع
    const r = W.nearestRoad(x, z, 80);
    const yaw = r ? Math.atan2(r.x - x, r.z - z) + (rel === 'christian' ? Math.PI : 0) : 0;
    const mesh = new THREE.Mesh(rel === 'muslim' ? mosqueGeo() : churchGeo(), mat);
    // لو المكان نفسه على الطريق: بنزقه لورا لحد ما يبعد عن الشارع
    let px = x, pz = z;
    const half = rel === 'muslim' ? 8.5 : 12.5;
    if (r && r.d < r.e.half + half) { const k = (r.e.half + half + 1 - r.d) / Math.max(0.1, r.d); px = x + (x - r.x) * k; pz = z + (z - r.z) * k; }
    mesh.position.set(px, 0, pz); mesh.rotation.y = yaw;
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = rel === 'muslim' ? 'mosque' : 'church';
    group.add(mesh);
    const hx = rel === 'muslim' ? 8 : 7, hz = rel === 'muslim' ? 8 : 12;
    W._addCollider({ cx: px, cz: pz, hx, hz, angle: yaw, restitution: 0.1, kind: 'building' }, null);
    if (rel === 'muslim') W._addCollider({ cx: px + Math.cos(yaw) * 6.5 + Math.sin(yaw) * 6.5, cz: pz - Math.sin(yaw) * 6.5 + Math.cos(yaw) * 6.5, hx: 1.6, hz: 1.6, angle: yaw, restitution: 0.1, kind: 'building' }, null);
    (W.exclude ||= []).push({ cx: px, cz: pz, hx: hx + 3, hz: hz + 3, angle: yaw });
    out.push({ name: p.name, kind: rel === 'muslim' ? 'mosque' : 'church', x: px, z: pz, osm: p.osm });
  }
  return out;
}
