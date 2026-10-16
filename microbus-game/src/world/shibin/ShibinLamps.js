// =====================================================================
//  أعمدة النور في شبين (الليل): على الطرق الرئيسية/الثانوية، على حرف الرصيف، كل ~34م
//  - الأعمدة + رؤوسها: InstancedMesh (2 draw calls) للأعمدة القريبة بس (بتتجدد كل نص ثانية)
//  - بالليل: الراس منوّر + هالة (Points واحدة) + بقعة نور مزيفة على الأسفلت (instanced) → شكل نور حقيقي
//    من غير أنوار حقيقية (الأنوار الحقيقية القليلة بتروح لأقرب أعمدة من Game.lampLights)
//  - الأماكن متولّدة من شبكة الطرق الحقيقية (ديكور عام زي الرصيف)، مش أماكن متألفة
//  - العمود بيتأكد إنه على الرصيف فعلًا أول ما المربع بتاعه يتحمّل، وبعدها بيبقى ليه collider
// =====================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { edgePoint } from './ShibinData.js';
import { canvas, tex } from '../../render/textures.js';

const CLASSES = new Set(['trunk', 'primary', 'secondary', 'tertiary', 'trunk_link', 'primary_link', 'secondary_link']);
const STEP = 34, POLE_H = 7.2, ARM = 1.7, CELL = 100;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

function glowTexture(size = 64, inner = 'rgba(255,226,170,1)', mid = 'rgba(255,190,110,0.35)') {
  const c = canvas(size, size), x = c.getContext('2d'), g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner); g.addColorStop(0.25, mid); g.addColorStop(1, 'rgba(255,170,90,0)');
  x.fillStyle = g; x.fillRect(0, 0, size, size);
  return tex(c, { repeat: false });
}

export class ShibinLamps {
  constructor(world, { mobile = false, max } = {}) {
    this.world = world;
    this.R = mobile ? 170 : 260;
    this.max = max ?? (mobile ? 80 : 150);
    this.night = false;
    this.lamps = [];
    this.grid = new Map();
    this._build();
    this._meshes();
    this.near = []; // أماكن رؤوس الأعمدة القريبة (Vector3) — للأنوار الحقيقية
    this._t = 0;
  }

  _build() {
    const W = this.world, q = {}, seen = new Set();
    for (const e of W.graph.edges) {
      if (!CLASSES.has(e.cls) || e.closed || e.length < 24) continue;
      const both = e.width >= 12; // الطرق العريضة: عواميد على الناحيتين
      let k = 0;
      for (let s = 10; s < e.length - 8; s += STEP, k++) {
        edgePoint(e, s, q);
        // بعيد عن التقاطعات
        const dFrom = s, dTo = e.length - s;
        if ((dFrom < 10 && e.from.edges.length > 2) || (dTo < 10 && e.to.edges.length > 2)) continue;
        const nx = -q.dz, nz = q.dx;
        for (const side of both ? [1, -1] : [k % 2 ? 1 : -1]) {
          const off = e.elevated ? e.half - 0.25 : e.half + 0.55;
          const x = q.x + nx * side * off, z = q.z + nz * side * off;
          const key = `${Math.round(x / 8)},${Math.round(z / 8)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          // الدراع بيبص ناحية الشارع
          const L = { x, z, y: e.elevated ? q.y : 0.15, ax: -nx * side, az: -nz * side, elevated: e.elevated, ok: e.elevated ? true : undefined, col: false };
          this.lamps.push(L);
          const ck = Math.floor(x / CELL) * 100003 + Math.floor(z / CELL);
          let a = this.grid.get(ck); if (!a) this.grid.set(ck, (a = [])); a.push(L);
        }
      }
    }
  }

  _meshes() {
    const N = this.max;
    const pole = new THREE.CylinderGeometry(0.06, 0.09, POLE_H, 6, 1, true).translate(0, POLE_H / 2, 0);
    const arm = new THREE.BoxGeometry(ARM, 0.07, 0.07).translate(ARM / 2, POLE_H - 0.1, 0);
    const base = new THREE.CylinderGeometry(0.14, 0.16, 0.5, 6).translate(0, 0.25, 0);
    const poleGeo = mergeGeometries([pole.toNonIndexed(), arm.toNonIndexed(), base.toNonIndexed()]);
    const headGeo = new THREE.BoxGeometry(0.55, 0.12, 0.26).translate(ARM - 0.05, POLE_H - 0.2, 0);
    this.poleMat = new THREE.MeshStandardMaterial({ color: 0x55595e, roughness: 0.6, metalness: 0.5 });
    this.headMat = new THREE.MeshBasicMaterial({ color: 0x6d6f70, toneMapped: false });
    this.poles = new THREE.InstancedMesh(poleGeo, this.poleMat, N);
    this.heads = new THREE.InstancedMesh(headGeo, this.headMat, N);
    // بقعة النور على الأرض: مستطيل مسطح بتدرّج، additive (مفيش حسابات إضاءة)
    const poolGeo = new THREE.PlaneGeometry(11, 11).rotateX(-Math.PI / 2);
    this.poolMat = new THREE.MeshBasicMaterial({ map: glowTexture(128, 'rgba(255,214,150,0.7)', 'rgba(255,196,120,0.34)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, opacity: 1 });
    this.pools = new THREE.InstancedMesh(poolGeo, this.poolMat, N);
    // الهالة حوالين الراس
    this.glowGeo = new THREE.BufferGeometry();
    this.glowPos = new Float32Array(N * 3);
    this.glowGeo.setAttribute('position', new THREE.BufferAttribute(this.glowPos, 3));
    this.glowMat = new THREE.PointsMaterial({ map: glowTexture(64), size: 3.2, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    this.glow = new THREE.Points(this.glowGeo, this.glowMat);
    for (const m of [this.poles, this.heads, this.pools, this.glow]) { m.frustumCulled = false; m.count !== undefined && (m.count = 0); }
    this.glowGeo.setDrawRange(0, 0);
    this.pools.renderOrder = 1; this.glow.renderOrder = 3;
    this.poles.castShadow = false;
    this.group = new THREE.Group(); this.group.name = 'street-lamps';
    this.group.add(this.poles, this.heads, this.pools, this.glow);
    this.setNight(false);
  }

  setNight(on) {
    this.night = on;
    this.headMat.color.set(on ? 0xffe3b0 : 0x6d6f70);
    this.pools.visible = on; this.glow.visible = on;
  }

  /** كل نص ثانية: أقرب الأعمدة للكاميرا */
  update(dt, cam) {
    this._t -= dt;
    if (this._t > 0) return;
    this._t = 0.5;
    const W = this.world, R2 = this.R * this.R, c0 = Math.floor((cam.x - this.R) / CELL), c1 = Math.floor((cam.x + this.R) / CELL);
    const d0 = Math.floor((cam.z - this.R) / CELL), d1 = Math.floor((cam.z + this.R) / CELL);
    const pick = this._pick || (this._pick = []);
    pick.length = 0;
    for (let i = c0; i <= c1; i++) for (let j = d0; j <= d1; j++) {
      const a = this.grid.get(i * 100003 + j); if (!a) continue;
      for (const L of a) {
        const d2 = (L.x - cam.x) ** 2 + (L.z - cam.z) ** 2;
        if (d2 > R2) continue;
        if (L.ok === undefined) {
          // أول مرة المربع يبقى جاهز: لازم يكون على رصيف حقيقي (مش مدخل/ترعة/أسفلت)
          const T = W.tiles.get(W._tkey(Math.floor(L.x / W.TS), Math.floor(L.z / W.TS)));
          if (!T || !T.ready) continue;
          L.ok = Math.abs(W.height(L.x, L.z, 0) - 0.15) < 0.01;
        }
        if (!L.ok) continue;
        if (!L.col) { L.col = true; W._addCollider({ cx: L.x, cz: L.z, hx: 0.16, hz: 0.16, angle: 0, restitution: 0.1, kind: 'prop', yMin: L.y - 1.5, yMax: L.y + 1.5 }, null); }
        L.d2 = d2; pick.push(L);
      }
    }
    if (pick.length > this.max) { pick.sort((a, b) => a.d2 - b.d2); pick.length = this.max; }
    const near = this.near; near.length = 0;
    for (let k = 0; k < pick.length; k++) {
      const L = pick[k];
      _q.setFromAxisAngle(_up, Math.atan2(-L.az, L.ax)); // محور x المحلي ← اتجاه الدراع
      _p.set(L.x, L.y, L.z);
      _m.compose(_p, _q, _s);
      this.poles.setMatrixAt(k, _m); this.heads.setMatrixAt(k, _m);
      const hx = L.x + L.ax * (ARM - 0.05), hz = L.z + L.az * (ARM - 0.05), hy = L.y + POLE_H - 0.3;
      this.glowPos[k * 3] = hx; this.glowPos[k * 3 + 1] = hy; this.glowPos[k * 3 + 2] = hz;
      _p.set(L.x + L.ax * 2.2, (L.elevated ? L.y : 0) + 0.04, L.z + L.az * 2.2);
      _m.compose(_p, _q, _s);
      this.pools.setMatrixAt(k, _m);
      if (near.length < 8) near.push(new THREE.Vector3(hx, hy - 0.6, hz));
    }
    for (const m of [this.poles, this.heads, this.pools]) { m.count = pick.length; m.instanceMatrix.needsUpdate = true; }
    this.glowGeo.setDrawRange(0, pick.length);
    this.glowGeo.attributes.position.needsUpdate = true;
    this.visibleCount = pick.length;
  }

  dispose() {
    for (const m of [this.poles, this.heads, this.pools]) { m.geometry.dispose(); m.dispose?.(); }
    this.glowGeo.dispose();
    for (const m of [this.poleMat, this.headMat, this.poolMat, this.glowMat]) { m.map?.dispose(); m.dispose(); }
  }
}
