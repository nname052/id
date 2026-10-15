// =====================================================================
//  المشاة في شبين الحقيقية: ماشيين على الأرصفة الحقيقية بس (كل خطوة بنتأكد إن المكان رصيف مش أسفلت)،
//  وبيلفوا قبل التقاطع (مبيدخلوش الشارع التاني). نفس واجهة Crowd القديمة عشان الصوت والركاب.
// =====================================================================
import { HumanBatch, humanVariants } from '../Humans.js';
import { edgePoint, edgesNear } from './ShibinData.js';
import { SIDEWALK } from './ShibinWorld.js';
import * as THREE from 'three';

const VARIANTS = 12, VIEW = 80, RECYCLE = 130, SPAWN_MIN = 14, SPAWN_MAX = 115;
const _p = {};

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

export class ShibinCrowd {
  constructor(scene, world, { count = 120 } = {}) {
    this.world = world; this.graph = world.graph;
    this.cap = Math.ceil(count * 1.7);
    this.R = rng(777);
    this.group = new THREE.Group(); this.group.name = 'crowd';
    scene.add(this.group);
    this.batch = new HumanBatch(this.group, humanVariants(VARIANTS, 777, true), this.cap);
    this.people = [];
    for (let i = 0; i < this.cap; i++) this.people.push({ on: false, variant: i % VARIANTS, phase: this.R() * 10, heading: 0, scared: 0 });
    this.setCount(count);
    this._trim = new Map();
  }

  setCount(n) { this.count = Math.min(this.cap, Math.round(n)); this.people.forEach((p, i) => { if (i >= this.count) p.on = false; }); }
  setShadows(on) { this.batch.setShadows(on); }

  /** المسافة اللي لازم نسيبها قبل كل طرف (عرض الشارع اللي بيقطع + رصيفه) */
  _trimAt(e, node) {
    let t = 1.0;
    for (const f of node.edges) if (f !== e) t = Math.max(t, f.half + (SIDEWALK[f.cls.replace('_link', '')] || 0) + 0.6);
    return node.edges.length > 1 ? t : 0.5;
  }

  _range(e) {
    let r = this._trim.get(e);
    if (!r) { r = [this._trimAt(e, e.from), e.length - this._trimAt(e, e.to)]; this._trim.set(e, r); }
    return r;
  }

  _pos(p) {
    edgePoint(p.e, p.s, _p);
    const nx = -_p.dz * p.side, nz = _p.dx * p.side;
    p.x = _p.x + nx * p.lat; p.z = _p.z + nz * p.lat;
    p.dx = _p.dx; p.dz = _p.dz; p.nx = nx; p.nz = nz;
  }

  _ok(x, z) { return Math.abs(this.world.height(x, z, 0) - 0.15) < 0.01; }

  _spawn(p, cx, cz, fx, fz, rMin, rMax) {
    for (let tries = 0; tries < 8; tries++) {
      const ang = this.R() * Math.PI * 2, d = rMin + this.R() * (rMax - rMin);
      if (d < 80 && Math.cos(ang) * fx + Math.sin(ang) * fz > (d < 45 ? -0.35 : 0.1)) continue;
      const x = cx + Math.cos(ang) * d, z = cz + Math.sin(ang) * d;
      const near = edgesNear(this.graph, x, z, 25, this._near || (this._near = []));
      if (!near.length) continue;
      const e = near[Math.floor(this.R() * near.length)];
      const sw = SIDEWALK[e.cls.replace('_link', '')] || 0;
      if (sw < 1 || e.closed || e.elevated) continue;
      const [a, b] = this._range(e);
      if (b - a < 6) continue;
      p.e = e; p.side = this.R() < 0.5 ? 1 : -1;
      p.lo = e.half + 0.35; p.hi = e.half + Math.max(0.5, sw - 0.35);
      p.lat = p.lo + this.R() * (p.hi - p.lo);
      p.s = a + this.R() * (b - a);
      this._pos(p);
      if (!this._ok(p.x, p.z)) continue;
      p.standing = this.R() < 0.3;
      p.dir = this.R() < 0.5 ? 1 : -1;
      p.speed = p.standing ? 0 : 0.85 + this.R() * 0.7;
      p.look = this.R() * 2 - 1;
      p.on = true;
      p.heading = this._yaw(p);
      return true;
    }
    return false;
  }

  _yaw(p) {
    if (p.standing) return Math.atan2(-p.nx, -p.nz) + p.look;
    return Math.atan2(p.dx * p.dir, p.dz * p.dir);
  }

  _dodge(p, dt, ph) {
    const [fx, fz] = ph.forward;
    const dx = p.x - ph.x, dz = p.z - ph.z;
    const lon = dx * fx + dz * fz, lat = dx * -fz + dz * fx;
    const hw = ph.spec.halfWidth + 0.9, hl = ph.spec.halfLength + 0.6, v = ph.forwardSpeed;
    const ahead = v >= 0 ? lon > -hl && lon < hl + 1.5 + v * 1.4 : lon < hl && lon > -hl - 1.5 + v * 1.4;
    if (!ahead || Math.abs(lat) > hw || (Math.abs(v) < 0.2 && Math.abs(lon) > hl)) return;
    // بعيد عن العربية: لجوه الرصيف (ناحية العمارات)
    const nl = Math.min(p.hi, p.lat + 3.4 * dt);
    p.lat = nl;
    p.scared = 1.2; p.standing = false; p.speed ||= 1.2;
  }

  update(dt, cam, ph, camDir) {
    const cx = cam.x, cz = cam.z;
    const fl = Math.hypot(camDir.x, camDir.z) || 1, fx = camDir.x / fl, fz = camDir.z / fl;
    let budget = this._first === false ? 6 : 1e9;
    for (let i = 0; i < this.count; i++) {
      const p = this.people[i];
      if (!p.on) { if (budget-- > 0) this._spawn(p, cx, cz, fx, fz, this._first === false ? SPAWN_MIN : 4, SPAWN_MAX); continue; }
      const d2 = (p.x - cx) ** 2 + (p.z - cz) ** 2;
      if (d2 > RECYCLE * RECYCLE) { p.on = false; continue; }
      if (ph && d2 < 400 && Math.abs(p.x - ph.x) < 9 && Math.abs(p.z - ph.z) < 9) this._dodge(p, dt, ph);
      p.scared = Math.max(0, p.scared - dt);
      if (!p.standing) {
        const [a, b] = this._range(p.e);
        const ns = p.s + p.dir * p.speed * (p.scared ? 1.6 : 1) * dt;
        if (ns > b || ns < a) p.dir = -p.dir;
        else {
          const os = p.s; p.s = ns; this._pos(p);
          // قدامه مش رصيف (جزيرة/مدخل/ترعة): يرجع
          if (!this._ok(p.x, p.z)) { p.s = os; p.dir = -p.dir; }
        }
      } else if (this.R() < dt * 0.02) { p.standing = false; p.speed = 0.9 + this.R() * 0.5; }
      this._pos(p);
      const ty = this._yaw(p);
      p.heading += Math.atan2(Math.sin(ty - p.heading), Math.cos(ty - p.heading)) * Math.min(1, dt * 4);
      p.phase += dt * (p.scared ? 12 : p.standing ? 1 : p.speed * 4.2);
    }
    this._first = false;
    this.batch.begin();
    for (let i = 0; i < this.count; i++) {
      const p = this.people[i];
      if (!p.on || (p.x - cx) ** 2 + (p.z - cz) ** 2 > VIEW * VIEW) continue;
      const talk = p.standing && !p.scared && (p.variant + i) % 4 === 0 ? 0.18 + Math.sin(p.phase * 0.7) * 0.08 : 0;
      const amp = p.standing && !p.scared ? 0 : p.scared ? 1.5 : Math.min(1.2, p.speed * 0.8);
      this.batch.add(p.variant, p.x, 0.15, p.z, p.heading, 1, p.phase, amp, talk, 0);
    }
    this.batch.flush();
  }

  randomNear(x, z, r = 40) {
    for (let k = 0; k < 12; k++) {
      const p = this.people[Math.floor(this.R() * this.count)];
      if (p && p.on && (p.x - x) ** 2 + (p.z - z) ** 2 < r * r) return { ...p, y: 0.15 };
    }
    return null;
  }

  nearby(x, z, r = 40) {
    let n = 0;
    for (let i = 0; i < this.count; i++) { const p = this.people[i]; if (p.on && (p.x - x) ** 2 + (p.z - z) ** 2 < r * r) n++; }
    return n;
  }

  /** للاختبار: كام واحد واقف على أسفلت (المفروض صفر) */
  debugOnRoad() {
    let bad = 0, n = 0;
    for (const p of this.people) { if (!p.on) continue; n++; if (!this._ok(p.x, p.z)) bad++; }
    return { people: n, onRoad: bad };
  }
}
