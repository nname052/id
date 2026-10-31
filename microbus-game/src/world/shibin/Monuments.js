// =====================================================================
//  المعالم المشهورة (مكانها وشكلها الأرضي من OSM — مفيش مكان متألف):
//  - الأهرامات: من مضلع كل هرم في OSM (القاعدة الحقيقية واتجاهها) + الارتفاع المعروف (خوفو 138.5م، خفرع 136.4م،
//    منقرع 61م؛ الباقي ≈ 0.62 من القاعدة). مداميك حجر + طبقة الكسوة اللي فاضلة فوق خفرع
//  - أبو الهول (73م طول، 20م ارتفاع) — شكل مبسّط بالحجر
//  - برج القاهرة (187م: جسم شبكي زي زهرة اللوتس + الكابينة فوق)
//  - عمود السواري (27م بتاجه)، قلعة قايتباي (الأسوار + البرج الأوسط بأبراجه الأربعة)،
//    مكتبة الإسكندرية (القرص المايل 160م)
//  الشكل مبني بالكود (مفيش موديل حر واقعي متاح لده)، بخامة حجر/خرسانة مرسومة — مش لو بولي ملون.
// =====================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { canvas, tex } from '../../render/textures.js';

// الارتفاعات المعروفة (متر)
const PYR_H = [[/خوفو/, 138.5], [/خفرع/, 136.4], [/منقرع/, 61]];

/** خامة حجر جيري بمداميك (صفوف حجر أفقية) */
let _stone = null;
function stoneTex() {
  if (_stone) return _stone;
  const c = canvas(512, 512), x = c.getContext('2d');
  x.fillStyle = '#c9a877'; x.fillRect(0, 0, 512, 512);
  let s = 7;
  const R = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let row = 0; row < 16; row++) {
    const y0 = row * 32;
    let xx = -R() * 60;
    while (xx < 512) {
      const w = 40 + R() * 70, sh = 0.85 + R() * 0.25;
      x.fillStyle = `rgb(${Math.round(201 * sh)},${Math.round(168 * sh)},${Math.round(119 * sh)})`;
      x.fillRect(xx + 1, y0 + 2, w - 2, 28);
      xx += w;
    }
    x.fillStyle = 'rgba(70,50,30,0.55)'; x.fillRect(0, y0 + 28, 512, 4); // ضل تحت كل مدماك
  }
  for (let i = 0; i < 2500; i++) { x.fillStyle = `rgba(${R() < 0.5 ? '255,240,210' : '60,40,20'},${0.08 + R() * 0.1})`; x.fillRect(R() * 512, R() * 512, 1 + R() * 3, 1 + R() * 3); }
  _stone = tex(c);
  return _stone;
}

/** UV بالمتر حسب اتجاه الوش (الحجر مايتمطش على الحيطان الطويلة): كل s متر = تكرار واحد للخامة */
function worldUV(g, s = 12.8, ox = 0, oz = 0) {
  const p = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + ox, y = p.getY(i), z = p.getZ(i) + oz, ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    if (ay > ax && ay > az) { uv[i * 2] = x / s; uv[i * 2 + 1] = z / s; }
    else if (ax > az) { uv[i * 2] = z / s; uv[i * 2 + 1] = y / s; }
    else { uv[i * 2] = x / s; uv[i * 2 + 1] = y / s; }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** القاعدة: أصغر مستطيل حوالين المضلع على اتجاه أطول ضلع (الأهرامات متوجهة للشمال تقريبًا) */
function obb(fp) {
  let best = null;
  for (let i = 0; i < fp.length - 1; i++) {
    const [ax, az] = fp[i], [bx, bz] = fp[i + 1], L = Math.hypot(bx - ax, bz - az);
    if (L < 1) continue;
    const ux = (bx - ax) / L, uz = (bz - az) / L;
    let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
    for (const [x, z] of fp) { const u = x * ux + z * uz, v = -x * uz + z * ux; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) best = { area, ux, uz, u0, u1, v0, v1 };
  }
  if (!best) return null;
  const { ux, uz, u0, u1, v0, v1 } = best, cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
  return { cx: cu * ux - cv * uz, cz: cu * uz + cv * ux, hw: (u1 - u0) / 2, hd: (v1 - v0) / 2, ang: Math.atan2(uz, ux) };
}

function pyramidGeo(hw, hd, h) {
  // 4 وشوش مثلثات + UV بالمتر (المداميك 1.6م = صف حجر في الخامة / 2)
  const pos = [], uv = [], top = [0, h, 0];
  const C = [[-hw, 0, -hd], [hw, 0, -hd], [hw, 0, hd], [-hw, 0, hd]];
  for (let i = 0; i < 4; i++) {
    const a = C[i], b = C[(i + 1) % 4], L = Math.hypot(b[0] - a[0], b[2] - a[2]);
    pos.push(...a, ...top, ...b);
    const slant = Math.hypot(h, (i % 2 ? hw : hd));
    uv.push(0, 0, L / 2 / 25.6, slant / 25.6, L / 25.6, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** المطار (OSM aeroway=runway/taxiway): خرسانة فاتحة + خط النص المتقطع + علامات أول الممر (البيانو) */
export function buildAirport(W, aero, group) {
  if (!aero?.length) return 0;
  const pos = [], col = [], idx = [];
  const quad = (a, b, c, d, rgb, y) => {
    const k = pos.length / 3;
    for (const p of [a, b, c, d]) { pos.push(p[0], y, p[1]); col.push(...rgb); }
    idx.push(k, k + 2, k + 1, k, k + 3, k + 2);
  };
  const lin = (h) => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };
  const RUN = lin(0x8d8a84), TAXI = lin(0x7a7873), WHITE = lin(0xf2f2ee), YEL = lin(0xe8c22a);
  for (const a of aero) {
    const P = []; for (let i = 0; i + 1 < a.p.length; i++) P.push(a.p[i]);
    P.push(a.p[a.p.length - 1]);
    const hw = a.w / 2, runway = a.kind === 'runway';

    for (let i = 0; i + 1 < P.length; i++) {
      const [ax, az] = P[i], [bx, bz] = P[i + 1], L = Math.hypot(bx - ax, bz - az); if (L < 0.5) continue;
      const ux = (bx - ax) / L, uz = (bz - az) / L, nx = -uz, nz = ux;
      const e = (x, z, o, s) => [x + nx * o + ux * s, z + nz * o + uz * s];
      quad(e(ax, az, -hw, 0), e(ax, az, hw, 0), e(bx, bz, hw, 0), e(bx, bz, -hw, 0), runway ? RUN : TAXI, 0.03);
      // خط النص: أبيض متقطع (الممر) / أصفر متصل (الطرق الفرعية)
      for (let s = 0; s < L; s += runway ? 50 : L) {
        const l2 = Math.min(runway ? 30 : L, L - s);
        quad(e(ax, az, -0.45, s), e(ax, az, 0.45, s), e(ax, az, 0.45, s + l2), e(ax, az, -0.45, s + l2), runway ? WHITE : YEL, 0.05);
      }

    }
    // البيانو في أول وآخر الممر
    if (runway && P.length >= 2) for (const [p0, p1] of [[P[0], P[1]], [P[P.length - 1], P[P.length - 2]]]) {
      const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1, ux = (p1[0] - p0[0]) / L, uz = (p1[1] - p0[1]) / L, nx = -uz, nz = ux;
      for (let k = -6; k <= 6; k++) {
        if (k === 0) continue;
        const o = k * (hw / 7.5), w = hw / 22;
        const e = (oo, s) => [p0[0] + nx * oo + ux * s, p0[1] + nz * oo + uz * s];
        quad(e(o - w, 6), e(o + w, 6), e(o + w, 36), e(o - w, 36), WHITE, 0.05);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  m.name = 'airport'; m.receiveShadow = true; group.add(m);
  return aero.length;
}

export function buildMonuments(W, group) {
  const out = [];
  const L = W.landmarks?.confirmed || [];
  const stone = new THREE.MeshStandardMaterial({ map: stoneTex(), roughness: 0.93, color: 0xffffff });
  const casing = new THREE.MeshStandardMaterial({ color: 0xe6d6b4, roughness: 0.8 });
  const concrete = new THREE.MeshStandardMaterial({ color: 0xd9d3c7, roughness: 0.85 });
  const zone = (cx, cz, hx, hz, ang, poly) => {
    (W.exclude ||= []).push({ cx, cz, hx, hz, angle: ang });
    if (poly) (W.monumentZones ||= []).push(poly); // (المباني الحقيقية من OSM اللي جوه المعلم نفسه — زي "مبنى" الهرم — مابتتبنيش)
  };
  const add = (mesh, name) => { mesh.name = name; mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh); };

  // موديل حقيقي (Sketchfab CC BY — tools/models/sketchfab.mjs) لو موجود: بيتحط مكان الشكل اللي بالكود
  const real = (key, l, ang = 0) => {
    const a = W.assets?.get?.(key); if (!a) return false;
    const m = a.holder.clone(); m.position.set(l.x, 0, l.z); m.rotation.y = ang;
    m.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    group.add(m); return true;
  };
  for (const l of L) {
    const name = l.name || '';
    // ===== الأهرامات =====
    if (l.kind === 'pyramid' && l.footprint?.length >= 4) {
      const b = obb(l.footprint); if (!b || b.hw < 4) continue;
      const known = PYR_H.find(([re]) => re.test(name));
      const h = known ? known[1] : Math.min(b.hw, b.hd) * 2 * 0.62;
      const g = pyramidGeo(b.hw, b.hd, h);
      const m = new THREE.Mesh(g, stone);
      m.position.set(b.cx, 0, b.cz); m.rotation.y = -b.ang;
      add(m, 'pyramid');
      // خفرع: الكسوة الأصلية لسه فوق (حوالي الربع اللي فوق)
      if (/خفرع/.test(name)) {
        const k = 0.24, cap = new THREE.Mesh(pyramidGeo(b.hw * k, b.hd * k, h * k), casing);
        cap.position.set(b.cx, h * (1 - k) + 0.05, b.cz); cap.rotation.y = -b.ang; add(cap, 'pyramid-casing');
      }
      W._addCollider({ cx: b.cx, cz: b.cz, hx: b.hw * 0.92, hz: b.hd * 0.92, angle: -b.ang, restitution: 0.1, kind: 'building' }, null);
      zone(b.cx, b.cz, b.hw + 4, b.hd + 4, -b.ang, l.footprint);
      out.push({ name, kind: 'pyramid', h: +h.toFixed(1) });
      continue;
    }
    // ===== أبو الهول =====
    if (/^أبو الهول$|^أبي الهول$/.test(name)) {
      const b = l.footprint ? obb(l.footprint) : null;
      const len = 73, ang = b ? -b.ang : 0, cx = b ? b.cx : l.x, cz = b ? b.cz : l.z;
      if (real('mon_sphinx', { x: cx, z: cz }, ang)) {
        W._addCollider({ cx, cz, hx: len / 2, hz: 8, angle: ang, restitution: 0.1, kind: 'building' }, null);
        zone(cx, cz, len / 2 + 3, 10, ang, l.footprint); out.push({ name, kind: 'sphinx', model: 'real' }); continue;
      }
      const P = [];
      P.push(new THREE.BoxGeometry(len * 0.62, 11, 14).translate(-len * 0.12, 5.5, 0));               // الجسم
      P.push(new THREE.BoxGeometry(14, 13, 12).translate(len * 0.22, 9.5, 0));                        // الصدر
      P.push(new THREE.BoxGeometry(22, 3.2, 3.6).translate(len * 0.36, 1.6, -4.6));                   // الرجلين القدام
      P.push(new THREE.BoxGeometry(22, 3.2, 3.6).translate(len * 0.36, 1.6, 4.6));
      P.push(new THREE.BoxGeometry(8.5, 9, 8.2).translate(len * 0.25, 18.5, 0));                      // الراس
      P.push(new THREE.BoxGeometry(5.5, 7, 11.5).translate(len * 0.23, 17.5, 0));                     // غطا الراس (النمس)
      P.push(new THREE.BoxGeometry(2.2, 2.8, 2.6).translate(len * 0.31, 17.5, 0));                    // الوش لقدام
      const g = worldUV(mergeGeometries(P.map((q) => q.toNonIndexed())), 6.4);
      const m = new THREE.Mesh(g, stone); m.position.set(cx, 0, cz); m.rotation.y = ang; add(m, 'sphinx');
      W._addCollider({ cx, cz, hx: len / 2, hz: 8, angle: ang, restitution: 0.1, kind: 'building' }, null);
      zone(cx, cz, len / 2 + 3, 10, ang, l.footprint);
      out.push({ name, kind: 'sphinx' });
      continue;
    }
    // ===== برج القاهرة =====
    if (/برج القاهرة/.test(name)) {
      const H = 187, P = [];
      if (real('mon_cairo_tower', l)) {
        W._addCollider({ cx: l.x, cz: l.z, hx: 7.5, hz: 7.5, angle: 0, restitution: 0.1, kind: 'building' }, null);
        zone(l.x, l.z, 14, 14, 0, null); out.push({ name, kind: 'tower', h: H, model: 'real' }); continue;
      }
      // الجسم الشبكي: أسطوانة بتضيق شوية لفوق وبتفتح تاني تحت الكابينة (زهرة اللوتس)
      const prof = [[7.2, 0], [6.4, 30], [5.6, 90], [5.4, 140], [6.6, 152], [8.5, 158]].map(([r, y]) => new THREE.Vector2(r, y));
      const body = new THREE.LatheGeometry(prof, 24);
      const lt = latticeTex();
      const bm = new THREE.MeshStandardMaterial({ map: lt, roughness: 0.75, color: 0xffffff });
      const bmesh = new THREE.Mesh(body, bm); bmesh.position.set(l.x, 0, l.z); add(bmesh, 'cairo-tower');
      P.push(new THREE.CylinderGeometry(8.6, 8.6, 9, 24).translate(0, 163, 0));   // الكابينة (المطعم الدوّار)
      P.push(new THREE.CylinderGeometry(9.2, 8.6, 1.2, 24).translate(0, 168, 0));
      P.push(new THREE.CylinderGeometry(4, 6, 8, 16).translate(0, 172.5, 0));
      P.push(new THREE.CylinderGeometry(0.6, 1.2, H - 176, 8).translate(0, 176 + (H - 176) / 2, 0)); // الأنتين
      const top = new THREE.Mesh(mergeGeometries(P), concrete); top.position.set(l.x, 0, l.z); add(top, 'cairo-tower-top');
      W._addCollider({ cx: l.x, cz: l.z, hx: 7.5, hz: 7.5, angle: 0, restitution: 0.1, kind: 'building' }, null);
      zone(l.x, l.z, 14, 14, 0, null);
      out.push({ name, kind: 'tower', h: H });
      continue;
    }
    // ===== عمود السواري =====
    if (/عامود السوار|عمود السوار/.test(name) && !/الحديقة/.test(name)) {
      const P = [new THREE.BoxGeometry(5, 4, 5).translate(0, 2, 0), new THREE.CylinderGeometry(1.15, 1.4, 20.5, 20).translate(0, 4 + 10.25, 0),
        new THREE.CylinderGeometry(1.9, 1.2, 2.2, 16).translate(0, 25.6, 0), new THREE.BoxGeometry(3.6, 0.6, 3.6).translate(0, 27, 0)];
      const pm = new THREE.MeshStandardMaterial({ color: 0xb98c76, roughness: 0.7 }); // جرانيت أسوان الوردي
      const m = new THREE.Mesh(mergeGeometries(P), pm); m.position.set(l.x, 0, l.z); add(m, 'pompey-pillar');
      W._addCollider({ cx: l.x, cz: l.z, hx: 2.5, hz: 2.5, angle: 0, restitution: 0.1, kind: 'building' }, null);
      zone(l.x, l.z, 8, 8, 0, null);
      out.push({ name, kind: 'column', h: 27 });
      continue;
    }
    // ===== قلعة قايتباي =====
    if (/قلعة قايتباي/.test(name)) {
      // (لو المعلم جه من علاقة من غير مضلع: سور 140×120م حوالين مكانه — مقاس القلعة الحقيقي تقريبًا)
      if (!(l.footprint?.length >= 4)) l.footprint = [[-70, -60], [70, -60], [70, 60], [-70, 60], [-70, -60]].map(([x, z]) => [l.x + x, l.z + z]);
      const b = obb(l.footprint); if (!b) continue;
      const P = [], ang = -b.ang;
      // السور الخارجي على حدود المضلع (12م) + البرج الأوسط (17م، 30×30) بأبراج مدورة في الأركان
      const fp = l.footprint, D = []; // D: حاجات غامقة (شبابيك/مزاغل/البوابة)
      // شرّافات (merlons) على طول حرف حيطة من a لـ b على ارتفاع y
      const merlons = (ax, az, bx, bz, y, out) => {
        const Lw = Math.hypot(bx - ax, bz - az), n = Math.floor(Lw / 2.2), yaw = Math.atan2(bx - ax, bz - az);
        for (let k = 0; k < n; k++) { const u = (k + 0.5) / n; out.push(new THREE.BoxGeometry(1.3, 1.2, 1.0).rotateY(yaw).translate(ax + (bx - ax) * u, y + 0.6, az + (bz - az) * u)); }
      };
      const ringMerlons = (x, z, r, y, out) => { const n = Math.max(6, Math.round((2 * Math.PI * r) / 2.2)); for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; out.push(new THREE.BoxGeometry(1.0, 1.1, 0.8).rotateY(-a).translate(x + Math.cos(a) * r, y + 0.55, z + Math.sin(a) * r)); } };
      // السور الخارجي (11م) بشرّافات + أبراج مدورة في كل ركن (14م)
      for (let i = 0; i < fp.length - 1; i++) {
        const [ax, az] = fp[i], [bx, bz] = fp[i + 1], Lw = Math.hypot(bx - ax, bz - az); if (Lw < 0.5) continue;
        const ox = -l.x, oz = -l.z;
        P.push(new THREE.BoxGeometry(2.4, 11, Lw + 1.2).rotateY(Math.atan2(bx - ax, bz - az)).translate((ax + bx) / 2 + ox, 5.5, (az + bz) / 2 + oz));
        merlons(ax + ox, az + oz, bx + ox, bz + oz, 11, P);
        if (Lw > 6) {
          P.push(new THREE.CylinderGeometry(3.6, 4.2, 14, 16).translate(ax + ox, 7, az + oz));
          ringMerlons(ax + ox, az + oz, 3.3, 14, P);
          // مزاغل (فتحات رفيعة) في البرج
          for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + 0.4; D.push(new THREE.BoxGeometry(0.35, 1.6, 0.3).rotateY(-a).translate(ax + ox + Math.cos(a) * 4.0, 8, az + oz + Math.sin(a) * 4.0)); }
        }
      }
      const keep = Math.min(30, b.hw, b.hd) * 0.9, kh = keep / 2;
      // البرج الأوسط: كتلة 17م + دور فوق أصغر شوية، أبراج نص دايرة في الأركان أعلى منه، شرّافات، شبابيك مقوّسة، والمئذنة
      const K = [new THREE.BoxGeometry(keep, 17, keep).translate(0, 8.5, 0), new THREE.BoxGeometry(keep * 0.55, 4, keep * 0.55).translate(0, 19, 0)];
      for (const [x0, z0, x1, z1] of [[-kh, -kh, kh, -kh], [kh, -kh, kh, kh], [kh, kh, -kh, kh], [-kh, kh, -kh, -kh]]) merlons(x0, z0, x1, z1, 17, K);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) { K.push(new THREE.CylinderGeometry(3.4, 3.6, 20, 16).translate(sx * kh, 10, sz * kh)); ringMerlons(sx * kh, sz * kh, 3.1, 20, K); }
      // المئذنة: قاعدة مربعة ← بدن مثمن ← شرفة ← رأس مدبب
      K.push(new THREE.BoxGeometry(3, 3, 3).translate(0, 22.5, 0), new THREE.CylinderGeometry(1.2, 1.3, 7, 8).translate(0, 27.5, 0), new THREE.CylinderGeometry(1.8, 1.8, 0.5, 8).translate(0, 31, 0), new THREE.CylinderGeometry(0.8, 1.0, 3, 8).translate(0, 32.8, 0), new THREE.ConeGeometry(0.9, 2.2, 8).translate(0, 35.4, 0));
      const KD = [];
      for (let f = 0; f < 4; f++) {
        const a = f * Math.PI / 2, nx = Math.sin(a), nz = Math.cos(a), tx = Math.cos(a), tz = -Math.sin(a);
        for (const row of [7, 12.5]) for (const u of [-0.25, 0, 0.25]) KD.push(new THREE.BoxGeometry(1.3, 2.2, 0.3).rotateY(a).translate(nx * (kh + 0.05) + tx * u * keep, row, nz * (kh + 0.05) + tz * u * keep));
      }
      // البوابة المقوّسة في السور (أقرب حيطة لنص القلعة من ناحية البر = أول ضلع)
      { const [ax, az] = fp[0], [bx, bz] = fp[1], mx = (ax + bx) / 2 - l.x, mz = (az + bz) / 2 - l.z, yaw = Math.atan2(bx - ax, bz - az);
        D.push(new THREE.BoxGeometry(2.6, 5.5, 4.2).rotateY(yaw).translate(mx, 2.75, mz), new THREE.CylinderGeometry(2.1, 2.1, 2.6, 12, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(yaw).translate(mx, 5.5, mz)); }
      const keepG = mergeGeometries(K.map((q) => q.toNonIndexed())).rotateY(ang).translate(b.cx - l.x, 0, b.cz - l.z);
      const darkG = mergeGeometries([...D.map((q) => q.toNonIndexed()), mergeGeometries(KD.map((q) => q.toNonIndexed())).rotateY(ang).translate(b.cx - l.x, 0, b.cz - l.z)]);
      const md = new THREE.Mesh(darkG, new THREE.MeshStandardMaterial({ color: 0x2a2520, roughness: 0.9 }));
      md.position.set(l.x, 0, l.z); add(md, 'qaitbay-openings');
      const m1 = new THREE.Mesh(worldUV(mergeGeometries(P.map((q) => q.toNonIndexed()).concat([keepG])), 6.4), stone);
      m1.position.set(l.x, 0, l.z); add(m1, 'qaitbay');
      W._addCollider({ cx: b.cx, cz: b.cz, hx: keep / 2 + 3, hz: keep / 2 + 3, angle: ang, restitution: 0.1, kind: 'building' }, null);
      zone(b.cx, b.cz, b.hw, b.hd, ang, l.footprint);
      out.push({ name, kind: 'citadel' });
      continue;
    }
    // ===== مكتبة الإسكندرية =====
    if (/^مكتبة الإسكندرية$/.test(name)) {
      let r = l.footprint ? 0 : 80; for (const [x, z] of l.footprint || []) r = Math.max(r, Math.hypot(x - l.x, z - l.z));
      r = Math.min(Math.max(r, 60), 80);
      bibliotheca(W, group, l.x, l.z, r, add);
      W._addCollider({ cx: l.x, cz: l.z, hx: r * 0.72, hz: r * 0.72, angle: 0, restitution: 0.1, kind: 'building' }, null);
      // الساحة والحوض حوالين المبنى فاضيين (زي الحقيقة): مفيش عمارات (حقيقية أو مولّدة) جوه دايرة r+40
      const R2 = r + 40, ring = Array.from({ length: 33 }, (_, i) => [l.x + Math.cos((i / 32) * Math.PI * 2) * R2, l.z + Math.sin((i / 32) * Math.PI * 2) * R2]);
      zone(l.x, l.z, R2, R2, 0, ring);
      out.push({ name, kind: 'library', model: 'detailed' });
    }
  }
  // جامع محمد علي (القلعة): الموديل الحقيقي لو موجود مكان المسجد العام اللي بالكود
  for (const p of W.features?.pois || []) {
    if (p.kind !== 'place_of_worship' || !/محمد علي/.test(p.name || '')) continue;
    if (real('mon_ali_mosque', { x: p.p[0], z: p.p[1] })) {
      W._addCollider({ cx: p.p[0], cz: p.p[1], hx: 30, hz: 40, angle: 0, restitution: 0.1, kind: 'building' }, null);
      zone(p.p[0], p.p[1], 45, 45, 0, null); out.push({ name: p.name, kind: 'mosque', model: 'real' });
      (W.realMosques ||= new Set()).add(p.osm);
    }
  }
  try { const s = stanleyBridge(W, group); if (s) out.push(s); } catch (e) { console.warn('[stanley]', e); }
  // ===== قصر المنتزه (الحرملك) — مش متسمي في OSM؛ مكانه من إحداثياته المنشورة (31.2886، 30.0158) بعد ضغط الخريطة =====
  if (W.id === 'alexandria' && W.meta?.origin) {
    try { const m = montazaPalace(W, group, 31.23942, 29.935202, add, zone); if (m) out.push(m); } catch (e) { console.warn('[montaza]', e); }
  }
  return out;
}

// =====================================================================
//  مكتبة الإسكندرية (سنوهيتا 2002) — الشكل المعروف للمبنى:
//  - أسطوانة قطرها ~160م سقفها قرص مايل ناحية البحر (الشمال): ~32م فوق الأرض من ناحية الجنوب، ونازل تحت الأرض من ناحية البحر
//  - السقف ألواح زجاج وألومنيوم في شبكة مايلة ("جفون" بتدخّل نور الشمال)
//  - الحيطة المدورة من الجنوب جرانيت أسوان رمادي محفور عليه حروف من كتابات العالم
//  - حوض مية حوالين ناحية البحر، و"القبة السماوية" (كورة غامقة) في الساحة اللي قدامها
// =====================================================================
function bibTextures() {
  // السقف: ألواح زجاج أزرق رمادي + إطارات ألومنيوم في شبكة مايلة + "جفون" أغمق
  const c = canvas(512, 512), x = c.getContext('2d');
  x.fillStyle = '#9ea5a9'; x.fillRect(0, 0, 512, 512);
  let s = 11; const R = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 16; i++) for (let j = 0; j < 16; j++) {
    const v = 0.85 + R() * 0.3; x.fillStyle = `rgb(${Math.round(138 * v)},${Math.round(150 * v)},${Math.round(158 * v)})`; x.fillRect(i * 32 + 2, j * 32 + 2, 28, 28);
    if (R() < 0.35) { x.fillStyle = '#3d4a52'; x.beginPath(); x.ellipse(i * 32 + 16, j * 32 + 18, 11, 5, 0, 0, Math.PI * 2); x.fill(); }
  }
  x.strokeStyle = '#e4e8ea'; x.lineWidth = 4;
  for (let k = 0; k <= 16; k++) { x.beginPath(); x.moveTo(k * 32, 0); x.lineTo(k * 32, 512); x.stroke(); x.beginPath(); x.moveTo(0, k * 32); x.lineTo(512, k * 32); x.stroke(); }
  const roof = tex(c); roof.repeat.set(10, 10); roof.rotation = Math.PI / 4;
  // الحيطة: جرانيت رمادي + حروف محفورة من كتابات مختلفة
  const w = canvas(1024, 256), y = w.getContext('2d');
  y.fillStyle = '#8a8884'; y.fillRect(0, 0, 1024, 256);
  for (let i = 0; i < 6000; i++) { const v = 110 + R() * 60; y.fillStyle = `rgba(${v},${v},${v - 4},0.35)`; y.fillRect(R() * 1024, R() * 256, 2, 2); }
  y.strokeStyle = 'rgba(60,60,58,0.35)'; y.lineWidth = 2;
  for (let k = 0; k < 1024; k += 128) { y.beginPath(); y.moveTo(k, 0); y.lineTo(k, 256); y.stroke(); }
  for (let k = 0; k < 256; k += 64) { y.beginPath(); y.moveTo(0, k); y.lineTo(1024, k); y.stroke(); }
  const glyphs = ['ع', 'ب', 'ك', 'A', 'Ω', 'Σ', '字', '文', 'ж', 'א', 'ॐ', 'ㄱ', 'ي', 'R', 'ψ', 'ת', 'क', '書', 'ه', 'Φ'];
  y.textAlign = 'center'; y.textBaseline = 'middle';
  for (let i = 0; i < 70; i++) {
    const g = glyphs[Math.floor(R() * glyphs.length)], sz = 22 + R() * 48;
    y.font = `${Math.round(sz)}px serif`; y.fillStyle = 'rgba(205,203,196,0.75)'; y.fillText(g, R() * 1024, 20 + R() * 216);
    y.fillStyle = 'rgba(55,55,52,0.5)'; y.fillText(g, R() * 1024 + 1.5, 20 + R() * 216 + 1.5);
  }
  const wall = tex(w); wall.repeat.set(6, 1);
  return { roof, wall };
}

function bibliotheca(W, group, cx, cz, r, add) {
  const T = bibTextures();
  const sea = { x: 0, z: -1 }; // البحر شمال المكتبة (الخريطة المضغوطة مابتلفّش الاتجاهات)
  const slope = Math.tan(THREE.MathUtils.degToRad(15.5)), hc = 10.5; // ارتفاع السقف في النص؛ +32م جنوب، تحت الأرض شمال
  const hAt = (x, z) => hc - ((x * sea.x + z * sea.z)) * slope; // x,z نسبة للمركز
  // 1) الحيطة: شريط حوالين الدايرة، ارتفاعه لحد السقف المايل (أقل حاجة 0.6م عند البحر = حرف الحوض)
  const N = 96, wp = [], wu = [], wi = [];
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2, x = Math.cos(a) * r, z = Math.sin(a) * r, h = Math.max(0.6, hAt(x, z));
    wp.push(x, -0.5, z, x, h, z); wu.push((i / N) * 6, 0, (i / N) * 6, Math.min(1, h / 32));
    if (i < N) { const k = i * 2; wi.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3)); wg.setAttribute('uv', new THREE.Float32BufferAttribute(wu, 2)); wg.setIndex(wi); wg.computeVertexNormals();
  const wall = new THREE.Mesh(wg, new THREE.MeshStandardMaterial({ map: T.wall, roughness: 0.85, side: THREE.DoubleSide }));
  wall.position.set(cx, 0, cz); add(wall, 'bibliotheca-wall');
  // 2) السقف: قرص في المستوى المايل (الجزء اللي تحت الأرض بيتقص على مستوى الحوض)
  const rg = new THREE.CircleGeometry(r, 64).rotateX(-Math.PI / 2);
  const P = rg.attributes.position;
  for (let i = 0; i < P.count; i++) P.setY(i, Math.max(0.55, hAt(P.getX(i), P.getZ(i))));
  rg.computeVertexNormals();
  const roof = new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ map: T.roof, roughness: 0.35, metalness: 0.35, envMapIntensity: 0.9 }));
  roof.position.set(cx, 0.02, cz); add(roof, 'bibliotheca-roof');
  // 3) حوض المية ناحية البحر (نص حلقة حوالين المبنى)
  const pool = new THREE.RingGeometry(r + 0.5, r + 14, 64, 1, Math.PI * 0.05, Math.PI * 0.9).rotateX(-Math.PI / 2);
  const pm = new THREE.Mesh(pool, new THREE.MeshStandardMaterial({ color: 0x3f6f86, roughness: 0.08, metalness: 0.2, polygonOffset: true, polygonOffsetFactor: -2 }));
  pm.position.set(cx, 0.06, cz); pm.rotation.y = Math.PI; add(pm, 'bibliotheca-pool'); pm.castShadow = false;
  // 4) القبة السماوية: كورة غامقة على قاعدة، في الساحة الجنوبية الغربية
  const px = cx - r * 0.55, pz = cz + r * 1.05;
  const sph = new THREE.Mesh(new THREE.SphereGeometry(9, 32, 20), new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.4, metalness: 0.5 }));
  sph.position.set(px, 9.5, pz); add(sph, 'bibliotheca-planetarium');
  const ring = new THREE.Mesh(new THREE.TorusGeometry(9.6, 0.35, 8, 48).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.4, metalness: 0.6 }));
  ring.position.set(px, 9.5, pz); add(ring, 'bibliotheca-planetarium-ring');
  const base = new THREE.Mesh(new THREE.CylinderGeometry(5, 6, 1.2, 24), new THREE.MeshStandardMaterial({ color: 0xbdb7ac, roughness: 0.9 }));
  base.position.set(px, 0.6, pz); add(base, 'bibliotheca-planetarium-base');
  W._addCollider({ cx: px, cz: pz, hx: 6, hz: 6, angle: 0, restitution: 0.1, kind: 'building' }, null);
}

// =====================================================================
//  كوبري ستانلي (إسكندرية) — مكانه واتجاهه وعرضه من OSM (الاتجاهين "كوبري ستانلي"، 296م فوق بُق خليج ستانلي).
//  الشكل من صور Wikimedia Commons (CC BY-SA 4.0: "Stanley Bridge, Alexandria, Jan. 2019-1/2"، "Aug. 2020"، "May 2023"):
//  - 4 أبراج (اتنين على كل جنب، على طرفي البحر اللي في النص): جسم مربع كريمي بحشوات طوب أحمر وشبابيك مقوّسة،
//    وفوق "كشك" مفتوح بأعمدة وسقف هرمي أحمر بارز
//  - بلاسترادا (درابزين) بيضا، وأعمدة نور كتير على الجنبين، وعلى كل رجل كوبري عمود أبيض بفانوس
//  - رجول عريضة بيضا على وش المية تحت الكوبري
// =====================================================================
function stanleyBridge(W, group) {
  const E = (W.graph?.edges || []).filter((e) => /كوبر[يى] ستانل[يى]/.test(e.name || '') && e.length > 100);
  if (!E.length) return null;
  // محور الكوبري: من أول نقطة لآخر نقطة (متوسط الاتجاهين)
  const P0 = { x: 0, z: 0 }, P1 = { x: 0, z: 0 };
  let dir = null;
  for (const e of E) {
    const a = e.pts[0], b = e.pts[e.pts.length - 1];
    let [s, f] = [a, b];
    if (dir && (b.x - a.x) * dir[0] + (b.z - a.z) * dir[1] < 0) [s, f] = [b, a];
    if (!dir) { const l = Math.hypot(b.x - a.x, b.z - a.z); dir = [(b.x - a.x) / l, (b.z - a.z) / l]; }
    P0.x += s.x / E.length; P0.z += s.z / E.length; P1.x += f.x / E.length; P1.z += f.z / E.length;
  }
  const L = Math.hypot(P1.x - P0.x, P1.z - P0.z), ux = (P1.x - P0.x) / L, uz = (P1.z - P0.z) / L, nx = -uz, nz = ux;
  // العرض: بين الاتجاهين + نص عرض كل واحد + رصيف 2.5م
  let off = 0; for (const e of E) { const m = e.pts[Math.floor(e.pts.length / 2)]; off = Math.max(off, Math.abs((m.x - P0.x) * nx + (m.z - P0.z) * nz) + e.half); }
  const HW = off + 2.6, cx = (P0.x + P1.x) / 2, cz = (P0.z + P1.z) / 2, ang = Math.atan2(ux, uz);
  // ارتفاع سطح الكوبري: من نقط طريق الكوبري نفسه (الشبكة فيها الارتفاعات) — W.height وقت بناء المعالم
  // بيرجّع 0 لأن مربعات الأرض لسه ماتحمّلتش (كان بيطلع كل حاجة على مستوى المية ومفيش بواكي)
  const DP = []; for (const e of E) for (const q of e.pts) DP.push([(q.x - P0.x) * ux + (q.z - P0.z) * uz, q.y || 0]);
  DP.sort((a, b) => a[0] - b[0]);
  const deckY = (s) => {
    if (!DP.length) return W.height(P0.x + ux * s, P0.z + uz * s, 0);
    let best = DP[0], bd = Infinity; for (const d of DP) { const k = Math.abs(d[0] - s); if (k < bd) { bd = k; best = d; } }
    return best[1];
  };
  const at = (s, o, y = 0) => new THREE.Vector3(P0.x + ux * s + nx * o, y, P0.z + uz * s + nz * o);
  const cream = new THREE.MeshStandardMaterial({ color: 0xe9dcc2, roughness: 0.8 });
  const brick = new THREE.MeshStandardMaterial({ color: 0xa8553a, roughness: 0.85 });
  const roof = new THREE.MeshStandardMaterial({ color: 0xb54a32, roughness: 0.7 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf1efe8, roughness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2c2f, roughness: 0.6, metalness: 0.4 });
  const B = { cream: [], brick: [], roof: [], white: [], dark: [] };
  const box = (k, w, h, d, p, rotY = ang) => B[k].push(new THREE.BoxGeometry(w, h, d).rotateY(rotY).translate(p.x, p.y, p.z));
  const cyl = (k, r0, r1, h, p, seg = 8) => B[k].push(new THREE.CylinderGeometry(r0, r1, h, seg).translate(p.x, p.y, p.z));
  // ===== الأبراج: اتنين على كل جنب، على طرفي البحر اللي في النص (±20م من نص الكوبري) =====
  const TS = 4.6, TH = 15;
  for (const s of [L / 2 - 20, L / 2 + 20]) for (const sd of [-1, 1]) {
    const o = sd * (HW + TS / 2 - 0.6), y0 = deckY(s), c = at(s, o);
    box('cream', TS, TH, TS, c.clone().setY(y0 + TH / 2));
    // حشوات الطوب (على الأربع وشوش) + شباك مقوّس غامق في كل حشوة
    for (const [fo, fu] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const q = c.clone().add(new THREE.Vector3(nx * fo * (TS / 2 + 0.02) + ux * fu * (TS / 2 + 0.02), 0, nz * fo * (TS / 2 + 0.02) + uz * fu * (TS / 2 + 0.02)));
      const rot = fo ? ang : ang + Math.PI / 2;
      box('brick', 2.6, TH - 4.5, 0.06, q.clone().setY(y0 + 2.2 + (TH - 4.5) / 2), rot);
      box('dark', 0.9, 2.2, 0.08, q.clone().setY(y0 + TH - 4.2), rot);
      box('dark', 0.7, 1.6, 0.08, q.clone().setY(y0 + 4.5), rot);
    }
    // الكشك اللي فوق: أرضية بارزة + 4 أعمدة في الأركان + سقف هرمي أحمر بارز + شوشة
    box('white', TS + 1.0, 0.5, TS + 1.0, c.clone().setY(y0 + TH + 0.25));
    for (const a of [-1, 1]) for (const b of [-1, 1]) {
      const q = c.clone().add(new THREE.Vector3((nx * a + ux * b) * (TS / 2 - 0.2), 0, (nz * a + uz * b) * (TS / 2 - 0.2)));
      box('cream', 0.55, 3.2, 0.55, q.setY(y0 + TH + 0.5 + 1.6));
    }
    box('white', TS + 0.4, 0.4, TS + 0.4, c.clone().setY(y0 + TH + 3.9));
    B.roof.push(new THREE.ConeGeometry((TS + 2.2) * 0.71, 2.4, 4, 1).rotateY(Math.PI / 4 + ang).translate(c.x, y0 + TH + 5.3, c.z));
    cyl('white', 0.08, 0.14, 1.4, c.clone().setY(y0 + TH + 7.0));
  }
  // ===== الرجول + عمود الفانوس الأبيض على كل رجل (كل ~42م) =====
  const nSp = Math.max(3, Math.round(L / 42));
  for (let i = 1; i < nSp; i++) {
    const s = (L * i) / nSp, y0 = deckY(s);
    for (const sd of [-1, 1]) {
      const c = at(s, sd * (HW - 0.1));
      box('white', 1.3, 3.0, 1.3, c.clone().setY(y0 + 1.5));
      box('white', 1.7, 0.3, 1.7, c.clone().setY(y0 + 3.1));
      box('dark', 0.5, 0.7, 0.5, c.clone().setY(y0 + 3.6));
    }
    // الرجل نفسها على وش المية (أعرض من الكوبري)
    box('white', 5, 1.6, HW * 2 + 3, at(s, 0, y0 - 1.3));
  }
  // ===== البواكي اللي تحت الكوبري (فوق المية): رجول كريمي كل ~14م وبينها عقود موطّية على الوشين =====
  // (بتتعمل بس في الحتة اللي الكوبري فيها عالي كفاية فوق المية — الكوبري بقى ~5م فوق خليج ستانلي)
  const WY = -0.6, DECK_T = 0.9, SP = 14;
  for (let s0 = 0; s0 + SP <= L; s0 += SP) {
    const s1 = s0 + SP, sm = (s0 + s1) / 2, clr = deckY(sm) - DECK_T - WY;
    if (clr < 2.2) continue;
    for (const sp of [s0, s1]) { const h = deckY(sp) - DECK_T - WY; if (h > 2.2) box('cream', 1.6, h, HW * 2 + 0.6, at(sp, 0, WY + h / 2)); }
    const r = SP / 2 - 0.8, k = Math.min(1, (clr - 0.35) / r);
    for (const sd of [-1, 1]) {
      const c = at(sm, sd * (HW + 0.18), WY);
      B.cream.push(new THREE.TorusGeometry(r, 0.42, 6, 18, Math.PI).scale(1, k, 1).rotateY(ang - Math.PI / 2).translate(c.x, c.y, c.z));
      // الحيطة اللي فوق العقد لحد الكوبري (كوشة)
      B.cream.push(new THREE.BoxGeometry(0.5, Math.max(0.2, clr - r * k), SP).rotateY(ang).translate(...at(sm, sd * (HW + 0.18), WY + r * k + (clr - r * k) / 2).toArray()));
    }
  }
  // ===== الدرابزين الأبيض (عمدان + كوبستة) + أعمدة النور المزدوجة كل 14م =====
  for (const sd of [-1, 1]) {
    const o = sd * (HW - 0.1);
    for (let s = 0; s <= L; s += 2.4) box('white', 0.22, 0.9, 0.22, at(s, o, deckY(s) + 0.45));
    for (let s = 0; s < L; s += 12) {
      const s1 = Math.min(L, s + 12), y = (deckY(s) + deckY(s1)) / 2;
      B.white.push(new THREE.BoxGeometry(0.35, 0.16, s1 - s).rotateY(ang).translate(...at((s + s1) / 2, o, y + 0.98).toArray()));
      B.white.push(new THREE.BoxGeometry(0.3, 0.12, s1 - s).rotateY(ang).translate(...at((s + s1) / 2, o, y + 0.12).toArray()));
    }
    for (let s = 7; s < L; s += 14) {
      const c = at(s, sd * (HW - 0.5)), y0 = deckY(s);
      cyl('dark', 0.07, 0.11, 6.5, c.clone().setY(y0 + 3.25));
      box('dark', 1.2, 0.06, 0.06, c.clone().setY(y0 + 6.3), ang + Math.PI / 2);
      for (const k of [-0.55, 0.55]) B.white.push(new THREE.SphereGeometry(0.2, 8, 6).translate(c.x + ux * k, y0 + 6.1, c.z + uz * k));
    }
    // واجهة الكوبري من برا (الكمرة اللي تحت الدرابزين) نازلة للمية
    B.cream.push(new THREE.BoxGeometry(0.4, 1.3, L).rotateY(ang).translate(...at(L / 2, sd * (HW + 0.15), deckY(L / 2) - 0.55).toArray()));
  }
  const g = new THREE.Group(); g.name = 'stanley-bridge';
  const M = { cream, brick, roof, white, dark };
  for (const [k, list] of Object.entries(B)) {
    if (!list.length) continue;
    const m = new THREE.Mesh(mergeGeometries(list.map((q) => (q.index ? q.toNonIndexed() : q))), M[k]);
    m.castShadow = k !== 'dark'; m.receiveShadow = true; g.add(m);
  }
  group.add(g);
  // الأبراج حواجز (العربية ماتعدّيش جواها)
  for (const s of [L / 2 - 20, L / 2 + 20]) for (const sd of [-1, 1]) {
    const c = at(s, sd * (HW + TS / 2 - 0.6));
    W._addCollider?.({ cx: c.x, cz: c.z, hx: TS / 2, hz: TS / 2, angle: ang, restitution: 0.1, kind: 'building' }, null);
  }
  return { name: 'كوبري ستانلي', kind: 'bridge', length: Math.round(L), towers: 4, cx: Math.round(cx), cz: Math.round(cz) };
}

/** خامة جسم برج القاهرة: شبكة خرسانة (فتحات معينات زي زهرة اللوتس) */
let _lat = null;
function latticeTex() {
  if (_lat) return _lat;
  const c = canvas(256, 256), x = c.getContext('2d');
  x.fillStyle = '#d8d0c2'; x.fillRect(0, 0, 256, 256);
  x.fillStyle = '#4a4740';
  for (let i = 0; i < 4; i++) for (let j = 0; j < 8; j++) {
    const cx = i * 64 + (j % 2) * 32 + 16, cy = j * 32 + 16;
    x.beginPath(); x.moveTo(cx, cy - 13); x.lineTo(cx + 9, cy); x.lineTo(cx, cy + 13); x.lineTo(cx - 9, cy); x.closePath(); x.fill();
  }
  _lat = tex(c); _lat.repeat.set(6, 22);
  return _lat;
}

// =====================================================================
//  قصر المنتزه — "الحرملك" (1932، الملك فؤاد): الشكل المعروف من وصف المبنى:
//  - كتلة طويلة (~75م) 3 أدوار بحجر لونه أوكر/مشمشي، صفوف شبابيك وبواكي بعقود نص دايرية، ودرابزين فوق السطح
//  - برج مربع عالي (~42م) على الطراز الفلورنسي (زي باليتسو فيكيو): حزام بارز فوق (ماشيكوليشن) وشرفات مسننة وفانوس صغير فوقه
//  - الواجهة الطويلة ناحية البحر، والقصر وسط جنينة المنتزه (الساحة حواليه فاضية)
//  (مش متسمي في OSM — المكان من الإحداثيات المنشورة بعد نفس تحويل الخريطة المضغوطة؛ الأبعاد تقريبية)
// =====================================================================
function palaceFacade() {
  const c = canvas(256, 256), x = c.getContext('2d');
  x.fillStyle = '#d6a46c'; x.fillRect(0, 0, 256, 256);
  x.fillStyle = 'rgba(120,70,40,0.18)'; for (let i = 0; i < 256; i += 16) x.fillRect(0, i, 256, 1); // خطوط الحجر
  x.fillStyle = '#c38f5c'; x.fillRect(0, 0, 256, 18); x.fillRect(0, 238, 256, 18); // كورنيش
  // شباكين بعقد نص دايري لكل خانة
  for (const cx of [64, 192]) {
    x.fillStyle = '#efd9b4'; x.beginPath(); x.moveTo(cx - 30, 205); x.lineTo(cx - 30, 95); x.arc(cx, 95, 30, Math.PI, 0); x.lineTo(cx + 30, 205); x.closePath(); x.fill();
    x.fillStyle = '#3b2f2a'; x.beginPath(); x.moveTo(cx - 22, 200); x.lineTo(cx - 22, 98); x.arc(cx, 98, 22, Math.PI, 0); x.lineTo(cx + 22, 200); x.closePath(); x.fill();
    x.fillStyle = '#efd9b4'; x.fillRect(cx - 2, 76, 4, 124); x.fillRect(cx - 22, 140, 44, 4);
  }
  return c;
}
function montazaPalace(W, group, lat, lon, add, zone) {
  const O = W.meta.origin;
  const cx = (lon - O.lon) * 111320 * Math.cos(O.lat * Math.PI / 180), cz = -(lat - O.lat) * 110574;
  // ناحية البحر: أقرب اتجاه فيه مية (الواجهة الطويلة بتبص عليه)
  let best = null;
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2, dx = Math.sin(a), dz = Math.cos(a);
    for (let r = 40; r <= 260; r += 20) if (W.height(cx + dx * r, cz + dz * r, 0) < -0.3) { if (!best || r < best.r) best = { r, a }; break; }
  }
  if (W.height(cx, cz, 0) < -0.3) return null; // (لو المكان طلع مية: مفيش)
  // (الخريطة الصغيرة: القصر ممكن يبقى برّه حدودها — لازم يكون فيه شارع قريب)
  const near = W.nearestRoad(cx, cz, 200); if (!near || near.d > 160) return null;
  // (المربعات غالبًا لسه ماتحمّلتش وقت بناء المعالم → مفيش مية في الفحص: البحر في إسكندرية ناحية الشمال = -z)
  const ang = best ? best.a : Math.PI; // المحلي +z = ناحية البحر
  const g = new THREE.Group(); g.position.set(cx, 0, cz); g.rotation.y = ang;
  const base = palaceFacade();
  const mat = (rx, ry) => { const t = tex(base, { repeat: true }); t.repeat.set(rx, ry); return new THREE.MeshStandardMaterial({ map: t, roughness: 0.85 }); };
  const trim = new THREE.MeshStandardMaterial({ color: 0xc38f5c, roughness: 0.8 });
  const roofM = new THREE.MeshStandardMaterial({ color: 0x9a4e2e, roughness: 0.75 });
  const box = (w, h, d, m, x, y, z) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; g.add(o); return o; };
  // الكتلة الرئيسية (3 أدوار ~16م) + جناحين أوطى شوية
  const L = 74, D = 24, H = 16;
  box(L, H, D, [mat(1, 3), mat(1, 3), trim, trim, mat(L / 8, 3), mat(L / 8, 3)], 0, H / 2, 0);
  for (const sx of [-1, 1]) box(14, H + 3, D + 6, [mat(D / 8, 3.5), mat(D / 8, 3.5), trim, trim, mat(14 / 8, 3.5), mat(14 / 8, 3.5)], sx * (L / 2 - 4), (H + 3) / 2, 0);
  // درابزين السطح + كورنيش
  box(L + 1, 0.5, D + 1, trim, 0, H + 0.25, 0);
  for (let i = -L / 2 + 1; i <= L / 2 - 1; i += 1.6) for (const sz of [-1, 1]) box(0.35, 1.0, 0.35, trim, i, H + 1.0, sz * (D / 2));
  // سقف قرميد خفيف فوق الجناحين
  for (const sx of [-1, 1]) { const r = new THREE.Mesh(new THREE.ConeGeometry(11, 4, 4), roofM); r.position.set(sx * (L / 2 - 4), H + 3 + 2, 0); r.rotation.y = Math.PI / 4; r.scale.set(1, 1, 1.45); r.castShadow = true; g.add(r); }
  // البواكي على الواجهة البحرية (دور أرضي): عقود على أعمدة
  for (let i = -L / 2 + 10; i <= L / 2 - 10; i += 4.2) box(0.8, 5, 0.8, trim, i, 2.5, D / 2 + 2.2);
  box(L - 18, 1.0, 4.6, trim, 0, 5.5, D / 2 + 2.2);
  // البرج الفلورنسي (~42م) على طرف الكتلة
  const T = 9, TH = 36, tx = -L / 2 + 14, tz = -2;
  box(T, TH, T, mat(1.1, 7), tx, TH / 2, tz);
  box(T + 1.6, 3, T + 1.6, trim, tx, TH + 1.5, tz);                // الحزام البارز
  for (let i = 0; i < 5; i++) for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { // الشرفات المسننة
    const o = -T / 2 - 0.8 + i * ((T + 1.6) / 4);
    box(a ? 0.6 : 1.1, 1.4, a ? 1.1 : 0.6, trim, tx + (a ? a * (T / 2 + 0.5) : o), TH + 3.7, tz + (b ? b * (T / 2 + 0.5) : o));
  }
  box(4.5, 5, 4.5, mat(0.6, 1.2), tx, TH + 5.5, tz);                // الفانوس
  const cap = new THREE.Mesh(new THREE.ConeGeometry(3.6, 3.2, 4), roofM); cap.position.set(tx, TH + 9.6, tz); cap.rotation.y = Math.PI / 4; cap.castShadow = true; g.add(cap);
  group.add(g);
  g.updateMatrixWorld(true);
  g.traverse((o) => { if (o.isMesh) o.name = 'montaza-palace'; });
  // تصادم + الساحة حواليه فاضية (مفيش عمارات مولّدة/حقيقية جوه الجنينة القريبة)
  W._addCollider({ cx, cz, hx: L / 2 + 1, hz: D / 2 + 4, angle: -ang, restitution: 0.1, kind: 'building' }, null);
  const R2 = 70, ring = Array.from({ length: 25 }, (_, i) => [cx + Math.cos((i / 24) * Math.PI * 2) * R2, cz + Math.sin((i / 24) * Math.PI * 2) * R2]);
  zone(cx, cz, R2, R2, 0, ring);
  void add;
  return { name: 'قصر المنتزه (الحرملك)', kind: 'palace', model: 'detailed' };
}
