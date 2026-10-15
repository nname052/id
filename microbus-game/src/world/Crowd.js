import * as THREE from 'three';
import { rng } from '../render/textures.js';
import { HumanBatch, humanVariants } from './Humans.js';
import { ROAD, CROSSINGS, mainSegments } from './layout.js';
import { ROADS, SIDEWALK_W, onOtherCarriageway } from './RoadNetwork.js';
import { ROUTE, URBAN_ZONES, nearJunction } from './Route.js';
import { groundHeight } from './ground.js';
import { TERMINAL } from './Shibin.js';
import { toFloat } from '../vehicles/ModelFit.js';

// الزحمة: ناس كتير ماشيين وواقفين على كل الأرصفة (وسط البلد، شبين الكوم، الموقف، والقرى).
// - "حارات مشي" جاهزة على كل رصيف (خط + عرض الرصيف)
// - عدد ثابت من الناس بيعيشوا حوالين الكاميرا: اللي يبعد أوي بيتنقل لرصيف تاني قريب (Pooling)
// - الرسم بـ InstancedMesh: كل الناس في ~45 draw call بس مهما كان العدد

const VARIANTS = 15;
const STEP = 3; // متر بين نقط الحارة
const VIEW = 75, RECYCLE = 125, SPAWN_MIN = 14, SPAWN_MAX = 115;

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
    const flush = () => { if (kind) add(pts, kind === 'urban' ? 10.5 : 12.2, kind === 'urban' ? 14.9 : 13.8, kind === 'urban' ? 0.8 : 0.45); pts = []; kind = null; };
    let next = 0;
    for (const p of ROUTE.samples) {
      if (p.s < next) continue;
      next = p.s + STEP;
      const k = URBAN_ZONES.has(p.zone) ? 'urban' : p.zone === 'village' ? 'village' : null;
      if (!k || nearJunction(p.s, side, 4) || (kind && k !== kind)) { flush(); if (!k || nearJunction(p.s, side, 4)) continue; }
      kind = k;
      // القرية: الأسفلت لحد 11.5م → الناس ماشية على الجنب بعده
      const lo = k === 'urban' ? 10.5 : 12.2, hi = k === 'urban' ? 14.9 : 13.8;
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
    // الموقف زحمة: تحت المظلة، وبين الدكك، وعلى طول السور القبلي والبحري (مكان الناس اللي مستنية العربيات)
    for (let z = TERMINAL.z0 + 2; z <= TERMINAL.z1 - 2; z += STEP) pts.push(pt(TERMINAL.x1 - 1, z, -1, 0, 0.2, 2.6));
    add(pts, 0.2, 2.6, 3);
    const p2 = [];
    for (let z = TERMINAL.z0 + 2; z <= TERMINAL.z1 - 2; z += STEP) p2.push(pt(TERMINAL.x1 - 8.2, z, 1, 0, 0.2, 2.2));
    add(p2, 0.2, 2.2, 3);
    for (const [zz, nz] of [[TERMINAL.z0 + 0.4, 1], [TERMINAL.z1 - 0.4, -1]]) {
      const p3 = [];
      for (let x = TERMINAL.x1 - 2; x >= TERMINAL.x0 + 8; x -= STEP) p3.push(pt(x, zz, 0, nz, 0.3, 1.8));
      add(p3, 0.3, 1.8, 2.4);
    }
  }
  return lanes;
}

export class Crowd {
  constructor(scene, { count = 150, assets = null } = {}) {
    this.assets = assets;
    this.cap = Math.ceil(count * 1.7);
    this.R = rng(777);
    this.lanes = buildLanes();
    this._buildSpawnGrid();
    this._buildMeshes(scene);
    this._buildScan();
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
    // كل شكل (variant) = InstancedMesh واحدة، والمشي بيتحسب في الـ shader (draw call واحد لكل شكل)
    this.batch = new HumanBatch(this.group, humanVariants(VARIANTS, 777, true), this.cap);
  }

  setCount(n) {
    this.count = Math.min(this.cap, Math.round(n));
    this.people.forEach((p, i) => { if (i >= this.count) p.on = false; });
  }

  /** الشخص الحقيقي (سكان): نسخة واحدة InstancedMesh للناس الواقفة */
  _buildScan() {
    const a = this.assets?.get('person_scan');
    if (!a) return;
    const h = a.holder; h.updateMatrixWorld(true);
    let src = null; h.traverse((o) => { if (o.isMesh && !src) src = o; });
    if (!src) return;
    const geo = toFloat(src.geometry).applyMatrix4(src.matrixWorld);
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ map: src.material.map, roughness: 0.9 });
    const m = new THREE.InstancedMesh(geo, mat, this.cap);
    m.count = 0; m.frustumCulled = false; m.castShadow = true;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.group.add(m);
    this.scan = m;
  }

  setShadows(on) { this.batch.setShadows(on); }

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
      p.scan = !!this.scan && p.standing && R() < 0.45; // جزء من الواقفين ناس حقيقية (سكان)
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
    if (!p.scan) { p.standing = false; p.speed ||= 1.2; }
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
      } else if (!p.scan && this.R() < dt * 0.02) { p.standing = false; p.speed = 0.9 + this.R() * 0.5; } // يمشي بعد شوية
      this._lanePos(p);
      const ty = this._targetYaw(p);
      p.heading += Math.atan2(Math.sin(ty - p.heading), Math.cos(ty - p.heading)) * Math.min(1, dt * 4);
      p.phase += dt * (p.scared ? 12 : p.standing ? 1 : p.speed * 4.2);
    }
    this._first = false;
    this._draw(cx, cz);
  }

  _draw(cx, cz) {
    this.batch.begin();
    let nScan = 0;
    for (let i = 0; i < this.count; i++) {
      const p = this.people[i];
      if (!p.on || (p.x - cx) ** 2 + (p.z - cz) ** 2 > VIEW * VIEW) continue;
      if (p.scan) {
        _root.compose(_v.set(p.x, p.y, p.z), _q.setFromAxisAngle(_Y, p.heading), _s.setScalar(0.94 + (p.variant % 5) * 0.03));
        this.scan.setMatrixAt(nScan++, _root);
        continue;
      }
      // الواقفين: إيد بتتحرك وهما بيتكلموا (ساعات)
      const talk = p.standing && !p.scared && (p.variant + i) % 4 === 0 ? 0.18 + Math.sin(p.phase * 0.7) * 0.08 : 0;
      const amp = p.standing && !p.scared ? 0 : p.scared ? 1.5 : Math.min(1.2, p.speed * 0.8);
      this.batch.add(p.variant, p.x, p.y, p.z, p.heading, 1, p.phase, amp, talk, 0);
    }
    if (this.scan) { this.scan.count = nScan; this.scan.instanceMatrix.needsUpdate = true; this.scan.visible = nScan > 0; }
    this.batch.flush();
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

const _root = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
const _Y = new THREE.Vector3(0, 1, 0);
