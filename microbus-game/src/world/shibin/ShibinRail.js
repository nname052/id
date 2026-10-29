// =====================================================================
//  السكة الحديد الشغالة في شبين (من خطوط OSM الحقيقية):
//  - الخط الرئيسي: أطول مسار متصل في شبكة القضبان (من الشمال لحد الجنوب، عدّى على محطة شبين والمحطة الجديدة)
//  - قطر (جرار + 5 عربيات ركاب) رايح جاي على الخط، بيهدّي ويقف في المحطات، وكل عربية ماشية على المنحنى بتاعها
//  - المزلقانات: مكان ما الخط بيقطع شارع أرضي (مش نفق): بوابات بتنزل + نور أحمر بيلمع + جرس قبل القطر،
//    العربيات بتقف (المرور + اللاعب: البوابة ليها تصادم وهي نازلة) وبتفتح بعد ما القطر يعدّي
//  - محطة شبين الكوم (مكانها من OSM): مبنى المحطة + رصيف + مظلة + إشارات أول وآخر الرصيف
//  - القطر نفسه تصادم تقيل (اللي يقف قدامه بيتخبط)
// =====================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { canvas, tex } from '../../render/textures.js';
import { edgesNear } from './ShibinData.js';

const _c = new THREE.Color();
const lin = (r, g, b) => { _c.setRGB(r, g, b, THREE.SRGBColorSpace); return [_c.r, _c.g, _c.b]; };
const M4 = (x, y, z, ry = 0, rx = 0, rz = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1));
function part(g, rgb, m) {
  g = g.index ? g.toNonIndexed() : g.clone();
  if (m) g.applyMatrix4(m);
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  const n = g.attributes.position.count, c = lin(...rgb), a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set(c, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

// ===================== المسار =====================
/** شبكة القضبان من قطع المربعات (_mmRail) → أطول مسار متصل كخط واحد { pts:[{x,z}], cum, length } */
export function mainLine(chunks) {
  const key = (x, z) => `${Math.round(x * 2)},${Math.round(z * 2)}`;
  const nodes = new Map(), edges = [];
  const node = (x, z) => { const k = key(x, z); let n = nodes.get(k); if (!n) nodes.set(k, (n = { k, x, z, e: [] })); return n; };
  for (const ch of chunks) {
    const p = ch.p; if (p.length < 4) continue;
    const pts = []; for (let i = 0; i < p.length; i += 2) pts.push({ x: p[i], z: p[i + 1] });
    let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    const a = node(pts[0].x, pts[0].z), b = node(pts[pts.length - 1].x, pts[pts.length - 1].z);
    const e = { a, b, pts, L }; edges.push(e); a.e.push(e); b.e.push(e);
  }
  if (!edges.length) return null;
  const dijkstra = (src) => {
    const dist = new Map([[src, 0]]), prev = new Map(), done = new Set();
    const Q = [src];
    while (Q.length) {
      let bi = 0; for (let i = 1; i < Q.length; i++) if (dist.get(Q[i]) < dist.get(Q[bi])) bi = i;
      const n = Q.splice(bi, 1)[0]; if (done.has(n)) continue; done.add(n);
      for (const e of n.e) {
        const m = e.a === n ? e.b : e.a, d = dist.get(n) + e.L;
        // تحويلة حادة (زاوية أكتر من 35°) مش مسار قطر حقيقي
        const pe = prev.get(n);
        if (pe) {
          const v1 = dirAt(pe.e, n, true), v2 = dirAt(e, n, false);
          if (v1[0] * v2[0] + v1[1] * v2[1] < 0.82) continue;
        }
        if (d < (dist.get(m) ?? Infinity)) { dist.set(m, d); prev.set(m, { n, e }); Q.push(m); }
      }
    }
    return { dist, prev };
  };
  // اتجاه القطعة عند العقدة (incoming = داخل للعقدة)
  function dirAt(e, n, incoming) {
    const P = e.pts, atA = e.a === n;
    const p0 = atA ? P[0] : P[P.length - 1], p1 = atA ? P[1] : P[P.length - 2];
    let dx = p0.x - p1.x, dz = p0.z - p1.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    return incoming ? [dx, dz] : [-dx, -dz];
  }
  // القطر: من أبعد طرف للطرف الأبعد منه (قطر الشبكة) — مرتين dijkstra
  const ends = [...nodes.values()].filter((n) => n.e.length === 1);
  const start0 = ends[0] || nodes.values().next().value;
  let r = dijkstra(start0);
  let far = start0; for (const [n, d] of r.dist) if (n.e.length === 1 && d > (r.dist.get(far) || 0)) far = n;
  r = dijkstra(far);
  let far2 = far; for (const [n, d] of r.dist) if (n.e.length === 1 && d > (r.dist.get(far2) || 0)) far2 = n;
  const seq = [];
  for (let n = far2; r.prev.has(n); n = r.prev.get(n).n) seq.unshift(r.prev.get(n));
  const pts = [];
  let cur = far;
  for (const { e } of seq) {
    const P = e.a === cur ? e.pts : [...e.pts].reverse();
    for (let i = pts.length ? 1 : 0; i < P.length; i++) pts.push(P[i]);
    cur = e.a === cur ? e.b : e.a;
  }
  const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  return { pts, cum, length: cum[cum.length - 1] };
}

function at(line, s, out = {}) {
  const { pts, cum } = line;
  s = Math.max(0, Math.min(line.length, s));
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
  const a = pts[lo], b = pts[hi], L = cum[hi] - cum[lo] || 1e-6, t = (s - cum[lo]) / L;
  out.x = a.x + (b.x - a.x) * t; out.z = a.z + (b.z - a.z) * t; out.dx = (b.x - a.x) / L; out.dz = (b.z - a.z) / L;
  return out;
}
/** أقرب مسافة على الخط لنقطة */
function project(line, x, z) {
  let best = { d: Infinity, s: 0 };
  const { pts, cum } = line;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], ex = b.x - a.x, ez = b.z - a.z, l2 = ex * ex + ez * ez || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / l2));
    const d = Math.hypot(x - (a.x + ex * t), z - (a.z + ez * t));
    if (d < best.d) best = { d, s: cum[i] + Math.sqrt(l2) * t };
  }
  return best;
}

// ===================== القطر =====================
const CAR_LEN = 20, LOCO_LEN = 18, GAP = 1.2, NCOACH = 5;
function trainTexture() {
  // جنب عربية الركاب: رمادي فاتح + شريط أزرق تحت الشبابيك + شبابيك غامقة + باب في كل طرف
  const c = canvas(1024, 128), x = c.getContext('2d');
  x.fillStyle = '#c9ccce'; x.fillRect(0, 0, 1024, 128);
  x.fillStyle = '#1f4f8f'; x.fillRect(0, 82, 1024, 18);
  x.fillStyle = '#d8b030'; x.fillRect(0, 100, 1024, 5);
  for (let i = 0; i < 11; i++) { x.fillStyle = '#1b2228'; x.fillRect(110 + i * 72, 30, 54, 42); x.fillStyle = 'rgba(255,255,255,0.18)'; x.fillRect(110 + i * 72, 30, 54, 8); }
  for (const dx of [30, 950]) { x.fillStyle = '#2a3036'; x.fillRect(dx, 22, 44, 92); }
  x.fillStyle = 'rgba(0,0,0,0.15)'; x.fillRect(0, 118, 1024, 10);
  const t = tex(c, { repeat: false, aniso: 4 });
  return t;
}
function coachGeo() {
  const W = 2.9, H = 3.0, L = CAR_LEN, grey = [0.78, 0.79, 0.8], dark = [0.12, 0.12, 0.13];
  const side = new THREE.PlaneGeometry(L, H - 0.5);
  return mergeGeometries([
    part(new THREE.BoxGeometry(W, 0.35, L), dark, M4(0, 0.95, 0)),                         // الشاسيه
    part(side.clone(), [1, 1, 1], M4(W / 2, 1.12 + (H - 0.5) / 2, 0, Math.PI / 2)),          // الجنب (بالصورة)
    part(side.clone(), [1, 1, 1], M4(-W / 2, 1.12 + (H - 0.5) / 2, 0, -Math.PI / 2)),
    part(new THREE.BoxGeometry(W - 0.02, H - 0.5, L - 0.02), grey, M4(0, 1.12 + (H - 0.5) / 2, 0)), // الجسم (جوه الجنبين)
    part(new THREE.CylinderGeometry(W / 2, W / 2, L, 10, 1, false, -Math.PI / 2, Math.PI), [0.62, 0.64, 0.66], M4(0, H + 0.62 - 0.92, 0, 0, Math.PI / 2).multiply(new THREE.Matrix4().makeScale(1, 1, 0.28))), // السقف المدوّر
    part(new THREE.BoxGeometry(2.3, 0.7, 2.6), dark, M4(0, 0.55, L / 2 - 3)),               // البوجي
    part(new THREE.BoxGeometry(2.3, 0.7, 2.6), dark, M4(0, 0.55, -L / 2 + 3)),
  ]);
}
function locoGeo() {
  const W = 3.0, L = LOCO_LEN, blue = [0.13, 0.3, 0.55], grey = [0.72, 0.73, 0.74], yel = [0.92, 0.72, 0.12], dark = [0.1, 0.1, 0.11];
  return mergeGeometries([
    part(new THREE.BoxGeometry(W, 0.45, L), dark, M4(0, 1.0, 0)),
    part(new THREE.BoxGeometry(W - 0.6, 2.3, L - 5.5), blue, M4(0, 2.4, -0.4)),            // الماكينة (أضيق)
    part(new THREE.BoxGeometry(W, 2.9, 3.2), grey, M4(0, 2.7, L / 2 - 1.6)),               // كابينة السواق قدام
    part(new THREE.BoxGeometry(W + 0.02, 0.5, 3.22), yel, M4(0, 1.5, L / 2 - 1.6)),        // شريط أصفر (رؤية)
    part(new THREE.BoxGeometry(2.4, 0.9, 0.05), [0.15, 0.22, 0.28], M4(0, 3.35, L / 2 + 0.01)), // الزجاج
    part(new THREE.BoxGeometry(W, 2.4, 2.0), grey, M4(0, 2.45, -L / 2 + 1.0)),             // كابينة ورا
    part(new THREE.SphereGeometry(0.16, 8, 6), [1, 0.96, 0.8], M4(0.8, 1.9, L / 2 + 0.05)),
    part(new THREE.SphereGeometry(0.16, 8, 6), [1, 0.96, 0.8], M4(-0.8, 1.9, L / 2 + 0.05)),
    part(new THREE.BoxGeometry(2.4, 0.8, 3.0), dark, M4(0, 0.55, L / 2 - 3.5)),
    part(new THREE.BoxGeometry(2.4, 0.8, 3.0), dark, M4(0, 0.55, -L / 2 + 3.5)),
    part(new THREE.BoxGeometry(0.6, 0.35, 0.6), dark, M4(0, 3.72, -1.5)),                  // الشكمان
  ]);
}

// ===================== المزلقان =====================
function barrierArmGeo(len) {
  // دراع أحمر وأبيض (مقسوم 8 خانات بالتبادل) + عمود
  const parts = [];
  const n = 8;
  for (let i = 0; i < n; i++) parts.push(part(new THREE.BoxGeometry(len / n, 0.12, 0.1), i % 2 ? [0.95, 0.95, 0.94] : [0.85, 0.08, 0.06], M4(len / n * (i + 0.5), 0, 0)));
  return mergeGeometries(parts);
}
function crossingPostGeo() {
  const dark = [0.18, 0.18, 0.19];
  return mergeGeometries([
    part(new THREE.CylinderGeometry(0.08, 0.08, 3.2, 8), [0.9, 0.9, 0.88], M4(0, 1.6, 0)),
    part(new THREE.BoxGeometry(0.9, 0.12, 0.06), [0.95, 0.95, 0.94], M4(0, 2.9, 0, 0, 0, 0.7)),  // علامة X (صليب)
    part(new THREE.BoxGeometry(0.9, 0.12, 0.06), [0.95, 0.95, 0.94], M4(0, 2.9, 0, 0, 0, -0.7)),
    part(new THREE.BoxGeometry(0.85, 0.32, 0.12), dark, M4(0, 2.35, 0)),
    part(new THREE.BoxGeometry(0.35, 0.5, 0.35), [0.3, 0.3, 0.3], M4(0, 0.85, 0)),            // صندوق ماتور البوابة
  ]);
}

export class ShibinRail {
  constructor(W, scene, { audio, low = false } = {}) {
    this.W = W; this.scene = scene; this.audio = audio; this.low = low;
    this.group = new THREE.Group(); this.group.name = 'rail-system';
    scene.add(this.group);
    this.line = mainLine(W._mmRail || []);
    this.crossings = []; this.trains = []; this.stations = [];
    if (!this.line || this.line.length < 400) return;
    this._stations();
    this._crossings();
    this._train();
  }

  // ---------- المحطات (أماكنها من المعالم المؤكدة في OSM) ----------
  _stations() {
    const W = this.W;
    for (const L of W.landmarks?.confirmed || []) {
      if (L.kind !== 'rail_station' && L.kind !== 'rail_halt') continue;
      const pj = project(this.line, L.x, L.z);
      if (pj.d > 80) continue;
      this.stations.push({ id: L.id, name: L.name, s: pj.s, main: L.id === W.mainStation?.()?.id });
    }
    this.stations.sort((a, b) => a.s - b.s);
    const st = this.stations.find((s) => s.main);
    if (st) this._buildStation(st);
  }

  _buildStation(st) {
    const W = this.W, q = at(this.line, st.s);
    const nx = -q.dz, nz = q.dx;
    // الجنب اللي فيه شوارع أقل قريب (المبنى مايتحطش على شارع)
    const free = (sd, off) => { for (let k = -60; k <= 60; k += 10) { const p = at(this.line, st.s + k); const x = p.x + nx * sd * off, z = p.z + nz * sd * off; const r = W.nearestRoad(x, z, 30); if (r && r.d < r.e.half + 2) return false; } return true; };
    let side = 1, off = 9;
    if (!free(1, 9)) { if (free(-1, 9)) side = -1; else if (free(1, 14)) off = 14; else if (free(-1, 14)) { side = -1; off = 14; } }
    st.side = side;
    const yaw = Math.atan2(q.dx, q.dz);
    const G = new THREE.Group(); G.name = 'shibin-station';
    // الرصيف: 160م، 0.75م ارتفاع، 4.5م عرض، حرف أصفر
    const plat = [], canopy = [];
    const PL = 160, PW = 4.5;
    const pOff = side * (2.1 + PW / 2);
    for (let k = -PL / 2; k < PL / 2; k += 8) {
      const a = at(this.line, st.s + k), b = at(this.line, st.s + k + 8);
      const ang = Math.atan2(b.x - a.x, b.z - a.z), cx = (a.x + b.x) / 2 - a.dz * pOff, cz = (a.z + b.z) / 2 + a.dx * pOff;
      const nxa = -a.dz, nza = a.dx;
      const segL = Math.hypot(b.x - a.x, b.z - a.z) + 0.05;
      plat.push(part(new THREE.BoxGeometry(PW, 0.75, segL), [0.66, 0.64, 0.6], M4(cx, 0.375, cz, ang)));
      plat.push(part(new THREE.BoxGeometry(0.3, 0.02, segL), [0.95, 0.78, 0.1], M4(cx - nxa * side * (PW / 2 - 0.25), 0.76, cz - nza * side * (PW / 2 - 0.25), ang)));
      if (Math.abs(k) < 44) {
        // المظلة: عواميد حديد + سقف صاج مايل
        if (Math.abs(k) % 16 === 0) for (const o of [-1.2]) canopy.push(part(new THREE.CylinderGeometry(0.1, 0.1, 3.6, 8), [0.25, 0.32, 0.4], M4(cx + nxa * side * o, 0.75 + 1.8, cz + nza * side * o, ang)));
        canopy.push(part(new THREE.BoxGeometry(PW + 0.8, 0.08, segL), [0.55, 0.6, 0.62], M4(cx, 4.4, cz, ang, 0, side * 0.06)));
        if (Math.abs(k) % 16 === 8) canopy.push(part(new THREE.BoxGeometry(1.6, 0.42, 0.5), [0.32, 0.22, 0.14], M4(cx + nxa * side * 0.6, 0.75 + 0.22, cz + nza * side * 0.6, ang))); // دكة
      }
      // تصادم الرصيف (من على الأرض)
      W._addCollider({ cx, cz, hx: PW / 2, hz: segL / 2, angle: ang, restitution: 0.1, kind: 'wall', yMax: 0.6 }, null);
    }
    const pm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    const pMesh = new THREE.Mesh(mergeGeometries(plat), pm); pMesh.receiveShadow = true; G.add(pMesh);
    const cMesh = new THREE.Mesh(mergeGeometries(canopy), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide })); cMesh.castShadow = true; G.add(cMesh);
    // مبنى المحطة: دورين، كريمي، بواكي في الدور الأرضي + يافطة "محطة شبين الكوم"
    const bOff = side * (2.1 + PW + 7);
    const bx = q.x + nx * bOff, bz = q.z + nz * bOff;
    const BL = 46, BW = 12, BH = 9.5;
    const fc = canvas(1024, 256), f = fc.getContext('2d');
    f.fillStyle = '#e3d3ab'; f.fillRect(0, 0, 1024, 256);
    f.fillStyle = '#c9b78b'; f.fillRect(0, 118, 1024, 10); f.fillRect(0, 0, 1024, 14);
    for (let i = 0; i < 12; i++) {
      const x0 = 20 + i * 83;
      f.fillStyle = '#3b2e22'; f.beginPath(); f.moveTo(x0, 250); f.lineTo(x0, 175); f.arc(x0 + 30, 175, 30, Math.PI, 0); f.lineTo(x0 + 60, 250); f.fill(); // بواكي
      f.fillStyle = '#5b6d75'; f.fillRect(x0 + 10, 40, 40, 60); f.fillStyle = '#c9b78b'; f.fillRect(x0 + 6, 100, 48, 6); // شبابيك فوق
    }
    f.fillStyle = '#11663a'; f.fillRect(312, 128, 400, 46);
    f.fillStyle = '#fff'; f.font = 'bold 34px Cairo, sans-serif'; f.textAlign = 'center'; f.textBaseline = 'middle'; f.direction = 'rtl';
    f.fillText(st.name || 'محطة القطر', 512, 152);
    const ft = tex(fc, { repeat: false, aniso: 4 });
    const bodyM = new THREE.MeshStandardMaterial({ color: 0xe3d3ab, roughness: 0.9 });
    const faceM = new THREE.MeshStandardMaterial({ map: ft, roughness: 0.85 });
    // الوش اللي ناحية السكة (−side) بالصورة، والباقي لون
    const mats = [bodyM, bodyM, bodyM, bodyM, bodyM, bodyM];
    // BoxGeometry: +x,−x,+y,−y,+z,−z — بندوّر المبنى بحيث محوره x = اتجاه الخط
    const bg = new THREE.BoxGeometry(BL, BH, BW);
    const bm = new THREE.Mesh(bg, mats);
    bm.position.set(bx, BH / 2, bz); bm.rotation.y = yaw - Math.PI / 2;
    // +z المحلي = ناحية الشارع أو السكة؟ بعد الدوران +z المحلي = (sin(yaw−π/2), cos(yaw−π/2)) = (−dz, dx)·… = n
    mats[side > 0 ? 5 : 4] = faceM; // الوش اللي بيبص للسكة
    mats[side > 0 ? 4 : 5] = faceM; // والوش اللي بيبص للشارع (نفس الواجهة)
    bm.castShadow = true; bm.receiveShadow = true; G.add(bm);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(BL + 0.6, 0.5, BW + 0.6), new THREE.MeshStandardMaterial({ color: 0xc9b78b, roughness: 0.9 }));
    roof.position.set(bx, BH + 0.25, bz); roof.rotation.y = yaw - Math.PI / 2; G.add(roof);
    const bcol = { cx: bx, cz: bz, hx: BW / 2, hz: BL / 2, angle: yaw, restitution: 0.1, kind: 'building' };
    W._addCollider(bcol, null);
    // مبنى المحطة الحقيقي (footprint من OSM) لو اتحمل: بيحل محل الصندوق ده (realStationLoaded)
    this._stBox = { meshes: [bm, roof], col: bcol, x: q.x, z: q.z };
    // العمارات المولّدة اللي في مكان المحطة بتتشال (W.exclude بيتطبق على المربعات اللي لسه هتتحمل)
    (W.exclude ||= []).push({ cx: (bx + q.x) / 2, cz: (bz + q.z) / 2, hx: Math.abs(bOff) / 2 + BW / 2 + 2, hz: PL / 2 + 4, angle: yaw });
    // إشارات أول وآخر الرصيف (أحمر/أخضر)
    this.signals = [];
    const sigGeo = mergeGeometries([part(new THREE.CylinderGeometry(0.1, 0.1, 4.2, 8), [0.2, 0.2, 0.22], M4(0, 2.1, 0)), part(new THREE.BoxGeometry(0.5, 1.0, 0.35), [0.08, 0.08, 0.09], M4(0, 4.4, 0))]);
    const sm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
    for (const k of [-PL / 2 - 6, PL / 2 + 6]) {
      const a = at(this.line, st.s + k), x = a.x - a.dz * -side * 2.6, z = a.z + a.dx * -side * 2.6;
      const m = new THREE.Mesh(sigGeo, sm); m.position.set(x, 0, z); m.rotation.y = Math.atan2(a.dx, a.dz) + (k < 0 ? 0 : Math.PI); G.add(m);
      const red = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff2010, emissiveIntensity: 2 }));
      const grn = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshStandardMaterial({ color: 0x003000, emissive: 0x20ff40, emissiveIntensity: 0 }));
      for (const [b, y] of [[red, 4.62], [grn, 4.2]]) { b.position.set(0, y, 0.2); m.add(b); }
      this.signals.push({ s: st.s + k, red, grn });
    }
    this.group.add(G);
    this.stationGroup = G;
  }

  /** المربع اللي فيه مبنى المحطة الحقيقي اتحمل → نشيل المبنى التقريبي (المنصة والمظلة والإشارات بيفضلوا) */
  realStationLoaded(rb) {
    const B = this._stBox; if (!B || B.replaced) return;
    let cx = 0, cz = 0, n = 0; for (let i = 0; i < rb.v.length; i += 2) { cx += rb.v[i]; cz += rb.v[i + 1]; n++; }
    cx /= n; cz /= n;
    if (Math.hypot(cx - B.x, cz - B.z) > 90) return;
    for (const m of B.meshes) m.removeFromParent();
    B.col.dead = true; B.replaced = true;
  }

  // ---------- المزلقانات ----------
  _crossings() {
    const W = this.W, line = this.line, seen = [];
    const cross = (a, b, c, d) => { const d1 = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x), d2 = (b.x - a.x) * (d.z - a.z) - (b.z - a.z) * (d.x - a.x), d3 = (d.x - c.x) * (a.z - c.z) - (d.z - c.z) * (a.x - c.x), d4 = (d.x - c.x) * (b.z - c.z) - (d.z - c.z) * (b.x - c.x); return d1 * d2 <= 0 && d3 * d4 <= 0 && (d1 !== 0 || d2 !== 0); }; // (<=: نقطة مشتركة بين الخط والشارع بتتحسب)
    for (let i = 0; i < line.pts.length - 1; i++) {
      const a = line.pts[i], b = line.pts[i + 1];
      for (const e of edgesNear(W.graph, (a.x + b.x) / 2, (a.z + b.z) / 2, Math.hypot(b.x - a.x, b.z - a.z) / 2 + 30)) {
        if (e.elevated || e.closed || e.tunnel || /نفق/.test(e.name || '')) continue;
        for (let j = 0; j < e.pts.length - 1; j++) {
          const c = e.pts[j], d = e.pts[j + 1];
          if (!cross(a, b, c, d)) continue;
          // نقطة التقاطع
          const den = (b.x - a.x) * (d.z - c.z) - (b.z - a.z) * (d.x - c.x); if (Math.abs(den) < 1e-9) continue; const t = ((c.x - a.x) * (d.z - c.z) - (c.z - a.z) * (d.x - c.x)) / den;
          const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
          if (seen.some((p) => Math.hypot(p.x - x, p.z - z) < 25)) continue;
          const s = line.cum[i] + Math.hypot(x - a.x, z - a.z);
          const rl = Math.hypot(d.x - c.x, d.z - c.z) || 1;
          seen.push({ x, z });
          this.crossings.push({ x, z, s, e, rdx: (d.x - c.x) / rl, rdz: (d.z - c.z) / rl, half: e.half, name: e.name, down: 0, closed: false, bell: 0 });
        }
      }
    }
    // في OSM المزلقان نقطة مشتركة بين الخط والشارع (railway=level_crossing) → رأس الخط واقع على خط الشارع بالظبط
    for (let i = 0; i < line.pts.length; i++) {
      const q = line.pts[i], r = W.nearestRoad(q.x, q.z, 12);
      if (!r || r.d > 1.0 || r.e.elevated || r.e.closed || r.e.tunnel || /نفق/.test(r.e.name || '')) continue;
      if (seen.some((p) => Math.hypot(p.x - q.x, p.z - q.z) < 25)) continue;
      seen.push({ x: q.x, z: q.z });
      this.crossings.push({ x: r.x, z: r.z, s: line.cum[i], e: r.e, rdx: r.dx, rdz: r.dz, half: r.e.half, name: r.e.name, down: 0, closed: false, bell: 0 });
    }
    // البوابات والعلامات
    const armM = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 });
    const postM = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
    const postG = crossingPostGeo();
    for (const C of this.crossings) {
      const tq = at(line, C.s), tnx = -tq.dz, tnz = tq.dx; // عمودي على السكة
      const G = new THREE.Group(); G.name = 'level-crossing';
      C.arms = []; C.lamps = []; C.cols = [];
      for (const sd of [-1, 1]) {
        // على كل ناحية من السكة: بوابة على يمين الشارع (بتقفل الحارة الجاية) + عمود إشارة
        const bx = C.x + tq.dx * 0 + C.rdx * sd * 5.2, bz = C.z + C.rdz * sd * 5.2; // 5.2م من نص السكة على الشارع
        const px = -C.rdz, pz = C.rdx; // عمودي على الشارع
        for (const side of [-1, 1]) {
          const ox = bx + px * side * (C.half + 0.6), oz = bz + pz * side * (C.half + 0.6);
          const post = new THREE.Mesh(postG, postM); post.position.set(ox, 0, oz); post.rotation.y = Math.atan2(C.rdx, C.rdz) * 1; G.add(post);
          const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), new THREE.MeshStandardMaterial({ color: 0x300000, emissive: 0xff1a08, emissiveIntensity: 0 }));
          lamp.position.set(ox + C.rdx * -sd * 0.08, 2.35, oz + C.rdz * -sd * 0.08); G.add(lamp); C.lamps.push(lamp);
          if (side !== sd) continue; // الدراع على ناحية واحدة بس من كل جنب (نص الشارع)
          const len = C.half + 0.3;
          const pivot = new THREE.Group(); pivot.position.set(ox, 1.0, oz);
          // الدراع بيتمد ناحية نص الشارع (−side * عمودي)
          pivot.rotation.y = Math.atan2(-px * side, -pz * side) - Math.PI / 2;
          const arm = new THREE.Mesh(barrierArmGeo(len), armM); pivot.add(arm); G.add(pivot);
          C.arms.push(pivot);
          // تصادم الدراع وهو نازل: من العمود لنص الشارع
          C.cols.push({ cx: ox - px * side * len / 2, cz: oz - pz * side * len / 2, hx: len / 2, hz: 0.15, angle: Math.atan2(px, pz) + Math.PI / 2, restitution: 0.3, kind: 'prop' });
        }
      }
      // ألواح خشب/أسفلت بين القضبان (المزلقان نفسه)
      const deck = new THREE.Mesh(new THREE.BoxGeometry(C.half * 2 + 1, 0.06, 3.4), new THREE.MeshStandardMaterial({ color: 0x3a3632, roughness: 1 }));
      deck.position.set(C.x, 0.03, C.z); deck.rotation.y = Math.atan2(tq.dx, tq.dz) + Math.PI / 2; deck.receiveShadow = true; G.add(deck);
      void tnx; void tnz;
      this.group.add(G);
      C.group = G;
    }
  }

  // ---------- القطر ----------
  _train() {
    const coachT = trainTexture();
    const cMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: coachT, roughness: 0.55, metalness: 0.15 });
    const lMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.2 });
    const cg = coachGeo(), lg = locoGeo();
    // الـ UV: الوشين بالصورة (PlaneGeometry عندها UV صح)، الباقي (0,0) = لون رمادي من ركن الصورة
    const T = { s: 0, dir: 1, v: 0, state: 'run', wait: 0, cars: [], visible: false, len: LOCO_LEN + NCOACH * (CAR_LEN + GAP) };
    const mk = (geo, mat, len) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; m.visible = false; this.group.add(m); return { m, len, col: { cx: 0, cz: 0, hx: 1.5, hz: len / 2, angle: 0, restitution: 0.1, kind: 'car', mass: 60000, vx: 0, vz: 0, train: true } }; };
    T.cars.push(mk(lg, lMat, LOCO_LEN));
    for (let i = 0; i < NCOACH; i++) T.cars.push(mk(cg, cMat, CAR_LEN));
    // بيبدأ قبل محطة شبين بشوية (عشان اللاعب يشوفه بدري)
    const st = this.stations.find((s) => s.main);
    T.s = st ? Math.max(T.len + 10, st.s - 900) : T.len + 10;
    this.trains.push(T);
  }

  /** نقطة الوقوف الجاية في اتجاه السير (محطة) */
  _nextStop(T) {
    let best = null;
    // الوقوف: القطر كله في نص الرصيف (الجرار بيعدّي نقطة المحطة بنص طول القطر)
    for (const st of this.stations) { if (st === T.lastStop) continue; const d = (st.s - T.s) * T.dir + T.len / 2; if (d > -1 && (!best || d < best.d)) best = { d, st }; }
    return best;
  }

  update(dt, cam) {
    if (!this.trains.length) return;
    const line = this.line;
    for (const T of this.trains) {
      const VMAX = 17; // ~60 كم/س جوه المدينة
      if (T.state === 'stop') {
        T.v = 0; T.wait -= dt;
        if (T.wait <= 0) { T.state = 'run'; T.lastStop = T.stopAt; }
      } else if (T.state === 'away') {
        // برا المنطقة (اتجاه ما خرج): بيرجع بعد شوية من نفس الطرف بالعكس
        T.wait -= dt; T.v = 0;
        if (T.wait <= 0) { T.state = 'run'; T.dir = -T.dir; }
      } else {
        let vT = VMAX;
        const ns = this._nextStop(T);
        if (ns && ns.st !== T.lastStop) {
          // فرملة ناعمة للمحطة: v² = 2·a·d (القطر بيقف بالجرار قدام نص الرصيف + نص طول القطر)
          const stopD = ns.d - (T.dir > 0 ? 0 : 0) + T.len / 2 * 0;
          vT = Math.min(vT, Math.sqrt(Math.max(0, 2 * 0.55 * (stopD - 1))));
          if (stopD < 1.5 && T.v < 0.6) { T.state = 'stop'; T.wait = 25; T.stopAt = ns.st; }
        }
        // فرامل بتلحق منحنى الوقوف (1 م/ث² > 0.55 بتاع المنحنى) — قبل كده كانت متناسبة مع الفرق فبتتأخر وتعدّي المحطة
        T.v = T.v > vT ? Math.max(vT, T.v - 1.0 * dt) : Math.min(vT, T.v + 0.45 * dt);
        T.s += T.v * T.dir * dt;
        // وصل لآخر الخط: خرج من المنطقة
        if (T.s > line.length + 30 || T.s < -30) { T.state = 'away'; T.wait = 40; T.s = Math.max(-30, Math.min(line.length + 30, T.s)); T.lastStop = null; }
      }
      // أماكن العربيات: الجرار في المقدمة (اتجاه السير) والعربيات وراه، كل واحدة بين البوجيين بتوعها
      let off = 0;
      const near = Math.hypot(at(line, T.s).x - cam.x, at(line, T.s).z - cam.z) < 900;
      T.visible = near;
      const q0 = {}, q1 = {};
      for (let i = 0; i < T.cars.length; i++) {
        const c = T.cars[i];
        const sF = T.s - T.dir * off, sB = sF - T.dir * c.len;
        at(line, sF, q0); at(line, sB, q1);
        const cx = (q0.x + q1.x) / 2, cz = (q0.z + q1.z) / 2, yaw = Math.atan2(q0.x - q1.x, q0.z - q1.z);
        c.m.visible = near && sF > -5 && sB < line.length + 5 && T.state !== 'away';
        c.m.position.set(cx, 0.2, cz); c.m.rotation.set(0, yaw, 0);
        Object.assign(c.col, { cx, cz, angle: yaw, vx: Math.sin(yaw) * T.v, vz: Math.cos(yaw) * T.v });
        c.sF = sF; c.sB = sB;
        off += c.len + GAP;
      }
      T.sTail = T.s - T.dir * (off - GAP);
    }
    // المزلقانات: تقفل لو قطر جاي (أقل من 320م وماشي ناحيتها) أو جسمه عليها
    const t = performance.now() / 1000;
    if (this.stationGroup) { const b = this.stationGroup.children[2]; this.stationGroup.visible = !b || Math.hypot(b.position.x - cam.x, b.position.z - cam.z) < 650; }
    for (const C of this.crossings) {
      C.group.visible = Math.hypot(C.x - cam.x, C.z - cam.z) < 380; // البعيد مايترسمش (كل مزلقان ~11 draw call)
      let close = false;
      for (const T of this.trains) {
        if (T.state === 'away') continue;
        const ahead = (C.s - T.s) * T.dir, tail = (C.s - T.sTail) * T.dir;
        if ((ahead > -2 && ahead < 320) || (ahead <= 0 && tail >= -8)) close = true;
      }
      C.closed = close;
      C.down += ((close ? 1 : 0) - C.down) * Math.min(1, dt * 0.9);
      for (const p of C.arms) p.children[0].rotation.z = (1 - C.down) * Math.PI / 2 * 0.98;
      const blink = close ? (Math.floor(t * 2) % 2) : -1;
      C.lamps.forEach((l, i) => { l.material.emissiveIntensity = blink < 0 ? 0 : (i % 2 === blink ? 3 : 0.2); });
      // جرس المزلقان (قريب من الكاميرا بس)
      if (close && this.audio && Math.hypot(C.x - cam.x, C.z - cam.z) < 140) {
        C.bell -= dt; if (C.bell <= 0) { C.bell = 0.55; this.audio.honk?.(C.x, 2.2, C.z, 2.6, true); }
      }
    }
    if (this.signals) for (const s of this.signals) { const busy = this.trains.some((T) => T.state !== 'away' && Math.abs(T.s - s.s) < 260); s.red.material.emissiveIntensity = busy ? 2.5 : 0.15; s.grn.material.emissiveIntensity = busy ? 0 : 2; }
  }

  /** بوابات المزلقان النازلة + جسم القطر */
  colliders(box, out) {
    for (const C of this.crossings) if (C.down > 0.6 && Math.abs(C.x - box.cx) < 30 && Math.abs(C.z - box.cz) < 30) for (const c of C.cols) out.push(c);
    for (const T of this.trains) for (const c of T.cars) if (c.m.visible && Math.abs(c.col.cx - box.cx) < 30 && Math.abs(c.col.cz - box.cz) < 30) out.push(c.col);
  }

  /** للمرور: أماكن لازم يقف قبلها دلوقتي (مزلقان مقفول) */
  get stopZones() { return this.crossings.filter((C) => C.closed).map((C) => ({ x: C.x, z: C.z, r: 7.5 })); }

  debugStats() {
    const T = this.trains[0];
    return { lineKm: +(this.line?.length / 1000 || 0).toFixed(2), stations: this.stations.map((s) => s.name), crossings: this.crossings.map((C) => C.name || '?'), train: T && { s: Math.round(T.s), v: +T.v.toFixed(1), state: T.state, dir: T.dir }, closed: this.crossings.filter((C) => C.closed).length };
  }
}
