import * as THREE from 'three';
import { rng } from '../render/textures.js';
import { person } from './Pedestrians.js';
import { ROAD, CROSSINGS, mainSegments } from './layout.js';
import { ROADS, SIDEWALK_W, onOtherCarriageway } from './RoadNetwork.js';
import { ROUTE, URBAN_ZONES, nearJunction } from './Route.js';
import { groundHeight } from './ground.js';
import { TERMINAL } from './Shibin.js';

// الزحمة: ناس كتير ماشيين وواقفين على كل الأرصفة (وسط البلد، شبين الكوم، الموقف، والقرى).
// - "حارات مشي" جاهزة على كل رصيف (خط + عرض الرصيف)
// - عدد ثابت من الناس بيعيشوا حوالين الكاميرا: اللي يبعد أوي بيتنقل لرصيف تاني قريب (Pooling)
// - الرسم بـ InstancedMesh: كل الناس في ~45 draw call بس مهما كان العدد

const VARIANTS = 15;
const STEP = 3; // متر بين نقط الحارة
const VIEW = 95, RECYCLE = 125, SPAWN_MIN = 14, SPAWN_MAX = 115;

function buildLanes() {
  const lanes = [];
  const add = (pts, lo, hi, weight) => { if (pts.length >= 4) lanes.push({ pts, lo, hi, weight, len: (pts.length - 1) * STEP }); };
  // نقطة: x,z مركز الخط، nx,nz اتجاه الرصيف (ناحية العمارات)، yLo/yHi ارتفاع الأرض عند حدود الرصيف
  const pt = (x, z, nx, nz, lo, hi) => ({ x, z, nx, nz, yLo: groundHeight(x + nx * lo, z + nz * lo), yHi: groundHeight(x + nx * hi, z + nz * hi) });

  // 1) وسط البلد: الشارع الرئيسي
  for (const [zs, ze] of mainSegments(1.5)) {
    for (const sx of [-1, 1]) {
      const pts = [];
      for (let z = zs; z >= ze; z -= STEP) pts.push(pt(sx * ROAD.curb, z, sx, 0, 0.6, ROAD.sidewalkOuter - ROAD.curb - 0.5));
      add(pts, 0.6, ROAD.sidewalkOuter - ROAD.curb - 0.5, 1.2);
    }
  }
  // الشوارع العرضية
  for (const cr of CROSSINGS) {
    for (const sz of [-1, 1]) for (const sx of [-1, 1]) {
      const pts = [];
      for (let a = ROAD.sidewalkOuter + 1; a < Math.abs(sx > 0 ? cr.xMax : cr.xMin) - 3; a += STEP) pts.push(pt(sx * a, cr.z + sz * cr.half, 0, sz, 0.4, cr.sidewalk - 0.4));
      add(pts, 0.4, cr.sidewalk - 0.4, 1);
    }
  }
  // 2) الطريق الدائري: المناطق السكنية ليها رصيف، والقرى الناس ماشية على جنب الطريق
  for (const side of [-1, 1]) {
    let pts = [], kind = null;
    const flush = () => { if (kind) add(pts, kind === 'urban' ? 10.5 : 10.8, kind === 'urban' ? 14.9 : 12.2, kind === 'urban' ? 0.8 : 0.45); pts = []; kind = null; };
    let next = 0;
    for (const p of ROUTE.samples) {
      if (p.s < next) continue;
      next = p.s + STEP;
      const k = URBAN_ZONES.has(p.zone) ? 'urban' : p.zone === 'village' ? 'village' : null;
      if (!k || nearJunction(p.s, side, 4) || (kind && k !== kind)) { flush(); if (!k || nearJunction(p.s, side, 4)) continue; }
      kind = k;
      const lo = k === 'urban' ? 10.5 : 10.8, hi = k === 'urban' ? 14.9 : 12.2;
      pts.push(pt(p.x, p.z, p.rx * side, p.rz * side, lo, hi));
    }
    flush();
  }
  // 3) شوارع شبين والطرق الفرعية
  for (const road of ROADS) {
    if (road.style !== 'urban' && road.style !== 'city' && road.style !== 'agri') continue;
    const urban = road.style === 'urban';
    for (const side of [-1, 1]) {
      let pts = [], lo = 0, hi = 0;
      const flush = () => { add(pts, lo, hi, urban ? 1.3 : road.style === 'city' ? 0.7 : 0.3); pts = []; };
      let next = 0;
      for (const p of road.samples) {
        if (p.s < next) continue;
        next = p.s + STEP;
        lo = urban ? 0.5 : 0.9; hi = urban ? SIDEWALK_W - 0.4 : 2.1;
        const mid = p.half + (lo + hi) / 2;
        const mx = p.x + p.rx * side * mid, mz = p.z + p.rz * side * mid;
        if (p.half > road.half + 0.5 || onOtherCarriageway(mx, mz, road, 1)) { flush(); continue; }
        pts.push(pt(p.x + p.rx * side * p.half, p.z + p.rz * side * p.half, p.rx * side, p.rz * side, lo, hi));
      }
      flush();
    }
  }
  // 4) الموقف: ناس رايحة جاية على طرف الموقف
  {
    const pts = [];
    for (let z = TERMINAL.z0 + 2; z <= TERMINAL.z1 - 2; z += STEP) pts.push(pt(TERMINAL.x1 - 1, z, -1, 0, 0.2, 2.6));
    add(pts, 0.2, 2.6, 2.2);
  }
  return lanes;
}

export class Crowd {
  constructor(scene, { count = 150 } = {}) {
    this.cap = Math.ceil(count * 1.7);
    this.R = rng(777);
    this.lanes = buildLanes();
    this._buildSpawnGrid();
    this._buildMeshes(scene);
    this.people = [];
    for (let i = 0; i < this.cap; i++) this.people.push({ on: false, variant: i % VARIANTS, phase: this.R() * 10, heading: 0, scared: 0 });
    this.setCount(count);
    this._first = true;
  }

  // نقط الظهور (كل 3م على كل حارة) في شبكة 24م عشان نلاقي الأماكن القريبة بسرعة
  _buildSpawnGrid() {
    this.cell = 24;
    this.grid = new Map();
    this.lanes.forEach((L, li) => {
      L.pts.forEach((p, i) => {
        if (this.R() > Math.min(1, L.weight)) return;
        const k = `${Math.floor(p.x / this.cell)},${Math.floor(p.z / this.cell)}`;
        let a = this.grid.get(k);
        if (!a) this.grid.set(k, (a = []));
        a.push(li, i * STEP);
        if (L.weight > 1 && this.R() < L.weight - 1) a.push(li, i * STEP); // الأماكن الزحمة: فرصة أكبر
      });
    });
  }

  _buildMeshes(scene) {
    this.group = new THREE.Group();
    this.group.name = 'crowd';
    scene.add(this.group);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, vertexColors: true });
    this.vars = [];
    for (let v = 0; v < VARIANTS; v++) {
      // الـ seeds الصغيرة بتدي أول أرقام متشابهة: نسخّن المولّد الأول عشان كل نسخة تطلع مختلفة (جلابية/حجاب/قميص)
      let p;
      for (let seed = v * 2654435761 + 97, k = 0; k < 40; k++, seed += 7919) {
        const R = rng(seed >>> 0); for (let w = 0; w < 8; w++) R();
        p = person(R);
        const want = ['galabeya', 'woman', 'casual'][v % 3];
        if (p.type === want) break;
      }
      const torsoGeo = p.root.children[0].geometry;
      const legMesh = p.legs[0].children[0], armMesh = p.arms[0].children[0];
      const mk = (geo, n, shadow) => {
        const m = new THREE.InstancedMesh(geo, mat, n);
        m.count = 0; m.frustumCulled = false; m.castShadow = shadow;
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.group.add(m);
        return m;
      };
      this.vars.push({
        scale: p.root.scale.x, legScale: legMesh.scale.x,
        torso: mk(torsoGeo, this.cap, true), legs: mk(legMesh.geometry, this.cap * 2, false), arms: mk(armMesh.geometry, this.cap * 2, false),
      });
    }
  }

  setCount(n) {
    this.count = Math.min(this.cap, Math.round(n));
    this.people.forEach((p, i) => { if (i >= this.count) p.on = false; });
  }

  setShadows(on) { for (const v of this.vars) v.torso.castShadow = on; }

  _lanePos(p) {
    const L = this.lanes[p.lane], f = Math.min(L.pts.length - 1.001, Math.max(0, p.s / STEP)), i = Math.floor(f), t = f - i;
    const a = L.pts[i], b = L.pts[i + 1];
    const lat = p.lat, u = (lat - L.lo) / ((L.hi - L.lo) || 1);
    const cx = a.x + (b.x - a.x) * t, cz = a.z + (b.z - a.z) * t;
    const nx = a.nx + (b.nx - a.nx) * t, nz = a.nz + (b.nz - a.nz) * t;
    p.x = cx + nx * lat; p.z = cz + nz * lat;
    const ya = a.yLo + (a.yHi - a.yLo) * u, yb = b.yLo + (b.yHi - b.yLo) * u;
    p.y = ya + (yb - ya) * t;
    p.dx = b.x - a.x; p.dz = b.z - a.z; p.nx = nx; p.nz = nz;
  }

  /** نحط واحد في مكان جديد حوالين الكاميرا (ويفضّل يبقى ورا أو بعيد عشان محدش يشوفه بيظهر) */
  _spawn(p, cx, cz, fx, fz, rMin, rMax) {
    const R = this.R;
    for (let tries = 0; tries < 10; tries++) {
      const ang = R() * Math.PI * 2, d = rMin + R() * (rMax - rMin);
      const x = cx + Math.cos(ang) * d, z = cz + Math.sin(ang) * d;
      if (!this._first && d < 85 && (Math.cos(ang) * fx + Math.sin(ang) * fz) > (d < 50 ? -0.35 : 0.1)) continue; // قدام الكاميرا وقريب: لا (القريب أوي بيظهر ورا بس)
      const a = this.grid.get(`${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`);
      if (!a) continue;
      const k = Math.floor(R() * (a.length / 2)) * 2;
      const L = this.lanes[a[k]];
      p.lane = a[k]; p.s = Math.min(L.len - 0.5, a[k + 1] + R() * STEP);
      p.lat = L.lo + R() * (L.hi - L.lo);
      p.standing = R() < 0.3;
      p.dir = R() < 0.5 ? 1 : -1;
      p.speed = p.standing ? 0 : 0.85 + R() * 0.7;
      p.look = R() * 2 - 1;
      p.on = true;
      this._lanePos(p);
      p.heading = this._targetYaw(p);
      // الواقفين ساعات بيبقوا اتنين بيتكلموا مع بعض
      return true;
    }
    return false;
  }

  _targetYaw(p) {
    if (p.standing) return Math.atan2(-p.nx, -p.nz) + p.look; // بص ناحية الشارع (تقريبًا)
    return Math.atan2(p.dx * p.dir, p.dz * p.dir);
  }

  _dodge(p, dt, ph) {
    const [fx, fz] = ph.forward;
    const dx = p.x - ph.x, dz = p.z - ph.z;
    const lon = dx * fx + dz * fz, lat = dx * -fz + dz * fx;
    const hw = ph.spec.halfWidth + 0.9, hl = ph.spec.halfLength + 0.6, v = ph.forwardSpeed;
    const ahead = v >= 0 ? lon > -hl && lon < hl + 1.5 + v * 1.4 : lon < hl && lon > -hl - 1.5 + v * 1.4;
    if (!ahead || Math.abs(lat) > hw || (Math.abs(v) < 0.2 && Math.abs(lon) > hl)) return;
    // اتجاه الهروب: بعيد عن خط العربية، متحوّل لاتجاه الرصيف
    const ax = -fz * Math.sign(lat || 1), az = fx * Math.sign(lat || 1);
    const L = this.lanes[p.lane];
    const along = ax * p.nx + az * p.nz;
    const nl = p.lat + Math.sign(along || 1) * 3.4 * dt;
    if (nl > L.lo && nl < L.hi && Math.abs(along) > 0.3) p.lat = nl;
    else p.s = Math.min(L.len - 0.5, Math.max(0.5, p.s + Math.sign((dx * p.dx + dz * p.dz) || 1) * 3.4 * dt));
    p.scared = 1.2;
    p.standing = false; p.speed ||= 1.2;
  }

  update(dt, cam, ph, camDir) {
    const cx = cam.x, cz = cam.z;
    const fl = Math.hypot(camDir.x, camDir.z) || 1, fx = camDir.x / fl, fz = camDir.z / fl;
    // التوزيع: كام واحد نضيفه/ننقله الفريم ده (عشان ما يحصلش تقطيع)
    let budget = this._first ? 1e9 : 6;
    for (let i = 0; i < this.count; i++) {
      const p = this.people[i];
      if (!p.on) {
        if (budget-- > 0) this._spawn(p, cx, cz, fx, fz, this._first ? 4 : SPAWN_MIN, SPAWN_MAX);
        continue;
      }
      const d2 = (p.x - cx) ** 2 + (p.z - cz) ** 2;
      if (d2 > RECYCLE * RECYCLE) { p.on = false; if (budget-- > 0) this._spawn(p, cx, cz, fx, fz, SPAWN_MIN, SPAWN_MAX); continue; }
      const L = this.lanes[p.lane];
      if (ph && d2 < 400 && Math.abs(p.x - ph.x) < 9 && Math.abs(p.z - ph.z) < 9) this._dodge(p, dt, ph);
      p.scared = Math.max(0, p.scared - dt);
      if (!p.standing) {
        p.s += p.dir * p.speed * (p.scared ? 1.6 : 1) * dt;
        if (p.s > L.len - 0.5) { p.s = L.len - 0.5; p.dir = -1; } else if (p.s < 0.5) { p.s = 0.5; p.dir = 1; }
      } else if (this.R() < dt * 0.02) { p.standing = false; p.speed = 0.9 + this.R() * 0.5; } // يمشي بعد شوية
      this._lanePos(p);
      const ty = this._targetYaw(p);
      p.heading += Math.atan2(Math.sin(ty - p.heading), Math.cos(ty - p.heading)) * Math.min(1, dt * 4);
      p.phase += dt * (p.scared ? 12 : p.standing ? 1 : p.speed * 4.2);
    }
    this._first = false;
    this._draw(cx, cz);
  }

  _draw(cx, cz) {
    for (const v of this.vars) v.n = 0;
    const m = _m, q = _q, e = _e;
    for (let i = 0; i < this.count; i++) {
      const p = this.people[i];
      if (!p.on || (p.x - cx) ** 2 + (p.z - cz) ** 2 > VIEW * VIEW) continue;
      const V = this.vars[p.variant], n = V.n++;
      const bob = p.standing ? 0 : Math.abs(Math.cos(p.phase)) * 0.03;
      _root.compose(_v.set(p.x, p.y + bob, p.z), q.setFromAxisAngle(_Y, p.heading), _s.setScalar(V.scale));
      V.torso.setMatrixAt(n, _root);
      const swing = p.standing && !p.scared ? 0 : Math.sin(p.phase) * (p.scared ? 0.7 : 0.45);
      for (let k = 0; k < 2; k++) {
        const sx = k ? 1 : -1;
        // رجل
        e.set(k ? -swing : swing, 0, 0);
        m.compose(_v.set(sx * 0.09, 0.9, 0), q.setFromEuler(e), _s.set(V.legScale, 1, V.legScale));
        V.legs.setMatrixAt(n * 2 + k, _t.multiplyMatrices(_root, m));
        // دراع
        const ax = p.standing && !p.scared ? (k ? Math.sin(p.phase * 0.7) * 0.12 : 0.05) : (k ? swing : -swing) * 0.8;
        e.set(ax, 0, sx * 0.08);
        m.compose(_v.set(sx * 0.2, 1.43, 0), q.setFromEuler(e), _s.set(1, 1, 1));
        V.arms.setMatrixAt(n * 2 + k, _t.multiplyMatrices(_root, m));
      }
    }
    for (const V of this.vars) {
      V.torso.count = V.n; V.legs.count = V.n * 2; V.arms.count = V.n * 2;
      V.torso.instanceMatrix.needsUpdate = V.legs.instanceMatrix.needsUpdate = V.arms.instanceMatrix.needsUpdate = true;
      V.torso.visible = V.legs.visible = V.arms.visible = V.n > 0;
    }
  }

  /** حد عشوائي قريب (عشان صوته يطلع من مكانه) */
  randomNear(x, z, r = 40) {
    for (let k = 0; k < 12; k++) {
      const p = this.people[Math.floor(this.R() * this.count)];
      if (p && p.on && (p.x - x) ** 2 + (p.z - z) ** 2 < r * r) return p;
    }
    return null;
  }

  /** كام واحد قريب (للأصوات) */
  nearby(x, z, r = 40) {
    let n = 0;
    for (let i = 0; i < this.count; i++) { const p = this.people[i]; if (p.on && (p.x - x) ** 2 + (p.z - z) ** 2 < r * r) n++; }
    return n;
  }
}

const _m = new THREE.Matrix4(), _t = new THREE.Matrix4(), _root = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
const _Y = new THREE.Vector3(0, 1, 0);
