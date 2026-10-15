import * as THREE from 'three';
import { Buckets } from '../render/GeoBuilder.js';
import { ROAD, CROSSINGS, mainSegments } from '../world/layout.js';
import { ROUTE, nearestRoute } from '../world/Route.js';
import { inCity } from '../world/ground.js';
import { ROADS, nearestSide } from '../world/RoadNetwork.js';
import { rng } from '../render/textures.js';
import { CAR_COLORS } from '../vehicles/CarModels.js';

// =====================================================================
//  المرور (خفيف للموبايل):
//  - مسار دائري واحد = شارع المدينة + الطريق الكبير، 4 حارات (2 رايح و2 جاي)
//  - العربيات بتلف على المسار على طول (Pooling: مفيش إنشاء/حذف أثناء اللعب)
//  - IDM: مسافة أمان، بتهدّي في المنحنيات وحسب المنطقة، وبتقف في الأحمر
//  - بتتجنب الميكروباص بتاعك وبتضرب كلاكس لو سديت الطريق
// =====================================================================

const TYPES = ['sedan', 'boxy', 'taxi', 'microbus', 'sedan', 'taxi', 'boxy', 'microbus'];
const STEP = 2;
const CITY_LEN = ROAD.zMax - ROAD.zMin; // 450

const ZONE_SPEED = { city: 13, residential: 14, roundabout: 11, bridge: 17, agri: 17, village: 10, desert: 24, mountain: 14, tunnel: 17, highway: 22 };

/** المسار الكامل المقفول (المدينة من الشمال للجنوب + الطريق الدائري) */
export const LOOP = (() => {
  const S = [];
  for (let s = 0; s < CITY_LEN; s += STEP) S.push({ x: 0, y: 0, z: ROAD.zMax - s, dx: 0, dz: -1, rx: 1, rz: 0, curv: 0, grade: 0, zone: 'city' });
  for (const p of ROUTE.samples) S.push({ x: p.x, y: p.y, z: p.z, dx: p.dx, dz: p.dz, rx: p.rx, rz: p.rz, curv: p.curv, grade: p.grade, zone: p.zone });
  return { samples: S, length: S.length * STEP };
})();

export function loopAt(s, out = {}) {
  const S = LOOP.samples, n = S.length;
  s = ((s % LOOP.length) + LOOP.length) % LOOP.length;
  const f = s / STEP, i = Math.floor(f), t = f - i;
  const a = S[i % n], b = S[(i + 1) % n];
  out.x = a.x + (b.x - a.x) * t; out.y = a.y + (b.y - a.y) * t; out.z = a.z + (b.z - a.z) * t;
  out.dx = a.dx; out.dz = a.dz; out.rx = a.rx; out.rz = a.rz; out.curv = a.curv; out.grade = a.grade; out.zone = a.zone;
  return out;
}
const _la = {}, _lb = {};

/** إسقاط أي نقطة على المسار → { s, d } */
export function loopProject(x, z) {
  if (inCity(x, z) && Math.abs(x) < ROAD.curb + 1) return { s: ROAD.zMax - z, d: x };
  const r = nearestRoute(x, z);
  if (!r) return null;
  return { s: CITY_LEN + r.s, d: r.d };
}

const _lowCache = new Map();
function lowWheelPart(geo, role) {
  if (_lowCache.has(geo)) return _lowCache.get(geo);
  if (!geo.boundingBox) geo.computeBoundingBox();
  const bb = geo.boundingBox, r = bb.max.y, w = bb.max.x - bb.min.x, cx = (bb.max.x + bb.min.x) / 2;
  const g = role === 'tire'
    ? new THREE.CylinderGeometry(r, r, w * 0.92, 12, 1, true).rotateZ(Math.PI / 2).translate(cx, 0, 0)
    : new THREE.CylinderGeometry(r * 0.98, r * 0.98, w * 0.5, 10).rotateZ(Math.PI / 2).translate(cx, 0, 0);
  _lowCache.set(geo, g);
  return g;
}

export class TrafficSystem {
  constructor(scene, lights, makeCar, audio, opts = {}) {
    this.scene = scene;
    this.lights = lights;
    this.makeCar = makeCar;
    this.audio = audio;
    this.R = rng(99);
    this.cars = [];
    this.perLane = opts.perLane || 8;
    this.lanes = this._buildLanes(opts);
    this._spawn();
    this._spawnParked();
    this._finishBake();
  }

  _buildLanes(opts = {}) {
    const L = LOOP.length;
    const sig = CROSSINGS.find((c) => c.signal);
    const lanes = [];
    for (const [off, dir] of [[ROAD.lanes[0], 1], [ROAD.lanes[1], 1], [-ROAD.lanes[0], -1], [-ROAD.lanes[1], -1]]) {
      const stopS = sig ? (dir > 0 ? ROAD.zMax - (sig.z + sig.half + 4.6) : ROAD.zMax - (sig.z - sig.half - 4.6)) : null;
      lanes.push({
        kind: 'loop', off, dir, length: L, loop: true, group: 'main', cars: [],
        stop: stopS == null ? null : dir > 0 ? stopS : L - stopS,
        pos: (p, out) => {
          const s = dir > 0 ? p : L - p;
          const q = loopAt(s, _la);
          out.x = q.x + q.rx * off; out.z = q.z + q.rz * off; out.y = q.y;
          out.yaw = dir > 0 ? Math.atan2(-q.dx, -q.dz) : Math.atan2(q.dx, q.dz);
          out.pitch = q.grade * dir; out.curv = q.curv; out.zone = q.zone;
          return out;
        },
        pFromS: (s) => (dir > 0 ? s : L - s),
      });
    }
    // الشارع الجانبي عند الإشارة (خط مستقيم)
    if (sig) {
      const Lc = sig.xMax - sig.xMin - 4;
      for (const [ox, oz, dx, stop] of [[sig.xMin + 2, sig.z + 3.2, 1, -(ROAD.curb + 4.4) - (sig.xMin + 2)], [sig.xMax - 2, sig.z - 3.2, -1, (sig.xMax - 2) - (ROAD.curb + 4.4)]]) {
        lanes.push({
          kind: 'line', length: Lc, loop: false, group: 'cross', cars: [], stop,
          pos: (p, out) => { out.x = ox + dx * p; out.z = oz; out.y = 0; out.yaw = Math.atan2(-dx, 0); out.pitch = 0; out.curv = 0; out.zone = 'city'; return out; },
          ox, oz, dx, dz: 0,
        });
      }
    }
    // الطرق الفرعية وشوارع شبين الكوم: حارة رايحة وحارة جاية على كل طريق
    for (const road of ROADS) {
      if (road.surface === 'dirt' || road.length < 120) continue;
      const S = road.samples, L = road.length, off = road.half * 0.48;
      const zone = road.style === 'urban' || road.style === 'city' ? 'city' : road.style === 'highway' ? 'highway' : 'agri';
      const at = (s, out) => {
        let lo = 0, hi = S.length - 1;
        while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m].s <= s) lo = m; else hi = m; }
        const a = S[lo], b = S[hi], t = Math.min(1, Math.max(0, (s - a.s) / ((b.s - a.s) || 1)));
        out.x = a.x + (b.x - a.x) * t; out.z = a.z + (b.z - a.z) * t; out.y = a.y + (b.y - a.y) * t;
        out.dx = a.dx; out.dz = a.dz; out.rx = a.rx; out.rz = a.rz;
        return out;
      };
      for (const dir of [1, -1]) {
        const o = off * dir;
        lanes.push({
          kind: 'road', road, dir, off: o, length: L, loop: false, group: 'side', cars: [], stop: null, zone,
          density: (road.style === 'urban' ? 38 : road.style === 'city' ? 55 : 95) * (opts.sideMul || 1), // متر لكل عربية
          pos: (p, out) => {
            const q = at(dir > 0 ? p : L - p, _la);
            out.x = q.x + q.rx * o; out.z = q.z + q.rz * o; out.y = q.y + 0.03;
            out.yaw = dir > 0 ? Math.atan2(-q.dx, -q.dz) : Math.atan2(q.dx, q.dz);
            out.pitch = 0; out.curv = 0; out.zone = zone;
            return out;
          },
          endsFar: (px, pz) => {
            const a = S[0], b = S[S.length - 1];
            return Math.hypot(px - a.x, pz - a.z) > 70 && Math.hypot(px - b.x, pz - b.z) > 70;
          },
        });
      }
    }
    return lanes;
  }

  _newCar(lane, p) {
    const R = this.R;
    const type = TYPES[Math.floor(R() * TYPES.length)];
    const rig = this.makeCar(type, CAR_COLORS[Math.floor(R() * CAR_COLORS.length)]);
    this.scene.add(rig.root);
    const car = {
      rig, lane, p, type,
      v: 8 + R() * 4,
      vMul: (type === 'microbus' ? 1.12 : 1) * (0.85 + R() * 0.3), // اختلاف السواقين
      len: rig.length || 4.4, width: rig.width || 1.8,
      aMax: 1.2 + R() * 0.7, b: 2.8, T: 1.1 + R() * 0.6, s0: 2 + R() * 1.2,
      bumped: 0, waitBehindPlayer: 0, honkCooldown: 3 + R() * 6, decidedGo: false,
      acc: 0, spin: 0, mass: type === 'microbus' ? 2400 : 1250,
      x: 0, y: 0, z: 0, yaw: 0, pitch: 0, curv: 0, zone: 'city', visible: true,
    };
    lane.cars.push(car);
    this.cars.push(car);
    this._place(car);
    return car;
  }

  _spawn() {
    const R = this.R;
    for (const lane of this.lanes) {
      if (lane.kind === 'loop') {
        const n = this.perLane;
        for (let i = 0; i < n; i++) this._newCar(lane, ((i + R() * 0.6) / n) * lane.length);
      } else if (lane.kind === 'road') {
        const n = Math.max(1, Math.floor(lane.length / lane.density));
        for (let i = 0; i < n; i++) this._newCar(lane, ((i + 0.15 + R() * 0.5) / n) * (lane.length - 20));
      } else {
        let p = 10 + R() * 20;
        for (let i = 0; i < 3 && p < lane.length - 10; i++) { this._newCar(lane, p); p += 30 + R() * 40; }
      }
    }
  }

  _spawnParked() {
    const R = rng(1234);
    this.parked = [];
    for (const sx of [-1, 1]) {
      for (const [zs, ze] of mainSegments(9)) {
        for (let z = zs - 3; z > ze + 3; z -= 5.6 + R() * 4) {
          if (R() < 0.35) { z -= 3; continue; }
          const type = ['sedan', 'boxy', 'taxi', 'sedan', 'boxy', 'microbus'][Math.floor(R() * 6)];
          const rig = this.makeCar(type, CAR_COLORS[Math.floor(R() * CAR_COLORS.length)], { parked: true });
          const len = rig.length || 4.4;
          z -= len / 2;
          const x = sx * (ROAD.parkCenter + (R() - 0.5) * 0.3);
          const yaw = (sx > 0 ? 0 : Math.PI) + (R() - 0.5) * 0.06;
          rig.root.position.set(x, 0, z);
          rig.root.rotation.y = yaw;
          rig.root.updateMatrixWorld(true);
          this._bake(rig);
          this.parked.push({ cx: x, cz: z, hx: (rig.width || 1.8) / 2, hz: len / 2, angle: yaw, restitution: 0.1, mass: 3000, kind: 'parked' });
          z -= len / 2;
        }
      }
    }
  }

  /** دمج العربيات المركونة في عدد قليل من الـ Meshes */
  _bake(rig) {
    if (!this._parkB) { this._parkB = new Buckets(); this._parkMats = {}; }
    rig.root.traverse((o) => {
      if (!o.isMesh || o.userData.role === 'driver') return; // العربيات المركونة من غير سواق
      const role = o.userData.role || `m_${o.material.uuid}`;
      if (!this._parkMats[role]) {
        let m = o.material;
        if (role === 'paint') { m = o.material.clone(); m.vertexColors = true; m.color.set(0xffffff); }
        this._parkMats[role] = m;
      }
      const b = this._parkB.get(role);
      const c = role === 'paint' ? o.material.color : null;
      b.setColor(c ? [c.r, c.g, c.b] : [1, 1, 1]);
      // العربيات المركونة مش بتتحرك: عجل بسيط (أخف بكتير على الموبايل)
      b.addGeometry(role === 'tire' || role === 'rim' ? lowWheelPart(o.geometry, role) : o.geometry, o.matrixWorld);
    });
  }

  _finishBake() {
    if (!this._parkB) return;
    const g = new THREE.Group();
    g.name = 'parked-cars';
    this._parkB.toMeshes(this._parkMats, g);
    g.traverse((o) => {
      if (!o.isMesh) return;
      if (['glass', 'windshield', 'shadow', 'decal', 'curtain', 'shade'].includes(o.name)) o.castShadow = false;
      if (o.name === 'shadow') o.renderOrder = 1;
    });
    this.scene.add(g);
    this._parkB = null;
  }

  _place(car) {
    car.lane.pos(car.p, car);
    if (car.knocked) { car.x += car.kox || 0; car.z += car.koz || 0; car.yaw += car.kyaw || 0; }
  }

  /** العربية اللي اتخبطت: بتتزحلق وتلف لحد ما الاحتكاك يوقفها، وبعدين السواق يرجع حارته بالراحة */
  _knock(car, dt) {
    const sp = Math.hypot(car.kvx || 0, car.kvz || 0);
    if (sp > 0) {
      const dec = Math.min(sp, 7.5 * dt); // احتكاك الكاوتش وهو بيتزحلق (~0.75g)
      car.kvx -= (car.kvx / sp) * dec; car.kvz -= (car.kvz / sp) * dec;
      car.kox = (car.kox || 0) + car.kvx * dt; car.koz = (car.koz || 0) + car.kvz * dt;
    }
    if (car.kw) { car.kyaw = (car.kyaw || 0) + car.kw * dt; car.kw *= Math.exp(-dt * 3.2); if (Math.abs(car.kw) < 0.01) car.kw = 0; }
    if (car.bumped <= 0 && sp < 0.05 && !car.kw) {
      // رجوع للحارة وهو ماشي (مش فجأة)
      const k = 1 - Math.exp(-dt * (0.25 + car.v * 0.12));
      car.kox -= (car.kox || 0) * k; car.koz -= (car.koz || 0) * k;
      let y = car.kyaw || 0; y = Math.atan2(Math.sin(y), Math.cos(y)); car.kyaw = y - y * k;
      if (Math.abs(car.kox) + Math.abs(car.koz) < 0.05 && Math.abs(car.kyaw) < 0.01) { car.knocked = false; car.kox = car.koz = car.kyaw = car.kvx = car.kvz = 0; }
    }
  }

  /** صناديق تصادم العربيات القريبة (للفيزياء).
   *  كل عربية ليها صندوق واحد ثابت بنحدّثه مكانه (الفيزيا بتسأل كذا مرة كل خطوة → من غير objects/closures جديدة = مفيش GC) */
  _collider(c) {
    let col = c._col;
    if (!col) {
      col = c._col = {
        cx: 0, cz: 0, hx: c.width / 2, hz: c.len / 2, angle: 0, mass: c.mass, restitution: 0.15, vx: 0, vz: 0, kind: 'car', car: c,
        // الخبطة بتزق العربية وتلفها على حسب قوتها ومكانها (كمية الحركة)، والسواق بيقف شوية
        onHit: (dv, jx = 0, jz = 0, px = c.x, pz = c.z) => {
          const fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw);
          // سرعة العربية في اتجاه حارتها بتتحول لسرعة حرة عشان تكمل في نفس اتجاهها بعد الخبطة
          if (!c.knocked) { c.kvx = (c.kvx || 0) + fx * c.v; c.kvz = (c.kvz || 0) + fz * c.v; c.v = 0; }
          c.knocked = true;
          c.kvx += jx / c.mass; c.kvz += jz / c.mass;
          const I = c.mass * (c.len * c.len + c.width * c.width) / 12;
          c.kw = (c.kw || 0) + ((px - c.x) * jz - (pz - c.z) * jx) / I * -1;
          c.bumped = Math.max(c.bumped, 2.5 + Math.min(3, dv)); c.v = 0;
          c.honkCooldown = Math.min(c.honkCooldown, 0.4);
        },
        onPush: (dx, dz) => { c.kox = (c.kox || 0) + dx; c.koz = (c.koz || 0) + dz; c.knocked = true; },
      };
    }
    const fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw);
    col.cx = c.x; col.cz = c.z; col.angle = c.yaw;
    col.vx = fx * c.v + (c.kvx || 0); col.vz = fz * c.v + (c.kvz || 0);
    return col;
  }

  colliders(box, out) {
    const r = Math.hypot(box.hx, box.hz) + 4;
    for (const c of this.cars) {
      if (c.off) continue;
      if (Math.abs(c.x - box.cx) > r || Math.abs(c.z - box.cz) > r || Math.abs(c.y - (this._py || 0)) > 3) continue;
      out.push(this._collider(c));
    }
    for (const p of this.parked) {
      if (Math.abs(p.cx - box.cx) > r || Math.abs(p.cz - box.cz) > r) continue;
      out.push(p);
    }
  }

  update(dt, player, camPos) {
    const pl = player.physics;
    this._py = pl.heave;
    const pBox = pl.getBox();
    const proj = loopProject(pBox.cx, pBox.cz);
    const pv = { x: pl.vx, z: pl.vz };
    for (const lane of this.lanes) {
      const L = lane.length;
      lane.cars.sort((a, b) => b.p - a.p);
      const signal = lane.stop != null ? this.lights.state(lane.group) : 'green';
      // الميكروباص بتاعك في الحارة دي؟
      let playerP = null, playerV = 0;
      if (lane.kind === 'loop' && proj && Math.abs(proj.d - lane.off) < 2.6) {
        playerP = lane.pFromS(proj.s);
        const q = loopAt(proj.s, _lb);
        playerV = (pv.x * q.dx + pv.z * q.dz) * lane.dir;
      } else if (lane.kind === 'road') {
        const ns = nearestSide(pBox.cx, pBox.cz);
        if (ns && ns.road === lane.road && Math.abs(ns.d - lane.off) < 2.4) {
          playerP = lane.dir > 0 ? ns.s : lane.length - ns.s;
          const q = ns.road.samples[ns.i];
          playerV = (pv.x * q.dx + pv.z * q.dz) * lane.dir;
        }
      } else if (lane.kind === 'line') {
        const relX = pBox.cx - lane.ox, relZ = pBox.cz - lane.oz;
        if (Math.abs(relZ) < 2.6 && Math.abs(pBox.cx) > ROAD.curb - 2) { playerP = relX * lane.dx; playerV = pv.x * lane.dx; }
      }
      const n = lane.cars.length;
      for (let i = 0; i < n; i++) {
        const car = lane.cars[i];
        let gap = 1e9, vLead = 30;
        if (n > 1 && (i > 0 || lane.loop)) {
          const lead = lane.cars[i > 0 ? i - 1 : n - 1];
          let dp = lead.p - car.p;
          if (dp <= 0) dp += L;
          if (lead !== car) { gap = dp - (lead.len + car.len) / 2; vLead = lead.v; }
        }
        let playerAhead = false;
        if (playerP != null) {
          let dp = playerP - car.p;
          if (lane.loop && dp < -L / 2) dp += L;
          if (dp > 0 && dp < 150) {
            const g = dp - car.len / 2 - pBox.hz;
            if (g < gap) { gap = g; vLead = Math.max(0, playerV); playerAhead = true; }
          }
        }
        // الإشارة
        if (lane.stop != null) {
          const dStop = lane.stop - (car.p + car.len / 2);
          if (signal === 'green') car.decidedGo = false;
          let mustStop = signal === 'red';
          if (signal === 'yellow') {
            if (!car.decidedGo && (dStop < (car.v * car.v) / 6 * 0.7 || dStop < 1)) car.decidedGo = true;
            mustStop = !car.decidedGo;
          }
          if (mustStop && dStop > -0.5 && dStop < 80) {
            const g = dStop + car.s0 - 0.6;
            if (g < gap) { gap = g; vLead = 0; }
          }
        }
        // السرعة المسموحة: المنطقة + المنحنى اللي جاي
        let v0 = (ZONE_SPEED[car.zone] || 14) * car.vMul;
        if (lane.kind === 'loop') {
          const ahead = loopAt(lane.dir > 0 ? car.p + 12 + car.v * 2 : L - (car.p + 12 + car.v * 2), _lb);
          const k = Math.abs(ahead.curv);
          if (k > 1e-4) v0 = Math.min(v0, Math.sqrt(2.6 / k));
          v0 = Math.min(v0, (ZONE_SPEED[ahead.zone] || 14) * car.vMul + 2);
        }
        // IDM
        const v = car.v;
        const sStar = car.s0 + Math.max(0, v * car.T + (v * (v - vLead)) / (2 * Math.sqrt(car.aMax * car.b)));
        let a = car.aMax * (1 - Math.pow(v / v0, 4) - Math.pow(sStar / Math.max(gap, 0.1), 2));
        a = Math.max(-9, Math.min(car.aMax, a));
        if (car.bumped > 0) { car.bumped -= dt; a = -9; }
        car.acc += (a - car.acc) * Math.min(1, dt * 6);
        car.v = Math.max(0, car.v + a * dt);
        if (gap < 0.3 && vLead < car.v) car.v = Math.max(0, vLead);
        if (car.knocked) { this._knock(car, dt); if (car.bumped > 0 || Math.hypot(car.kvx, car.kvz) > 0.05) { car.v = 0; a = -9; } }
        car.p += car.v * dt;

        // كلاكس
        car.honkCooldown -= dt;
        if (playerAhead && car.v < 1 && gap < 10 && signal !== 'red') car.waitBehindPlayer += dt; else car.waitBehindPlayer = Math.max(0, car.waitBehindPlayer - dt);
        if ((car.waitBehindPlayer > 2.5 || car.bumped > 0) && car.honkCooldown <= 0 && this.audio && car.visible) {
          this.audio.honk(car.x, car.y + 1.2, car.z, car.type === 'microbus' ? 1.2 : 1);
          car.honkCooldown = 2 + this.R() * 4;
        }

        if (lane.loop) {
          if (car.p >= L) car.p -= L;
        } else if (car.p > L) {
          // الشارع الجانبي: نرجّعها للبداية لو محدش شايف
          const far = (x) => Math.hypot(pl.x - (lane.ox + lane.dx * x), pl.z - lane.oz) > 45;
          const last = lane.cars[lane.cars.length - 1];
          const ok = lane.endsFar ? lane.endsFar(pl.x, pl.z) : far(0) && far(L);
          if (ok && (!last || last === car || last.p > 14)) { car.p = 0; car.v = 6; }
          else { car.p = L; car.v = 0; }
        }
        this._place(car);
      }
    }
    // المرئيات (العربيات البعيدة بتتخفى = أداء)
    const cx = camPos ? camPos.x : pl.x, cz = camPos ? camPos.z : pl.z;
    const far2 = (this.viewDist || 320) ** 2;
    for (const car of this.cars) {
      if (car.off) continue;
      const r = car.rig;
      // شوارع شبين محاطة بعمارات: العربيات اللي فيها بتختفي بدري (أداء)
      const vis = (car.x - cx) ** 2 + (car.z - cz) ** 2 < (car.lane.kind === 'road' ? Math.min(far2, 140 * 140) : far2);
      car.visible = vis;
      r.root.visible = vis;
      if (!vis) continue;
      // LOD: العربيات البعيدة من غير عجل ولا ضل
      const d2 = (car.x - cx) ** 2 + (car.z - cz) ** 2;
      const near = d2 < 80 * 80, shadow = d2 < 45 * 45;
      if (near !== car._near) { car._near = near; for (const w of r.wheels) w.group.visible = near; r.root.traverse((o) => { if (o.userData.role && ['chrome', 'plate', 'decal', 'curtain', 'mirrorDark', 'fog', 'tail', 'lamp', 'shadow', 'driver'].includes(o.userData.role)) o.visible = near; }); }
      if (shadow !== car._shadow) { car._shadow = shadow; r.root.traverse((o) => { if (o.isMesh && o.userData.role !== 'glass' && o.userData.role !== 'shadow') o.castShadow = shadow; }); }
      r.root.position.set(car.x, car.y, car.z);
      r.root.rotation.set(0, car.yaw, 0);
      car.spin += (car.v / (r.wheelRadius || 0.3)) * dt;
      for (const w of r.wheels) w.spin.rotation.x = -car.spin;
      if (r.body) r.body.rotation.x = car.acc * 0.006 + Math.atan(car.pitch || 0);
      const braking = car.acc < -0.6 || car.v < 0.3;
      if (r.brake) r.brake.emissiveIntensity = braking ? 3.5 : this.night ? 1.0 : 0.15;
    }
  }

  /** زحمة المرور: k من 0 (فاضي) لـ 1 (كل العربيات). العربيات الزيادة بتتشال من الحارة */
  setDensity(k) {
    for (const lane of this.lanes) {
      const all = (lane.all ||= [...lane.cars]);
      // بنختار عربيات متوزعة على طول الحارة (مش كلهم في حتة واحدة)
      lane.cars = all.filter((c, i) => Math.floor((i + 1) * k + 1e-6) > Math.floor(i * k + 1e-6));
      for (const c of all) {
        c.off = !lane.cars.includes(c);
        if (c.off) { c.visible = false; c.rig.root.visible = false; }
      }
    }
  }

  setNight(on) {
    this.night = on;
    for (const c of this.cars) if (c.rig.mats?.headlight) c.rig.mats.headlight.emissiveIntensity = on ? 2.5 : 0.05;
    for (const c of this.cars) if (c.rig.lights?.head) c.rig.lights.head.emissiveIntensity = on ? 2.2 : 0;
  }

  /** أقرب العربيات (للصوت) */
  nearest(x, z, n) {
    const arr = this._near || (this._near = []);
    arr.length = 0;
    for (const c of this.cars) if (c.visible) arr.push(c);
    arr.sort((a, b) => (a.x - x) ** 2 + (a.z - z) ** 2 - ((b.x - x) ** 2 + (b.z - z) ** 2));
    return arr.slice(0, n);
  }
}
