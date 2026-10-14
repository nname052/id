import * as THREE from 'three';
import { Buckets, GeoBuilder } from '../render/GeoBuilder.js';
import { rng, canvas, tex, tileNoise } from '../render/textures.js';
import { ROUTE, sampleAt, terrainHeight, nearestRoute, RIVER, CANAL_OFFSET, ROUTE_BUMPS, UTURNS, inUturn, fbm } from './Route.js';
import { buildOne } from './Buildings.js';
import { LAMP_POSITIONS } from './Props.js';

// =====================================================================
//  بناء شكل الطريق الدائري: أسفلت + خطوط + أرصفة + جزيرة/حاجز خرساني + جاردريل
//  + كوبري ونيل + ترعة وأرض زراعية ونخل + قرية وجامع + صحرا + جبل ونفق + يافطات اتجاهات
//  كل حاجة متقسمة Chunks (كل 120م) عشان الـ frustum/distance culling يشتغل كويس على الموبايل.
// =====================================================================

const CHUNK = 120;
const HALF = 10;           // نص عرض الأسفلت
const Y = (s) => sampleAt(s).y;

function P(s, d, yo = 0) { const q = sampleAt(s); return [q.x + q.rx * d, q.y + yo, q.z + q.rz * d]; }
function zoneAt(s) { return sampleAt(s).zone; }
const URBAN = new Set(['residential', 'roundabout']);

export class RouteWorld {
  constructor(M, opts = {}) {
    this.M = M;
    this.low = !!opts.low;
    this.group = new THREE.Group();
    this.group.name = 'route-world';
    this.chunks = [];          // { group, cx, cz, r }
    this.colliders = [];       // OBB للفيزياء
    this._materials();
    this._buildRoad();
    this._buildTerrain();
    this._buildWater();
    this._buildRoundabout();
    this._buildRoadside();
    this._buildTunnel();
    this._buildSigns();
    this._buildColliders();
  }

  // ===================== خامات إضافية =====================
  _materials() {
    const M = this.M;
    const R = rng(808);
    // تفاصيل التضاريس (نويز رمادي يتضرب في لون الـ vertex)
    const n = tileNoise(256, [8, 32, 64], R);
    const c = canvas(256, 256), ctx = c.getContext('2d'), img = ctx.createImageData(256, 256);
    for (let i = 0; i < n.length; i++) { const v = 150 + (n[i] - 0.5) * 120 + (R() - 0.5) * 40; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
    ctx.putImageData(img, 0, 0);
    const detail = tex(c);
    M.terrain = new THREE.MeshStandardMaterial({ map: detail, vertexColors: true, roughness: 0.97 });
    M.terrain.userData.castShadow = false;
    M.water = new THREE.MeshStandardMaterial({ color: 0x2f5560, roughness: 0.06, metalness: 0.2, normalMap: (() => { const t = M.asphalt.normalMap.clone(); t.needsUpdate = true; t.repeat.set(1, 1); return t; })(), normalScale: new THREE.Vector2(0.35, 0.35), envMapIntensity: 1.4 });
    M.water.userData.castShadow = false;
    M.jersey = new THREE.MeshStandardMaterial({ color: 0xd2cdc2, roughness: 0.9, map: M.concrete.map, vertexColors: true });
    M.rail = new THREE.MeshStandardMaterial({ color: 0xb9bec2, roughness: 0.35, metalness: 0.75, vertexColors: true, side: THREE.DoubleSide });
    M.rock = M.terrain;
    M.tunnel = new THREE.MeshStandardMaterial({ color: 0xbab3a6, roughness: 0.9, map: M.concrete.map, vertexColors: true, side: THREE.DoubleSide });
    M.tunnelLamp = new THREE.MeshStandardMaterial({ color: 0xfff1c8, emissive: 0xffd590, emissiveIntensity: 3, roughness: 0.3 });
    M.sign = new THREE.MeshStandardMaterial({ roughness: 0.5, side: THREE.DoubleSide });
    M.grass = M.dirt;
    M.paintedMetalR = M.paintedMetal;
    M.mosque = new THREE.MeshStandardMaterial({ map: M.wallPlaster.map, normalMap: M.wallPlaster.normalMap, vertexColors: true, roughness: 0.9 });
  }

  _chunk(s) {
    const idx = Math.floor(s / CHUNK);
    if (!this._chunkB) this._chunkB = new Map();
    let c = this._chunkB.get(idx);
    if (!c) { c = new Buckets(); this._chunkB.set(idx, c); }
    return c;
  }

  _flushChunks() {
    for (const [idx, B] of this._chunkB) {
      const g = new THREE.Group();
      B.toMeshes({ ...this.M, winGlass: this.M.glass }, g);
      g.traverse((o) => { if (o.isMesh && ['asphalt', 'paint', 'paintYellow', 'stain', 'water', 'terrain', 'winGlass', 'clinic', 'lampGlass', 'tunnelLamp', 'curtain'].includes(o.name)) o.castShadow = false; });
      const q = sampleAt(Math.min(ROUTE.length, idx * CHUNK + CHUNK / 2));
      this._addChunk(g, q.x, q.z, CHUNK * 0.8 + 60);
    }
    this._chunkB = new Map();
  }

  _addChunk(g, cx, cz, r) {
    this.group.add(g);
    this.chunks.push({ group: g, cx, cz, r });
  }

  // ===================== الطريق =====================
  _buildRoad() {
    const L = ROUTE.length;
    const R = rng(77);
    const ds = 2;
    for (let s = 0; s < L - 0.01; s += ds) {
      const s1 = Math.min(L, s + ds);
      const B = this._chunk(s);
      const zone = zoneAt(s);
      const urban = URBAN.has(zone);
      const bridgeHigh = zone === 'bridge' && Y(s) > 1.2;
      // الأسفلت (لون الشولدر مختلف في الطرق السريعة)
      const a = B.get('asphalt');
      const band = (d0, d1, col) => {
        a.setColor(col);
        const A = P(s, d0, 0.002), Bp = P(s, d1, 0.002), C = P(s1, d1, 0.002), D = P(s1, d0, 0.002);
        a.quad(A, Bp, C, D, [[d0 / 7, s / 7], [d1 / 7, s / 7], [d1 / 7, s1 / 7], [d0 / 7, s1 / 7]]);
      };
      const t = 0.94 + R() * 0.06;
      const sh = urban ? [t, t, t] : zone === 'village' ? [t * 1.05, t * 1.03, t] : [t * 0.86, t * 0.86, t * 0.86];
      band(-HALF, -7.7, sh); band(-7.7, 7.7, [t, t, t]); band(7.7, HALF, sh);
      // خطوط الطريق
      const paint = B.get('paint');
      const strip = (d, w, on = true) => {
        if (!on) return;
        const A = P(s, d - w, 0.008), Bp = P(s, d + w, 0.008), C = P(s1, d + w, 0.008), D = P(s1, d - w, 0.008);
        paint.quad(A, Bp, C, D, [[0, s * 0.05], [0.3, s * 0.05], [0.3, s1 * 0.05], [0, s1 * 0.05]]);
      };
      const dash = (s % 9) < 3;
      for (const sx of [-1, 1]) {
        strip(sx * 4.2, 0.06, dash);
        strip(sx * 7.7, 0.06, urban ? (s % 4) < 1.2 : true);
        if (!urban) strip(sx * 1.25, 0.05, true);
      }
      // أرصفة مرفوعة في المناطق السكنية
      if (urban) {
        const top = B.get('sidewalkTop'), curb = B.get('curb');
        for (const sx of [-1, 1]) {
          const d0 = sx > 0 ? HALF : -15, d1 = sx > 0 ? 15 : -HALF;
          top.setColor([0.95 + R() * 0.08, 0.95, 0.95]);
          const A = P(s, d0, 0.18), Bp = P(s, d1, 0.18), C = P(s1, d1, 0.18), D = P(s1, d0, 0.18);
          top.quad(A, Bp, C, D, [[d0 / 2, s / 2], [d1 / 2, s / 2], [d1 / 2, s1 / 2], [d0 / 2, s1 / 2]]);
          const dc = sx * HALF;
          if (sx > 0) curb.quad(P(s1, dc, 0), P(s, dc, 0), P(s, dc, 0.18), P(s1, dc, 0.18), [[s1, 0], [s, 0], [s, 1], [s1, 1]]);
          else curb.quad(P(s, dc, 0), P(s1, dc, 0), P(s1, dc, 0.18), P(s, dc, 0.18), [[s, 0], [s1, 0], [s1, 1], [s, 1]]);
        }
        // جزيرة وسطى بزرع + حرف أصفر
        if (!inUturn(s)) {
          const dirt = B.get('dirt');
          dirt.quad(P(s, -0.7, 0.24), P(s, 0.7, 0.24), P(s1, 0.7, 0.24), P(s1, -0.7, 0.24), [[0, s / 2], [1, s / 2], [1, s1 / 2], [0, s1 / 2]]);
          const cy = B.get('curbYellow');
          cy.quad(P(s, 0.7, 0), P(s1, 0.7, 0), P(s1, 0.7, 0.24), P(s, 0.7, 0.24), [[s, 0], [s1, 0], [s1, 1], [s, 1]]);
          cy.quad(P(s1, -0.7, 0), P(s, -0.7, 0), P(s, -0.7, 0.24), P(s1, -0.7, 0.24), [[s1, 0], [s, 0], [s, 1], [s1, 1]]);
        }
      } else if (!inUturn(s) && zone !== 'tunnel') {
        // حاجز خرساني (New Jersey) في النص
        const j = B.get('jersey');
        j.setColor([0.95 + R() * 0.05, 0.95, 0.93]);
        const prof = [[-0.35, 0], [-0.3, 0.25], [-0.12, 0.42], [-0.1, 0.85], [0.1, 0.85], [0.12, 0.42], [0.3, 0.25], [0.35, 0]];
        for (let k = 0; k < prof.length - 1; k++) {
          const [d0, h0] = prof[k], [d1, h1] = prof[k + 1];
          j.quad(P(s, d0, h0), P(s, d1, h1), P(s1, d1, h1), P(s1, d0, h0), [[0, s / 3], [0.4, s / 3], [0.4, s1 / 3], [0, s1 / 3]]);
        }
        // خطوط سودا بين بلوكات الحاجز
        if (Math.floor(s / 4) !== Math.floor(s1 / 4)) j.setColor([0.4, 0.4, 0.4]);
      }
      // جوانب الكوبري: سور خرساني + درابزين، وجسم الكوبري من تحت
      if (bridgeHigh) {
        const j = B.get('jersey');
        j.setColor([0.9, 0.88, 0.84]);
        for (const sx of [-1, 1]) {
          const d = sx * (HALF + 0.25);
          j.quad(P(s, d - 0.25, 0.95), P(s, d + 0.25, 0.95), P(s1, d + 0.25, 0.95), P(s1, d - 0.25, 0.95));
          if (sx > 0 && Math.floor(s / 30) !== Math.floor(s1 / 30)) this._pier(B, s);
          if (sx > 0) { j.quad(P(s1, d - 0.25, 0), P(s, d - 0.25, 0), P(s, d - 0.25, 0.95), P(s1, d - 0.25, 0.95)); j.quad(P(s, d + 0.25, -1.4), P(s1, d + 0.25, -1.4), P(s1, d + 0.25, 0.95), P(s, d + 0.25, 0.95)); }
          else { j.quad(P(s, d + 0.25, 0), P(s1, d + 0.25, 0), P(s1, d + 0.25, 0.95), P(s, d + 0.25, 0.95)); j.quad(P(s1, d - 0.25, -1.4), P(s, d - 0.25, -1.4), P(s, d - 0.25, 0.95), P(s1, d - 0.25, 0.95)); }
          const rl = B.get('rail');
          rl.setColor([0.75, 0.78, 0.8]);
          rl.quad(P(s, d, 1.25), P(s1, d, 1.25), P(s1, d, 1.32), P(s, d, 1.32));
          if (Math.floor(s / 2.5) !== Math.floor(s1 / 2.5)) { const q = P(s, d, 0.95); rl.box(q[0] - 0.03, q[1], q[2] - 0.03, q[0] + 0.03, q[1] + 0.37, q[2] + 0.03); }
        }
        // البطن
        const u = B.get('jersey');
        u.setColor([0.7, 0.68, 0.64]);
        u.quad(P(s1, -HALF - 0.5, -1.4), P(s1, HALF + 0.5, -1.4), P(s, HALF + 0.5, -1.4), P(s, -HALF - 0.5, -1.4));
      }
    }
    // المطبات (نفس بروفايل الفيزياء)
    for (const b of ROUTE_BUMPS) {
      const B = this._chunk(b.s);
      const a = B.get('asphalt');
      a.setColor([1.08, 1.06, 1.02]);
      const n = 8;
      for (let i = 0; i < n; i++) {
        const d0 = -b.half + (2 * b.half * i) / n, d1 = -b.half + (2 * b.half * (i + 1)) / n;
        const h0 = b.height * 0.5 * (1 + Math.cos((Math.PI * d0) / b.half)) + 0.004, h1 = b.height * 0.5 * (1 + Math.cos((Math.PI * d1) / b.half)) + 0.004;
        a.quad(P(b.s + d0, -HALF, h0), P(b.s + d0, HALF, h0), P(b.s + d1, HALF, h1), P(b.s + d1, -HALF, h1));
      }
      const pt = B.get('paintYellow');
      for (let d = -HALF + 0.4; d < HALF - 0.6; d += 1.2) pt.quad(P(b.s - 0.12, d, b.height + 0.01), P(b.s - 0.12, d + 0.6, b.height + 0.01), P(b.s + 0.12, d + 0.6, b.height + 0.01), P(b.s + 0.12, d, b.height + 0.01));
    }
    // رقع وبقع على الأسفلت (طرق مش مثالية)
    for (let i = 0; i < 160; i++) {
      const s = R() * ROUTE.length;
      const B = this._chunk(s);
      const d = (R() - 0.5) * 16, w = 0.6 + R() * 1.8, l = 0.8 + R() * 3.5;
      if (R() < 0.5) {
        B.get('patch').quad(P(s, d, 0.004), P(s, d + w, 0.004), P(s + l, d + w, 0.004), P(s + l, d, 0.004), [[0, 0], [w / 7, 0], [w / 7, l / 7], [0, l / 7]]);
      } else {
        const st = B.get('stain');
        const k = 0.25 + R() * 0.4;
        st.setColor([k, k, k]);
        st.quad(P(s, d, 0.005), P(s, d + w, 0.005), P(s + w, d + w, 0.005), P(s + w, d, 0.005));
      }
    }
    this._flushChunks();
  }

  // ===================== التضاريس =====================
  _buildTerrain() {
    const S = ROUTE.samples;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of S) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
    const pad = 220, cell = this.low ? 8 : 6, tile = 120;
    minX -= pad; maxX += pad; minZ -= pad; maxZ += pad;
    const tunnel = ROUTE.zones.tunnel;
    const colorFor = (x, z, h, r) => {
      const n = fbm(x * 0.05, z * 0.05);
      const zone = r ? r.zone : 'agri';
      const d = r ? r.dist : 999;
      if (h < -1.2) return [0.42, 0.38, 0.3]; // طين الضفاف
      if (d < 10.8) return [0.42, 0.40, 0.37];
      if (zone === 'desert') return [0.86 + n * 0.08, 0.72 + n * 0.08, 0.5 + n * 0.06];
      if (zone === 'mountain' || zone === 'tunnel') { const k = 0.55 + n * 0.25; return [k * 0.95, k * 0.82, k * 0.66]; }
      if (zone === 'agri' || zone === 'village' || zone === 'bridge') {
        if (d < 14) return [0.55, 0.47, 0.35]; // تراب الشولدر
        // حقول: قطع مربعة بدرجات أخضر مختلفة
        const px = Math.floor(x / 22), pz = Math.floor(z / 30);
        const hsh = ((px * 73856093) ^ (pz * 19349663)) >>> 0;
        const k = (hsh % 1000) / 1000;
        if (k < 0.12) return [0.55, 0.45, 0.3]; // أرض محروثة
        if (k < 0.2) return [0.75, 0.68, 0.35]; // قمح
        return [0.22 + k * 0.12 + n * 0.08, 0.42 + k * 0.15 + n * 0.1, 0.14 + n * 0.06];
      }
      if (zone === 'highway') return [0.72 + n * 0.1, 0.62 + n * 0.08, 0.45];
      return [0.5 + n * 0.1, 0.47 + n * 0.08, 0.4];
    };
    for (let tx = minX; tx < maxX; tx += tile) {
      for (let tz = minZ; tz < maxZ; tz += tile) {
        // تخطّي البلاطات البعيدة جدًا عن الطريق
        const cxm = tx + tile / 2, czm = tz + tile / 2;
        let near = false;
        for (let i = 0; i < S.length; i += 8) if (Math.abs(S[i].x - cxm) < tile / 2 + 260 && Math.abs(S[i].z - czm) < tile / 2 + 260) { near = true; break; }
        if (!near) continue;
        const n = Math.round(tile / cell);
        const pos = [], col = [], uv = [], skip = [];
        for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
          const x = tx + i * cell, z = tz + j * cell;
          const r = nearestRoute(x, z);
          const rr = r ? { zone: r.zone, dist: r.dist, s: r.s } : null;
          const h = inCityBox(x, z) ? -0.6 : terrainHeight(x, z);
          pos.push(x, h, z); uv.push(x / 8, z / 8);
          const c = colorFor(x, z, h, rr); col.push(c[0], c[1], c[2]);
          // فتحة النفق في التضاريس
          skip.push(!!(rr && tunnel && rr.s > tunnel[0] - 4 && rr.s < tunnel[1] + 4 && rr.dist < 12));
        }
        const index = [];
        const id = (i, j) => j * (n + 1) + i;
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
          const a0 = id(i, j), a1 = id(i + 1, j), a2 = id(i + 1, j + 1), a3 = id(i, j + 1);
          if (skip[a0] || skip[a1] || skip[a2] || skip[a3]) continue;
          index.push(a3, a2, a1, a3, a1, a0);
        }
        if (!index.length) continue;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        geo.setIndex(index);
        geo.computeVertexNormals();
        // تغميق الميول (صخر الجبل والضفاف)
        const nrm = geo.attributes.normal, cl = geo.attributes.color;
        for (let q = 0; q < cl.count; q++) {
          const ny = nrm.getY(q);
          const sl = ny < 0.85 ? 0.7 + ny * 0.3 : 1;
          cl.setXYZ(q, cl.getX(q) * sl, cl.getY(q) * sl, cl.getZ(q) * sl);
        }
        geo.computeBoundingSphere();
        const mesh = new THREE.Mesh(geo, this.M.terrain);
        mesh.receiveShadow = true;
        mesh.name = 'terrain';
        const g = new THREE.Group();
        g.add(mesh);
        this._addChunk(g, cxm, czm, tile * 0.75 + 40);
      }
    }
    // أرض بعيدة تحت كل حاجة
    const far = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x9a8a6a, roughness: 1 }));
    far.position.set(300, -5, 100);
    this.group.add(far);
  }

  // ===================== النيل والترعة =====================
  _buildWater() {
    const W = new GeoBuilder();
    // النيل: مستطيل طويل باتجاه المجرى
    const tx = -RIVER.nz, tz = RIVER.nx; // اتجاه المجرى
    const L = 900, w = RIVER.half + 6;
    const c = [RIVER.cx, -1.3, RIVER.cz];
    const pt = (a, b) => [c[0] + tx * a + RIVER.nx * b, c[1], c[2] + tz * a + RIVER.nz * b];
    W.quad(pt(-L, -w), pt(-L, w), pt(L, w), pt(L, -w), [[0, 0], [0, 12], [100, 12], [100, 0]]);
    // ترعة جنب الطريق الزراعي
    const a = ROUTE.zones.agri, v = ROUTE.zones.village;
    for (let s = a[0]; s < v[1]; s += 4) {
      const d0 = CANAL_OFFSET - 4, d1 = CANAL_OFFSET + 4;
      const q0 = sampleAt(s), q1 = sampleAt(s + 4);
      const yy = -1.0;
      W.quad([q0.x + q0.rx * d0, yy, q0.z + q0.rz * d0], [q0.x + q0.rx * d1, yy, q0.z + q0.rz * d1], [q1.x + q1.rx * d1, yy, q1.z + q1.rz * d1], [q1.x + q1.rx * d0, yy, q1.z + q1.rz * d0], [[0, s / 6], [1, s / 6], [1, (s + 4) / 6], [0, (s + 4) / 6]]);
    }
    const m = new THREE.Mesh(W.build(), this.M.water);
    m.receiveShadow = true;
    m.name = 'water';
    this.water = m;
    this.group.add(m);
  }

  // ===================== جنب الطريق: مباني، نخل، أعمدة، جاردريل =====================
  _buildRoadside() {
    const R = rng(4321);
    const L = ROUTE.length;
    // --- عمارات/بيوت ---
    let seed = 9000;
    const placeRow = (zone, side, opts) => {
      const range = ROUTE.zones[zone];
      if (!range) return;
      let s = range[0] + 6;
      while (s < range[1] - 8) {
        const w = opts.wMin + R() * (opts.wMax - opts.wMin);
        const sc = s + w / 2;
        if (opts.skip && opts.skip(sc)) { s += w; continue; }
        const q = sampleAt(sc);
        const off = side * opts.offset;
        const x = q.x + q.rx * off, zz = q.z + q.rz * off;
        // واجهة العمارة ناحية الطريق: local +Z = -side*right
        const fx = -side * q.rx, fz = -side * q.rz;
        const rotY = Math.atan2(fx, fz);
        const B = this._chunk(sc);
        buildOne(B, {
          seed: seed++ * 7919, x, z: zz, rotY, width: w * 0.97, depth: opts.depth,
          floors: opts.fMin + Math.floor(R() * (opts.fMax - opts.fMin + 1)), style: R() < opts.brick ? 'brick' : 'plaster',
          facades: {}, shops: R() < opts.shops, detail: this.low ? 'low' : opts.detail,
        });
        s += w + (opts.gap ? R() * opts.gap : 0);
      }
    };
    for (const side of [-1, 1]) {
      placeRow('residential', side, { offset: 15, depth: 14, wMin: 12, wMax: 17, fMin: 5, fMax: 9, brick: 0.15, shops: 0.85, detail: 'low' });
      placeRow('roundabout', side, { offset: 15, depth: 14, wMin: 13, wMax: 18, fMin: 6, fMax: 11, brick: 0.1, shops: 0.8, detail: 'low', skip: (s) => this._islandNear(s, side) });
      placeRow('village', side, { offset: side > 0 ? 12.5 : 13, depth: 8, wMin: 7, wMax: 11, fMin: 0, fMax: 2, brick: 0.65, shops: 0.35, detail: 'low', gap: 6 });
    }
    this._flushChunks();

    // --- نخل (Instanced) ---
    const palms = [];
    const trees = [];
    for (let s = 0; s < L; s += 6) {
      const z = zoneAt(s);
      const q = sampleAt(s);
      const put = (arr, d, sc = 1) => {
        const h = terrainHeight(q.x + q.rx * d, q.z + q.rz * d);
        arr.push([q.x + q.rx * d + (R() - 0.5) * 2, h, q.z + q.rz * d + (R() - 0.5) * 2, sc * (0.85 + R() * 0.35)]);
      };
      if (z === 'agri' && R() < 0.5) { put(palms, -(13 + R() * 25)); if (R() < 0.5) put(palms, 30 + R() * 30); }
      if (z === 'agri' && R() < 0.25) put(trees, CANAL_OFFSET + 6.5, 1.3);
      if (z === 'village' && R() < 0.35) put(palms, (R() < 0.5 ? -1 : 1) * (22 + R() * 20));
      if (z === 'bridge' && Y(s) < 1 && R() < 0.4) put(palms, (R() < 0.5 ? -1 : 1) * (14 + R() * 18));
      if (URBAN.has(z) && s % 24 < 6) { put(trees, 11.2, 0.95); put(trees, -11.2, 0.95); }
      if (URBAN.has(z) && s % 30 < 6 && !inUturn(s)) palms.push([q.x, q.y + 0.24, q.z, 0.9 + R() * 0.2]);
      if (z === 'highway' && R() < 0.12) put(palms, (R() < 0.5 ? -1 : 1) * (16 + R() * 30));
      if (z === 'desert' && R() < 0.05) put(palms, (R() < 0.5 ? -1 : 1) * (25 + R() * 60), 0.8);
    }
    this._instancedPalms(palms);
    this._instancedTrees(trees);
    // جذوع الشجر والنخل القريبة من الطريق: صناديق تصادم صغيرة
    this._poles = [];
    for (const p of [...palms, ...trees]) {
      const r = nearestRoute(p[0], p[2]);
      if (r && r.dist < 26) this._poles.push([p[0], p[2], 0.26]);
    }

    // --- أعمدة إنارة ---
    const lamps = [];
    for (let s = 10; s < L; s += 36) {
      const z = zoneAt(s);
      const q = sampleAt(s);
      if (URBAN.has(z) || z === 'highway' || (z === 'bridge' && Y(s) > 1)) {
        for (const sx of [-1, 1]) {
          const d = sx * (z === 'bridge' ? HALF + 0.3 : HALF + 0.6);
          lamps.push({ x: q.x + q.rx * d, y: q.y + (URBAN.has(z) ? 0.18 : 0), z: q.z + q.rz * d, rot: Math.atan2(sx * q.rz, -sx * q.rx) });
        }
      }
    }
    this._instancedLamps(lamps);
    for (const l of lamps) this._poles.push([l.x, l.z, 0.2]);

    // --- أعمدة كهربا خشب + سلوك (زراعي وقرية) ---
    const poles = [];
    const wires = [];
    let prev = null;
    for (let s = ROUTE.zones.agri[0]; s < ROUTE.zones.agri[1]; s += 42) {
      const q = sampleAt(s), d = -12.5;
      const p = [q.x + q.rx * d, terrainHeight(q.x + q.rx * d, q.z + q.rz * d), q.z + q.rz * d];
      poles.push(p);
      this._poles.push([p[0], p[2], 0.16]);
      if (prev) for (const h of [7.2, 6.8, 6.4]) {
        const a = new THREE.Vector3(prev[0], prev[1] + h, prev[2]), b = new THREE.Vector3(p[0], p[1] + h, p[2]);
        for (let i = 0; i < 8; i++) {
          const t0 = i / 8, t1 = (i + 1) / 8;
          const p0 = a.clone().lerp(b, t0); p0.y -= Math.sin(Math.PI * t0) * 0.9;
          const p1 = a.clone().lerp(b, t1); p1.y -= Math.sin(Math.PI * t1) * 0.9;
          wires.push(p0, p1);
        }
      }
      prev = p;
    }
    {
      const g = new THREE.CylinderGeometry(0.1, 0.14, 7.6, 6).translate(0, 3.8, 0);
      const cross = new THREE.BoxGeometry(1.4, 0.1, 0.1).translate(0, 7.2, 0);
      const pm = new THREE.MeshStandardMaterial({ color: 0x8a8278, roughness: 0.9 });
      const im = new THREE.InstancedMesh(mergeTwo(g, cross), pm, poles.length);
      const m4 = new THREE.Matrix4();
      poles.forEach((p, i) => { m4.makeTranslation(p[0], p[1], p[2]); im.setMatrixAt(i, m4); });
      im.castShadow = true;
      this.group.add(im);
      const wl = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(wires), new THREE.LineBasicMaterial({ color: 0x1a1a1a }));
      this.group.add(wl);
    }

    // --- جاردريل معدني (صحراوي/جبلي/سريع) ---
    for (let s = 0; s < L - 2; s += 2) {
      const z = zoneAt(s);
      if (!(z === 'desert' || z === 'mountain' || z === 'highway')) continue;
      const B = this._chunk(s), s1 = s + 2;
      const rl = B.get('rail');
      for (const sx of [-1, 1]) {
        const d = sx * (HALF + 0.55);
        rl.setColor([0.85, 0.87, 0.88]);
        rl.quad(P(s, d, 0.45), P(s1, d, 0.45), P(s1, d, 0.75), P(s, d, 0.75), [[0, 0], [1, 0], [1, 1], [0, 1]]);
        if (s % 4 === 0) { const q = P(s, d + sx * 0.08, 0); rl.box(q[0] - 0.05, q[1], q[2] - 0.05, q[0] + 0.05, q[1] + 0.72, q[2] + 0.05); }
      }
    }
    // --- عواكس شيفرون في المنحنيات + علامات كيلو ---
    for (let s = 0; s < L; s += 14) {
      const q = sampleAt(s), z = q.zone;
      if (Math.abs(q.curv) > 1 / 140 && (z === 'agri' || z === 'mountain' || z === 'village' || z === 'desert')) {
        const side = q.curv > 0 ? 1 : -1; // جوه/بره اللفة: الإشارة على الحافة الخارجية
        this._chevron(this._chunk(s), s, side * (HALF + 1.4), side);
      }
    }
    this._flushChunks();

    // --- صخور الصحرا ---
    const rocks = [];
    for (let s = ROUTE.zones.desert[0]; s < ROUTE.zones.mountain[1]; s += 9) {
      if (R() < 0.5) continue;
      const q = sampleAt(s), d = (R() < 0.5 ? -1 : 1) * (14 + R() * 70);
      const x = q.x + q.rx * d, z = q.z + q.rz * d;
      rocks.push([x, terrainHeight(x, z), z, 0.6 + R() * 2.2, R() * 6]);
    }
    {
      const geo = new THREE.IcosahedronGeometry(1, 1);
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) { const k = 0.75 + fbm(p.getX(i) * 3, p.getZ(i) * 3 + p.getY(i)) * 0.5; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.7, p.getZ(i) * k); }
      geo.computeVertexNormals();
      const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: 0xa08a68, roughness: 0.95, flatShading: true }), rocks.length);
      const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion();
      rocks.forEach((r, i) => { q4.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r[4]); m4.compose(new THREE.Vector3(r[0], r[1] - r[3] * 0.25, r[2]), q4, new THREE.Vector3(r[3], r[3], r[3])); im.setMatrixAt(i, m4); });
      im.castShadow = true; im.receiveShadow = true;
      this.group.add(im);
    }

    // --- جامع بمئدنة في القرية ---
    const v = ROUTE.zones.village;
    const qm = sampleAt((v[0] + v[1]) / 2);
    this._mosque(qm.x - qm.rx * 26, terrainHeight(qm.x - qm.rx * 26, qm.z - qm.rz * 26), qm.z - qm.rz * 26, Math.atan2(qm.rx, qm.rz));
  }

  _islandNear(s, side) {
    if (!this.island) return false;
    const q = sampleAt(s), x = q.x + q.rx * side * 22, z = q.z + q.rz * side * 22;
    return Math.hypot(x - this.island.x, z - this.island.z) < this.island.r + 16;
  }

  _pier(B, s) {
    const q = sampleAt(s);
    const j = B.get('jersey');
    j.setColor([0.78, 0.76, 0.72]);
    for (const d of [-6, 6]) {
      const x = q.x + q.rx * d, z = q.z + q.rz * d;
      j.box(x - 0.9, -4, z - 0.9, x + 0.9, q.y - 1.4, z + 0.9);
    }
  }

  _chevron(B, s, d, side) {
    const q = P(s, d, 0);
    const pole = B.get('paintedMetal');
    pole.setColor([0.3, 0.3, 0.3]);
    pole.box(q[0] - 0.04, q[1], q[2] - 0.04, q[0] + 0.04, q[1] + 1.2, q[2] + 0.04);
    if (!this._chevTex) {
      const c = canvas(64, 64), ctx = c.getContext('2d');
      ctx.fillStyle = '#111'; ctx.fillRect(0, 0, 64, 64);
      ctx.fillStyle = '#f2f2f2'; ctx.beginPath(); ctx.moveTo(40, 8); ctx.lineTo(18, 32); ctx.lineTo(40, 56); ctx.lineTo(50, 56); ctx.lineTo(28, 32); ctx.lineTo(50, 8); ctx.fill();
      this._chevTex = tex(c, { repeat: false });
      this.M.chevron = new THREE.MeshStandardMaterial({ map: this._chevTex, roughness: 0.4, side: THREE.DoubleSide, emissive: 0xffffff, emissiveMap: this._chevTex, emissiveIntensity: 0.05 });
    }
    const sq = sampleAt(s);
    const h = 1.2, w = 0.3;
    const b = B.get('chevron');
    const a = [q[0] - sq.dx * w, q[1] + h, q[2] - sq.dz * w], c = [q[0] + sq.dx * w, q[1] + h, q[2] + sq.dz * w];
    const flip = side > 0;
    b.quad(flip ? c : a, flip ? a : c, flip ? [a[0], a[1] + 0.6, a[2]] : [c[0], c[1] + 0.6, c[2]], flip ? [c[0], c[1] + 0.6, c[2]] : [a[0], a[1] + 0.6, a[2]]);
  }

  _instancedPalms(list) {
    if (!list.length) return;
    const trunk = new THREE.CylinderGeometry(0.15, 0.24, 7.5, 7, 4).translate(0, 3.75, 0);
    // ميل خفيف للجذع
    const frond = new THREE.PlaneGeometry(0.95, 3.6, 1, 4).translate(0, 1.8, 0);
    const fp = frond.attributes.position;
    for (let i = 0; i < fp.count; i++) { const y = fp.getY(i); fp.setZ(i, y * y * 0.13); }
    const fb = new GeoBuilder();
    for (let i = 0; i < 12; i++) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.9 - (i % 3) * 0.2, (i / 12) * Math.PI * 2, 0, 'YXZ'));
      fb.addGeometry(frond, new THREE.Matrix4().compose(new THREE.Vector3(0, 7.4, 0), q, new THREE.Vector3(1, 1, 1)));
    }
    const fronds = fb.build();
    fronds.computeVertexNormals();
    const tMat = new THREE.MeshStandardMaterial({ color: 0x6b5a46, roughness: 0.95 });
    const it = new THREE.InstancedMesh(trunk, tMat, list.length);
    const ifr = new THREE.InstancedMesh(fronds, this.M.palm, list.length);
    const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), R = rng(31);
    list.forEach((p, i) => {
      qq.setFromEuler(new THREE.Euler((R() - 0.5) * 0.12, R() * 6.28, (R() - 0.5) * 0.12));
      m4.compose(new THREE.Vector3(p[0], p[1], p[2]), qq, new THREE.Vector3(p[3], p[3], p[3]));
      it.setMatrixAt(i, m4); ifr.setMatrixAt(i, m4);
    });
    it.castShadow = ifr.castShadow = true;
    this.group.add(it, ifr);
  }

  _instancedTrees(list) {
    if (!list.length) return;
    const R = rng(12);
    const trunk = new THREE.CylinderGeometry(0.14, 0.2, 3.6, 6).translate(0, 1.8, 0);
    const tb = new GeoBuilder();
    tb.setColor([0.92, 0.92, 0.88]); tb.addGeometry(new THREE.CylinderGeometry(0.2, 0.22, 1.2, 6).translate(0, 0.6, 0));
    tb.setColor([0.35, 0.28, 0.2]); tb.addGeometry(trunk);
    const card = new THREE.PlaneGeometry(2.5, 2.5);
    const lb = new GeoBuilder();
    for (let i = 0; i < 14; i++) {
      const a = R() * Math.PI * 2, r = R() * 1.5;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((R() - 0.5) * 1.2, R() * Math.PI, (R() - 0.5) * 0.8));
      lb.addGeometry(card, new THREE.Matrix4().compose(new THREE.Vector3(Math.cos(a) * r, 3.9 + R() * 2.3, Math.sin(a) * r), q, new THREE.Vector3(1, 1, 1)));
    }
    const it = new THREE.InstancedMesh(tb.build(), this.M.trunk, list.length);
    const il = new THREE.InstancedMesh(lb.build(), this.M.leaves, list.length);
    const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion();
    list.forEach((p, i) => { qq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), R() * 6.28); m4.compose(new THREE.Vector3(p[0], p[1], p[2]), qq, new THREE.Vector3(p[3], p[3], p[3])); it.setMatrixAt(i, m4); il.setMatrixAt(i, m4); });
    it.castShadow = il.castShadow = true;
    this.group.add(it, il);
  }

  _instancedLamps(list) {
    if (!list.length) return;
    const b = new GeoBuilder();
    b.addGeometry(new THREE.CylinderGeometry(0.07, 0.12, 9, 8).translate(0, 4.5, 0));
    b.addGeometry(new THREE.CylinderGeometry(0.045, 0.05, 2.4, 6).rotateZ(Math.PI / 2).translate(1.1, 8.8, 0));
    b.addGeometry(new THREE.BoxGeometry(0.75, 0.16, 0.32).translate(2.25, 8.75, 0));
    const glass = new THREE.BoxGeometry(0.6, 0.05, 0.24).translate(2.25, 8.65, 0);
    const im = new THREE.InstancedMesh(b.build(), this.M.paintedMetal, list.length);
    const ig = new THREE.InstancedMesh(glass, this.M.lampGlass, list.length);
    const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion();
    list.forEach((l, i) => {
      qq.setFromAxisAngle(new THREE.Vector3(0, 1, 0), l.rot);
      m4.compose(new THREE.Vector3(l.x, l.y, l.z), qq, new THREE.Vector3(1, 1, 1));
      im.setMatrixAt(i, m4); ig.setMatrixAt(i, m4);
      LAMP_POSITIONS.push(new THREE.Vector3(2.25, 8.5, 0).applyMatrix4(m4));
    });
    im.castShadow = true;
    this.group.add(im, ig);
  }

  _mosque(x, y, z, rot) {
    const b = new GeoBuilder();
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot), new THREE.Vector3(1, 1, 1));
    b.setTransform(m);
    b.setColor([0.95, 0.9, 0.78]);
    b.box(-7, 0, -7, 7, 6.5, 7, { uvScale: 3 });
    b.setColor([0.9, 0.86, 0.72]);
    b.addGeometry(new THREE.SphereGeometry(4.2, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.Matrix4().makeTranslation(0, 6.5, 0));
    b.addGeometry(new THREE.CylinderGeometry(4.3, 4.3, 0.8, 18), new THREE.Matrix4().makeTranslation(0, 6.9, 0));
    // المئذنة
    b.setColor([0.96, 0.92, 0.82]);
    b.addGeometry(new THREE.CylinderGeometry(1.1, 1.3, 14, 8), new THREE.Matrix4().makeTranslation(9, 7, 4));
    b.addGeometry(new THREE.CylinderGeometry(1.7, 1.5, 0.6, 10), new THREE.Matrix4().makeTranslation(9, 14.2, 4));
    b.addGeometry(new THREE.CylinderGeometry(0.85, 1.0, 5, 8), new THREE.Matrix4().makeTranslation(9, 17, 4));
    b.addGeometry(new THREE.CylinderGeometry(1.3, 1.1, 0.5, 10), new THREE.Matrix4().makeTranslation(9, 19.6, 4));
    b.addGeometry(new THREE.CylinderGeometry(0.6, 0.75, 2.5, 8), new THREE.Matrix4().makeTranslation(9, 21.1, 4));
    b.addGeometry(new THREE.ConeGeometry(0.75, 2.6, 8), new THREE.Matrix4().makeTranslation(9, 23.6, 4));
    b.setColor([0.75, 0.62, 0.3]);
    b.addGeometry(new THREE.SphereGeometry(0.22, 8, 6), new THREE.Matrix4().makeTranslation(9, 25.1, 4));
    b.addGeometry(new THREE.SphereGeometry(0.3, 8, 6), new THREE.Matrix4().makeTranslation(0, 11, 0));
    const mesh = new THREE.Mesh(b.build(), this.M.mosque);
    mesh.castShadow = true; mesh.receiveShadow = true;
    const g = new THREE.Group(); g.add(mesh);
    this._addChunk(g, x, z, 40);
  }

  // ===================== النفق =====================
  _buildTunnel() {
    const t = ROUTE.zones.tunnel;
    if (!t) return;
    const B = new Buckets();
    const tw = B.get('tunnel');
    const lampB = B.get('tunnelLamp');
    const H = 7.2, W = HALF + 0.3;
    const arc = [];
    for (let k = 0; k <= 10; k++) { const a = Math.PI * (k / 10); arc.push([Math.cos(a) * W, 4.2 + Math.sin(a) * (H - 4.2)]); }
    const prof = [[W, 0], ...arc, [-W, 0]];
    for (let s = t[0] - 2; s < t[1] + 2; s += 2) {
      const s1 = s + 2;
      tw.setColor(((s / 2) | 0) % 2 ? [0.95, 0.93, 0.9] : [0.88, 0.86, 0.82]);
      for (let k = 0; k < prof.length - 1; k++) {
        const [d0, h0] = prof[k], [d1, h1] = prof[k + 1];
        tw.quad(P(s, d0, h0), P(s, d1, h1), P(s1, d1, h1), P(s1, d0, h0));
      }
      if (((s / 2) | 0) % 6 === 0) for (const d of [-3, 3]) { const q = P(s, d, H - 0.25); lampB.box(q[0] - 0.4, q[1] - 0.06, q[2] - 0.4, q[0] + 0.4, q[1], q[2] + 0.4); }
      // سقف من بره بلون الصخر (يقفل فتحة التضاريس)
      const top = sampleAt(s).y + 13;
      tw.setColor([0.55, 0.47, 0.38]);
      tw.quad(P(s, -14, top - sampleAt(s).y), P(s, 14, top - sampleAt(s).y), P(s1, 14, top - sampleAt(s1).y), P(s1, -14, top - sampleAt(s1).y));
      for (const sx of [-1, 1]) {
        const d = sx * 14;
        if (sx > 0) tw.quad(P(s, d, -1), P(s1, d, -1), P(s1, d, 13), P(s, d, 13)); else tw.quad(P(s1, d, -1), P(s, d, -1), P(s, d, 13), P(s1, d, 13));
      }
    }
    // واجهة النفق (Portal) عند المدخلين
    for (const [s, dir] of [[t[0] - 2, -1], [t[1] + 2, 1]]) {
      tw.setColor([0.78, 0.75, 0.7]);
      const top = 13;
      const steps = 12;
      for (let k = 0; k < steps; k++) {
        const a0 = Math.PI * (k / steps), a1 = Math.PI * ((k + 1) / steps);
        const p0 = [Math.cos(a0) * W, 4.2 + Math.sin(a0) * (H - 4.2)], p1 = [Math.cos(a1) * W, 4.2 + Math.sin(a1) * (H - 4.2)];
        const q0 = P(s, p0[0], p0[1]), q1 = P(s, p1[0], p1[1]), u0 = P(s, p0[0] * 1.4, top), u1 = P(s, p1[0] * 1.4, top);
        if (dir < 0) tw.quad(q0, u0, u1, q1); else tw.quad(q1, u1, u0, q0);
      }
      for (const sx of [-1, 1]) {
        const a = P(s, sx * W, 0), b = P(s, sx * 14, 0), c = P(s, sx * 14, top), d = P(s, sx * W, 4.2);
        if (dir * sx < 0) tw.quad(a, b, c, d); else tw.quad(b, a, d, c);
      }
    }
    const g = new THREE.Group();
    B.toMeshes(this.M, g);
    g.traverse((o) => { if (o.name === 'tunnelLamp') o.castShadow = false; });
    const q = sampleAt((t[0] + t[1]) / 2);
    this._addChunk(g, q.x, q.z, (t[1] - t[0]) / 2 + 40);
    this.tunnelRange = t;
  }

  // ===================== الميدان (دوار بجنينة ومسلة) =====================
  _buildRoundabout() {
    const r = ROUTE.zones.roundabout;
    if (!r) return;
    // مركز اللفة: أكتر نقطة انحناء
    let best = r[0], bc = 0;
    for (let s = r[0]; s < r[1]; s += 2) { const c = Math.abs(sampleAt(s).curv); if (c > bc) { bc = c; best = s; } }
    const q = sampleAt(best);
    const R = Math.min(70, 1 / Math.max(bc, 1e-3));
    const side = Math.sign(q.curv) || 1; // موجب = شمال → الجزيرة شمال الطريق
    const off = -side * (R);
    const cx = q.x + q.rx * off, cz = q.z + q.rz * off;
    const rad = Math.max(16, R - 26);
    this.island = { s: best, x: cx, z: cz, r: rad };
    const b = new GeoBuilder();
    b.setColor([0.35, 0.55, 0.25]);
    b.addGeometry(new THREE.CylinderGeometry(rad, rad, 0.4, 40), new THREE.Matrix4().makeTranslation(cx, 0.2, cz));
    b.setColor([0.9, 0.85, 0.3]);
    b.addGeometry(new THREE.CylinderGeometry(rad + 0.3, rad + 0.3, 0.3, 40, 1, true), new THREE.Matrix4().makeTranslation(cx, 0.15, cz));
    // مسلة في النص
    b.setColor([0.85, 0.72, 0.55]);
    b.addGeometry(new THREE.CylinderGeometry(2.6, 3, 1.2, 4), new THREE.Matrix4().compose(new THREE.Vector3(cx, 0.9, cz), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4), new THREE.Vector3(1, 1, 1)));
    b.addGeometry(new THREE.CylinderGeometry(0.75, 1.15, 14, 4), new THREE.Matrix4().compose(new THREE.Vector3(cx, 8.5, cz), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4), new THREE.Vector3(1, 1, 1)));
    b.addGeometry(new THREE.ConeGeometry(0.8, 1.6, 4), new THREE.Matrix4().compose(new THREE.Vector3(cx, 16.3, cz), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4), new THREE.Vector3(1, 1, 1)));
    const mesh = new THREE.Mesh(b.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }));
    mesh.castShadow = true; mesh.receiveShadow = true;
    const g = new THREE.Group(); g.add(mesh);
    this._addChunk(g, cx, cz, rad + 40);
    const palms = [];
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; palms.push([cx + Math.cos(a) * rad * 0.75, 0.4, cz + Math.sin(a) * rad * 0.75, 1]); }
    this._instancedPalms(palms);
  }

  // ===================== يافطات اتجاهات (Gantry) =====================
  _buildSigns() {
    const add = (s, lines) => {
      const q = sampleAt(s);
      const c = canvas(1024, 256), ctx = c.getContext('2d');
      ctx.fillStyle = '#1b4f9c'; ctx.fillRect(0, 0, 1024, 256);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 8; ctx.strokeRect(10, 10, 1004, 236);
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      lines.forEach(([ar, en, arrow], i) => {
        const x = 1024 - (i + 0.5) * (1024 / lines.length);
        ctx.font = 'bold 52px "Cairo", sans-serif'; ctx.direction = 'rtl'; ctx.fillText(ar, x, 88);
        ctx.font = '34px Arial'; ctx.direction = 'ltr'; ctx.fillText(en, x, 150);
        ctx.font = 'bold 60px Arial'; ctx.fillText(arrow, x, 210);
      });
      const mat = new THREE.MeshStandardMaterial({ map: tex(c, { repeat: false }), roughness: 0.5, emissive: 0xffffff, emissiveMap: null, emissiveIntensity: 0 });
      const g = new THREE.Group();
      const yaw = Math.atan2(-q.dx, -q.dz); // وش اليافطة ناحية العربيات الجاية
      const signW = 11, signH = 2.75;
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(signW, signH), mat);
      plane.position.set(q.x + q.rx * 4.6, q.y + 7.4, q.z + q.rz * 4.6);
      plane.rotation.y = yaw;
      const back = new THREE.Mesh(new THREE.BoxGeometry(signW + 0.2, signH + 0.2, 0.15), this.M.paintedMetal);
      back.position.copy(plane.position).addScaledVector(new THREE.Vector3(q.dx, 0, q.dz), 0.1);
      back.rotation.y = yaw;
      g.add(plane, back);
      const beam = new THREE.Mesh(new THREE.BoxGeometry(22, 0.35, 0.35), this.M.paintedMetal);
      beam.position.set(q.x, q.y + 8.9, q.z).addScaledVector(new THREE.Vector3(q.dx, 0, q.dz), 0.25);
      beam.rotation.y = Math.atan2(-q.rz, q.rx);
      g.add(beam);
      for (const sx of [-1, 1]) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 9.1, 10), this.M.paintedMetal);
        p.position.set(q.x + q.rx * sx * 11, q.y + 4.55, q.z + q.rz * sx * 11);
        g.add(p);
      }
      g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      this._addChunk(g, q.x, q.z, 40);
    };
    const z = ROUTE.zones;
    add(z.residential[0] + 70, [['ميدان التحرير', 'Tahrir Sq.', '↑'], ['كوبري 6 أكتوبر', '6 October Br.', '↑'], ['الجيزة', 'Giza', '↗']]);
    add(z.bridge[0] - 40, [['كوبري النيل', 'Nile Bridge', '↑'], ['الطريق الزراعي', 'Agricultural Rd', '↑']]);
    add(z.desert[0] + 30, [['الطريق الصحراوي', 'Desert Road', '↑'], ['العين السخنة', 'Ain Sokhna', '↑']]);
    add(z.highway[1] - 260, [['وسط البلد', 'Downtown', '↑'], ['مخرج', 'EXIT', '↗'], ['دوران للخلف', 'U-Turn', '↶']]);
  }

  // ===================== صناديق التصادم =====================
  _buildColliders() {
    const L = ROUTE.length;
    const seg = 6;
    const add = (s, d, hw, kind) => {
      const q = sampleAt(s + seg / 2);
      this.colliders.push({ cx: q.x + q.rx * d, cz: q.z + q.rz * d, hx: hw, hz: seg / 2 + 0.2, angle: Math.atan2(-q.dx, -q.dz), restitution: 0.15, kind });
    };
    for (let s = 0; s < L - seg; s += seg) {
      const z = zoneAt(s + seg / 2);
      // الحواف
      // في المناطق السكنية الرصيف بيتطلع عليه (ارتفاع في الأرض) والحيطة عند واجهات العمارات بس
      const edge = URBAN.has(z) ? 15 : z === 'agri' || z === 'village' ? HALF + 1.6 : HALF + 0.9;
      add(s, edge + 0.5, 0.5, URBAN.has(z) ? 'building' : 'edge');
      add(s, -edge - 0.5, 0.5, URBAN.has(z) ? 'building' : 'edge');
      // الحاجز الخرساني في الطرق السريعة (الجزيرة بالزرع في السكني ليها ارتفاع بس)
      if (!inUturn(s + seg / 2) && z !== 'tunnel' && !URBAN.has(z)) add(s, 0, 0.35, 'median');
    }
    // أعمدة وشجر
    for (const [x, z, r] of this._poles || []) this.colliders.push({ cx: x, cz: z, hx: r, hz: r, angle: 0, restitution: 0.1, kind: 'pole' });
    // شبكة بحث
    this.colGrid = new Map();
    const C = 30;
    this.colliders.forEach((c, i) => {
      const k = `${Math.floor(c.cx / C)},${Math.floor(c.cz / C)}`;
      if (!this.colGrid.has(k)) this.colGrid.set(k, []);
      this.colGrid.get(k).push(c);
    });
    this._C = C;
  }

  /** صناديق التصادم القريبة من مكان */
  queryColliders(x, z, out) {
    const C = this._C, cx = Math.floor(x / C), cz = Math.floor(z / C);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const arr = this.colGrid.get(`${cx + i},${cz + j}`);
      if (arr) for (const c of arr) out.push(c);
    }
  }

  /** إظهار/إخفاء حسب المسافة (LOD بسيط + توفير draw calls) */
  updateVisibility(cam, maxDist) {
    for (const c of this.chunks) {
      const d = Math.hypot(c.cx - cam.x, c.cz - cam.z) - c.r;
      c.group.visible = d < maxDist;
    }
  }

  update(dt) {
    if (this.water) { const n = this.water.material.normalMap; if (n) { n.offset.x += dt * 0.01; n.offset.y += dt * 0.006; } }
  }
}

function inCityBox(x, z) { return Math.abs(x) < 100 && z > -275 && z < 175; }

function mergeTwo(a, b) {
  const g = new GeoBuilder();
  g.addGeometry(a); g.addGeometry(b);
  return g.build();
}
