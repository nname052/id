// =====================================================================
//  المشاة في شبين الحقيقية: ماشيين على الأرصفة الحقيقية بس (كل خطوة بنتأكد إن المكان رصيف مش أسفلت)،
//  وبيلفوا قبل التقاطع (مبيدخلوش الشارع التاني). الواجهة اللي الصوت والركاب بيستخدموها.
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
    const V = humanVariants(VARIANTS, 777, true);
    this.batch = new HumanBatch(this.group, V, this.cap);
    this.batch.types = V.map((v) => v.type);
    this.people = []; this.extras = [];
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

  // رصيف + مش جوه عمارة ولا جوه/تحت مطلع كوبري واطي (كانوا بيمشوا جوه الكوبري ويطلعوا من الحيطان)
  _ok(x, z) { return Math.abs(this.world.height(x, z, 0) - 0.15) < 0.01 && !this.world.walkBlocked?.(x, z); }

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
      // المكان الفعلي (الوصلة ممكن تبقى طويلة): مايظهرش قدام عينك جوه مدى الرؤية
      if (rMin > 5) {
        const qx = p.x - cx, qz = p.z - cz, qd = Math.hypot(qx, qz);
        if (qd < rMin || (qd < VIEW + 5 && (qx * fx + qz * fz) / qd > -0.35)) continue;
      }
      if (!this._ok(p.x, p.z)) continue;
      p.standing = this.R() < 0.3;
      p.dir = this.R() < 0.5 ? 1 : -1;
      p.speed = p.standing ? 0 : 0.85 + this.R() * 0.7;
      if (this.batch.types?.[p.variant] === 'elder') p.speed *= 0.6; // الكبار بيمشوا براحة
      p.look = this.R() * 2 - 1;
      p.on = true; p.cross = null;
      p.heading = this._yaw(p);
      return true;
    }
    return false;
  }

  _yaw(p) {
    if (p.cross) return p.cross.wait > 0 ? Math.atan2(p.cross.ux, p.cross.uz) + Math.sin(p.phase * 0.8) * 0.6 : Math.atan2(p.cross.ux, p.cross.uz);
    if (p.standing) return Math.atan2(-p.nx, -p.nz) + p.look;
    return Math.atan2(p.dx * p.dir, p.dz * p.dir);
  }

  /** آخر الرصيف عند التقاطع: ساعات بيعدّي الشارع للناحية التانية (الشوارع الصغيرة/المتوسطة بس، ولو مفيش عربيات قريبة) */
  _tryCross(p, ph) {
    const e = p.e, cls = e.cls.replace('_link', '');
    if (p.group || this.R() > 0.4 || e.oneway && e.half > 4 || ['primary', 'trunk', 'motorway'].includes(cls) || e.half > 6) return false;
    const x0 = p.x, z0 = p.z, tx = x0 - p.nx * 2 * p.lat, tz = z0 - p.nz * 2 * p.lat; // نفس المسافة على الناحية التانية
    if (!this._ok(tx, tz)) return false;
    p.cross = { x: x0, z: z0, x0, z0, tx, tz, ux: -p.nx, uz: -p.nz, t: 0, len: 2 * p.lat, wait: 0.6 + this.R() * 1.2 };
    p.standing = false;
    return true;
  }

  _carsNear(x, z, r) {
    const T = this.traffic;
    if (T) for (const c of T.cars) { if (!c.on || c.off) continue; const d2 = (c.x - x) ** 2 + (c.z - z) ** 2; if (d2 < 14 * 14 || (c.v > 0.5 && d2 < r * r)) return true; }
    return false;
  }

  _crossStep(p, dt, ph) {
    const C = p.cross;
    if (C.wait > 0) {
      // بيبص يمين وشمال، ومش بيعدّي غير لما الطريق يفضى (عربيات المرور + إنت)
      const busy = this._carsNear(C.x0 + C.ux * C.len / 2, C.z0 + C.uz * C.len / 2, 45) || (ph && (ph.x - C.x0) ** 2 + (ph.z - C.z0) ** 2 < 35 * 35 && Math.abs(ph.forwardSpeed) > 1);
      C.wait = busy ? Math.max(C.wait, 0.4) : C.wait - dt;
      C.waited = (C.waited || 0) + dt;
      if (C.waited > 25) { p.cross = null; p.dir = -p.dir; } // زهق: يرجع
      return;
    }
    // عربية قريبة أوي من مكانه الجاي: يستنى في مكانه (مايمشيش قدامها)
    const t1 = C.t + (p.speed * 1.15 * dt) / C.len, u1 = Math.min(1, t1);
    const nx = C.x0 + (C.tx - C.x0) * u1, nz = C.z0 + (C.tz - C.z0) * u1;
    if (this.traffic) for (const c of this.traffic.cars) {
      if (!c.on || c.off) continue;
      const dx = nx - c.x, dz = nz - c.z;
      if (dx * dx + dz * dz > 49) continue;
      if (c.v > 0.3 && dx * dx + dz * dz < 4.5 * 4.5) { C.blocked = false; return; }
      // عربية واقفة (حتى لو في نص لفة): مايعدّيش من جواها — يستنى لحد ما تتحرك أو يلف حواليها مش هيحصل
      const lon = dx * c.lastDx + dz * c.lastDz, lat = dx * -c.lastDz + dz * c.lastDx;
      if (Math.abs(lon) < c.len / 2 + 0.5 && Math.abs(lat) < c.width / 2 + 0.5) {
        // العربية بتفضل واقفة له؛ هو يرجع لناحيته بعد 1.5 ث. لو محبوس من الناحيتين (نادر) العربيات تتجاهله
        C.blockT = (C.blockT || 0) + dt;
        C.blocked = C.back && C.blockT > 3;
        if (C.blockT > 1.5 && !C.back) { // استنى كتير: يرجع لناحيته
          [C.x0, C.tx] = [C.tx, C.x0]; [C.z0, C.tz] = [C.tz, C.z0];
          C.t = 1 - C.t; C.ux = -C.ux; C.uz = -C.uz; C.back = true; C.blockT = 0;
        }
        return;
      }
    }
    C.blocked = false; C.blockT = 0;
    C.t = t1 - (p.speed * 1.15 * dt) / C.len;
    C.t += (p.speed * 1.15 * dt) / C.len;
    const u = Math.min(1, C.t);
    C.x = C.x0 + (C.tx - C.x0) * u; C.z = C.z0 + (C.tz - C.z0) * u;
    if (u >= 1) {
      if (C.back) { p.cross = null; this._pos(p); return; } // رجع لناحيته
      p.cross = null; p.side = -p.side; p.dir = -p.dir; this._pos(p);
      if (!this._ok(p.x, p.z)) { p.side = -p.side; this._pos(p); } // (نادرًا) الناحية التانية مش رصيف هنا: يفضل على ناحيته
    }
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

  update(dt0, cam, ph, camDir) {
    const cx = cam.x, cz = cam.z;
    const fl = Math.hypot(camDir.x, camDir.z) || 1, fx = camDir.x / fl, fz = camDir.z / fl;
    let budget = this._first === false ? 6 : 1e9;
    const fr = (this._fr = (this._fr || 0) + 1);
    for (let i = 0; i < this.count; i++) {
      const p = this.people[i];
      // البعيد (أكتر من 45م) بيمشي كل فريمين بضعف الخطوة
      p._dt = (p._dt || 0) + dt0;
      if (p.on && (fr + i) & 1 && (p.x - cx) ** 2 + (p.z - cz) ** 2 > 45 * 45) continue;
      const dt = p._dt; p._dt = 0;
      if (!p.on) {
        if (budget-- > 0 && this._spawn(p, cx, cz, fx, fz, this._first === false ? SPAWN_MIN : 4, SPAWN_MAX)) {
          // اتنين ماشيين مع بعض (صحاب/أم وابنها) — نفس السرعة والاتجاه، جنب بعض
          p.group = null;
          const q = this.people[i + 1];
          if (q && i + 1 < this.count && !q.on && this.R() < 0.28) {
            Object.assign(q, { e: p.e, side: p.side, lo: p.lo, hi: p.hi, s: p.s + 0.25, dir: p.dir, speed: p.speed, standing: p.standing, look: -p.look, scared: 0, cross: null });
            q.lat = p.lat + 0.55 <= p.hi ? p.lat + 0.55 : Math.max(p.lo, p.lat - 0.55);
            this._pos(q);
            if (this._ok(q.x, q.z)) { q.on = true; q.heading = p.heading; p.group = q.group = true; }
          }
        }
        continue;
      }
      const d2 = (p.x - cx) ** 2 + (p.z - cz) ** 2;
      if (d2 > RECYCLE * RECYCLE && !p.hit) { if (p.shop) { p.shop.it.busy = false; p.shop = null; } p.on = false; p.cross = null; p.group = null; p.ret = null; p.help = null; continue; }
      if (p.hitCool) p.hitCool = Math.max(0, p.hitCool - dt);
      if (p.hit) { this._hitStep(p, dt); continue; }
      if (p.ret) { this._returnStep(p, dt); continue; }
      if (p.help) {
        // اللي بيساعد ممكن يبقى في نص الشارع: العربية ممكن تخبطه هو كمان
        if (ph && Math.abs(p.x - ph.x) < 4.5 && Math.abs(p.z - ph.z) < 4.5 && this._hitTest(p, ph)) continue;
        this._helpStep(p, dt); continue;
      }
      // اللي رايح/راجع من محل ماشي على الرصيف عادي: لازم يتخبط لو عربية طلعت عليه (كان بيتعدّى الفحص ده خالص)
      if (p.shop) {
        if (p.shop.phase !== 'in' && ph && Math.abs(p.x - ph.x) < 4.5 && Math.abs(p.z - ph.z) < 4.5 && this._hitTest(p, ph)) continue;
        this._shopStep(p, dt); continue;
      }
      // بيدخل محل/بيتفرج على فاترينة (مرة كل شوية، من الرصيف بس)
      if (!p.cross && !p.group && !p.scared && !p.standing && d2 < 90 * 90 && this.R() < dt * 0.05) this._tryShop(p);
      if (ph && Math.abs(p.x - ph.x) < 4.5 && Math.abs(p.z - ph.z) < 4.5 && this._hitTest(p, ph)) continue;
      if (ph && !p.cross && d2 < 400 && Math.abs(p.x - ph.x) < 9 && Math.abs(p.z - ph.z) < 9) this._dodge(p, dt, ph);
      p.scared = Math.max(0, p.scared - dt);
      if (!p.standing) {
        const [a, b] = this._range(p.e);
        const ns = p.s + p.dir * p.speed * (p.scared ? 1.6 : 1) * dt;
        if (p.cross) { this._crossStep(p, dt, ph); }
        else if (ns > b || ns < a) { if (!this._tryCross(p, ph)) p.dir = -p.dir; }
        else {
          const os = p.s; p.s = ns; this._pos(p);
          // قدامه مش رصيف (جزيرة/مدخل/ترعة): يرجع
          if (!this._ok(p.x, p.z)) { p.s = os; p.dir = -p.dir; }
        }
      } else if (this.R() < dt * 0.02) { p.standing = false; p.speed = 0.9 + this.R() * 0.5; }
      this._pos(p);
      if (p.cross) { p.x = p.cross.x; p.z = p.cross.z; }
      const ty = this._yaw(p);
      p.heading += Math.atan2(Math.sin(ty - p.heading), Math.cos(ty - p.heading)) * Math.min(1, dt * 4);
      p.phase += dt * (p.scared ? 12 : p.standing ? 1 : p.speed * 4.2);
    }
    this._first = false;
    // اللي بيعدّوا الشارع دلوقتي (المرور بيقف لهم)
    const X = this.crossers || (this.crossers = []);
    X.length = 0;
    for (let i = 0; i < this.count; i++) { const p = this.people[i]; if (p.on && ((p.cross && p.cross.wait <= 0) || p.help)) X.push(p); }
    this.batch.begin();
    for (let i = 0; i < this.count; i++) {
      const p = this.people[i];
      if (!p.on || (p.x - cx) ** 2 + (p.z - cz) ** 2 > VIEW * VIEW) continue;
      const talk = p.standing && !p.scared && (p.variant + i) % 4 === 0 ? 0.18 + Math.sin(p.phase * 0.7) * 0.08 : 0;
      const amp = p.standing && !p.scared ? 0 : p.scared ? 1.5 : Math.min(1.2, p.speed * 0.8);
      if (p.shop?.phase === 'in') continue; // جوه المحل
      if (p.shop) { this.batch.add(p.variant, p.x, 0.15, p.z, p.heading, 1, p.phase, p.shop.phase === 'look' ? 0 : 0.8, p.shop.phase === 'look' ? 0.15 : 0, 0); continue; }
      if (p.help) {
        const H = p.help, arm = H.moving ? 0 : (i % 3 === 0 ? 0.55 + Math.sin(p.phase * 2) * 0.1 : 0); // واحد منهم بيشاور للعربيات تقف
        this.batch.add(p.variant, p.x, this.world.height(p.x, p.z, 0) + (H.moving ? 0 : 0), p.z, p.heading, 1, p.phase, H.moving || 0, arm, 0);
        continue;
      }
      if (p.hit || p.ret) {
        const H = p.hit;
        this.batch.add(p.variant, p.x, H ? H.y : this.world.height(p.x, p.z, 0), p.z, p.heading, 1, p.phase, H ? 0 : 0.6, 0, 0, H ? H.fall : 0);
        continue;
      }
      const y = p.cross && p.cross.wait <= 0 && p.cross.t > 0.08 && p.cross.t < 0.92 ? 0 : 0.15;
      this.batch.add(p.variant, p.x, y, p.z, p.heading, 1, p.phase, p.cross && p.cross.wait > 0 ? 0 : amp, talk, 0);
    }
    // ناس من برا الزحمة (المسعفين، المصاب على النقالة)
    for (const q of this.extras) this.batch.add(q.variant, q.x, q.y, q.z, q.yaw, 1, q.phase || 0, q.amp || 0, q.armR || 0, q.armL || 0, q.fall || 0);
    this.batch.flush();
  }

  // ===================== المحلات =====================
  _tryShop(p) {
    const kit = this.world.streetKit?.shop; if (!kit) return;
    const near = kit.near(p.x, p.z, 7, this._shopNear || (this._shopNear = []));
    const it = near.find((q) => q.ok !== false && !q.busy);
    if (!it) return;
    // باب المحل: على الواجهة نفسها (العنصر متحطوط على الواجهة، وشه لبره = yaw)
    const ox = Math.sin(it.yaw), oz = Math.cos(it.yaw);
    // (الواجهة ممكن تبقى لازقة في الرصيف أو بعده بشوية: أول نقطة رصيف قدامها)
    let door = null;
    for (const d of [0.4, 0.8, 1.3, 1.9]) { const x = it.x + ox * d, z = it.z + oz * d; if (this._ok(x, z)) { door = { x, z }; break; } }
    if (!door) return;
    // الطريق للمحل كله رصيف (مش محل في الناحية التانية من الشارع / مدخل عربيات في النص)
    const clear = (tx, tz) => { const L = Math.hypot(tx - p.x, tz - p.z), n = Math.ceil(L / 0.2); for (let k = 1; k <= n; k++) if (!this._ok(p.x + (tx - p.x) * k / n, p.z + (tz - p.z) * k / n)) return false; return true; };
    if (!clear(door.x, door.z)) return;
    const look = this.R() < 0.4 && this._ok(door.x + ox * 0.9, door.z + oz * 0.9) && clear(door.x + ox * 0.9, door.z + oz * 0.9);
    p.shop = { phase: 'go', it, door, look, back: { x: p.x, z: p.z }, t: look ? 4 + this.R() * 8 : 8 + this.R() * 25, faceYaw: it.yaw + Math.PI };
    it.busy = true;
  }

  _shopStep(p, dt) {
    const S = p.shop;
    const walk = (tx, tz) => { const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz); if (d < 0.15) return true; const st = Math.min(d, (p.speed || 1.1) * dt); p.x += dx / d * st; p.z += dz / d * st; p.heading = Math.atan2(dx, dz); p.phase += dt * 4.5; return false; };
    if (S.phase === 'go') {
      // الفرجة: بيقف قدام الفاترينة بمتر؛ الدخول: لحد الباب
      const tgt = S.look ? { x: S.door.x + Math.sin(S.it.yaw) * 0.9, z: S.door.z + Math.cos(S.it.yaw) * 0.9 } : S.door;
      if (walk(tgt.x, tgt.z)) S.phase = S.look ? 'look' : 'in';
    } else if (S.phase === 'look' || S.phase === 'in') {
      S.t -= dt;
      if (S.phase === 'look') { p.heading += Math.atan2(Math.sin(S.faceYaw - p.heading), Math.cos(S.faceYaw - p.heading)) * Math.min(1, dt * 4); p.phase += dt; }
      if (S.t <= 0) S.phase = 'out';
    } else if (S.phase === 'out') {
      if (walk(S.back.x, S.back.z)) { S.it.busy = false; p.shop = null; this._pos(p); }
    }
  }

  /** كلاكس: اللي بيعدّي قدام العربية بيستعجل (وماحدش بيبدأ يعدّي دلوقتي) */
  honked(ph) {
    const [fx, fz] = ph.forward;
    for (const p of this.people) {
      if (!p.on || !p.cross) continue;
      const dx = p.x - ph.x, dz = p.z - ph.z, lon = dx * fx + dz * fz;
      if (lon < 0 || lon > 30 || Math.abs(dx * -fz + dz * fx) > 8) continue;
      if (p.cross.wait > 0) p.cross.wait = Math.max(p.cross.wait, 2.5); else { p.scared = 2; p.speed = Math.max(p.speed, 1.8); }
    }
  }

  // ===================== الحوادث =====================
  /** العربية لمست الماشي ده؟ (صندوق العربية + هامش) → يقع. السرعة بتحدد: خبطة خفيفة (بيقوم) ولا خطيرة (إسعاف) */
  _hitTest(p, ph) {
    const v = Math.abs(ph.forwardSpeed);
    if (v < 1.6 || p.hitCool > 0) return false;
    const [fx, fz] = ph.forward, dx = p.x - ph.x, dz = p.z - ph.z;
    const lon = dx * fx + dz * fz, lat = dx * -fz + dz * fx;
    if (Math.abs(lon) > ph.spec.halfLength + 0.25 || Math.abs(lat) > ph.spec.halfWidth + 0.25) return false;
    // (لو في نص العربية بالجنب مش هيتخبط من الوش: الخبطة من قدام/ورا حسب اتجاه الحركة)
    const sgn = Math.sign(ph.forwardSpeed);
    if (lon * sgn < -ph.spec.halfLength * 0.4) return false;
    const severe = v > 8.5; // ~30 كم/س
    const vx = fx * ph.forwardSpeed, vz = fz * ph.forwardSpeed, side = Math.sign(lat) || 1;
    p.hit = { t: 0, y: p.cross ? 0 : 0.15, vy: 1.2 + v * 0.12, vx: vx * 0.7 + -fz * side * 0.9, vz: vz * 0.7 + fx * side * 0.9, fall: 0, severe, rest: 0 };
    p.heading = Math.atan2(vx, vz) + Math.PI; // بيقع على ضهره بعكس اتجاه الخبطة
    p.cross = null; p.group = null; p.standing = false; p.help = null;
    if (p.shop) { p.shop.it.busy = false; p.shop = null; } // (كان رايح محل: الزيارة اتلغت)
    // اللي حواليه: أقرب 2-4 بيجروا على المصاب يساعدوه (زي الحقيقة)، واللي لازقين في العربية بيتخضوا ويبعدوا
    const near = [];
    for (const q of this.people) {
      if (!q.on || q === p || q.hit || q.help || q.shop?.phase === 'in') continue;
      const d2 = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
      if (d2 < 35 * 35) near.push([d2, q]);
    }
    near.sort((a, b) => a[0] - b[0]);
    const nHelp = Math.min(near.length, 2 + Math.floor(this.R() * 3));
    near.forEach(([d2, q], k) => {
      if (k < nHelp) {
        if (q.shop) { q.shop.it.busy = false; q.shop = null; }
        const a = (k / nHelp) * Math.PI * 2 + this.R() * 0.6;
        q.help = { v: p, a, r: 1.15 + this.R() * 0.35, t: 0, home: { x: q.x, z: q.z } };
        q.cross = null; q.group = null; q.standing = false; q.scared = 0;
      } else if (d2 < 10 * 10) { q.scared = 4; q.standing = false; q.speed ||= 1.2; }
    });
    this.onHit?.(p, severe, v);
    return true;
  }

  _hitStep(p, dt) {
    const H = p.hit; H.t += dt;
    const g = this.world.height(p.x, p.z, 0);
    if (H.y > g + 0.01 || H.vy > 0) {
      H.vy -= 9.8 * dt; H.y += H.vy * dt;
      if (H.y <= g) { H.y = g; H.vy = 0; }
    } else { const k = Math.exp(-dt * 5); H.vx *= k; H.vz *= k; }
    p.x += H.vx * dt; p.z += H.vz * dt;
    if (H.rest <= 3.5) H.fall = Math.min(1, H.fall + dt * 3.2); // (وهو بيقوم بيقل بس — مش بيتشد للأرض تاني)
    // أي خبطة: بيفضل واقع (متألم) لحد ما الإسعاف تشيله (Emergency) — مش بيقوم لوحده (كان بيقع ويقوم تاني)
    if (H.severe || H.keepDown !== false) { if (H.severe) this._victimStain(p, H); return; }
    if (H.vy === 0 && Math.hypot(H.vx, H.vz) < 0.2) H.rest += dt;
    if (H.rest > 3.5) { H.fall = Math.max(0, H.fall - dt * 2.5); if (H.fall === 0) { const lx = p.x, lz = p.z; p.hit = null; p.hitCool = 6; p.scared = 4; this._pos(p); p.ret = { tx: p.x, tz: p.z }; p.x = lx; p.z = lz; } }
  }

  /** بيجري على المصاب ويقف جنبه (بيبص عليه ويشاور) لحد ما الإسعاف تشيله، وبعدين يرجع مكانه */
  _helpStep(p, dt) {
    const H = p.help, v = H.v;
    H.t += dt;
    const gone = !v.on || !v.hit || H.t > 120;
    const tx = gone ? H.home.x : v.x + Math.sin(H.a) * H.r, tz = gone ? H.home.z : v.z + Math.cos(H.a) * H.r;
    const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
    if (d > 0.12) {
      const sp = Math.min(d, (gone ? 1.2 : 3.1) * dt);
      p.x += dx / d * sp; p.z += dz / d * sp;
      p.heading = Math.atan2(dx, dz); p.phase += dt * (gone ? 4.5 : 11);
      H.moving = gone ? 0.8 : 1.5;
    } else {
      if (gone) { p.help = null; this._pos(p); p.ret = { tx: p.x, tz: p.z }; p.x = tx; p.z = tz; return; }
      H.moving = 0;
      const ty = Math.atan2(v.x - p.x, v.z - p.z); // بيبص على المصاب
      p.heading += Math.atan2(Math.sin(ty - p.heading), Math.cos(ty - p.heading)) * Math.min(1, dt * 5);
      p.phase += dt;
    }
  }

  /** بعد ما قام: بيمشي (بيعرج) لمكانه على الرصيف بدل ما ينط له */
  _returnStep(p, dt) {
    const R = p.ret, dx = R.tx - p.x, dz = R.tz - p.z, d = Math.hypot(dx, dz);
    p.hitCool = Math.max(0, (p.hitCool || 0) - dt);
    if (d < 0.2) { p.ret = null; this._pos(p); return; }
    const sp = Math.min(d, 0.9 * dt);
    p.x += dx / d * sp; p.z += dz / d * sp; p.heading = Math.atan2(dx, dz); p.phase += dt * 3;
  }

  _victimStain(p, H) {
    if (H.stain || H.vy !== 0 || Math.hypot(H.vx, H.vz) > 0.3) return;
    // بقعة صغيرة غامقة تحت المصاب (محدودة، مش دموية) — بتختفي لما الإسعاف تمشي
    const m = new THREE.Mesh(this._stainGeo ||= new THREE.CircleGeometry(0.55, 14).rotateX(-Math.PI / 2), this._stainMat ||= new THREE.MeshBasicMaterial({ color: 0x3a0b0b, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.scale.set(1, 1, 0.7 + this.R() * 0.4); m.rotation.y = this.R() * 6; m.position.set(p.x + Math.sin(p.heading) * 0.5, H.y + 0.012, p.z + Math.cos(p.heading) * 0.5);
    this.group.add(m); H.stain = m;
  }

  /** الإسعاف شالت المصاب */
  removeVictim(p) {
    if (p.hit?.stain) { const s = p.hit.stain; setTimeout(() => s.removeFromParent(), 20000); }
    p.hit = null; p.on = false;
  }

  /** مصابين على الأرض (للمرور: يقفوا قبلهم) */
  get victims() { return this.people.filter((p) => p.on && p.hit && p.hit.vy === 0); }

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
    let crossing = 0, groups = 0;
    let accident = 0, shopOff = 0;
    for (const p of this.people) {
      if (!p.on) continue; n++; if (p.group) groups++; if (p.cross) { crossing++; continue; }
      // ضحية حادثة / بيرجع للرصيف بعدها: مكانه الطبيعي برا الرصيف (مش غلطة مشي)
      if (p.hit || p.ret) { if (!this._ok(p.x, p.z)) accident++; continue; }
      if (!this._ok(p.x, p.z)) { bad++; if (p.shop) shopOff++; }
    }
    return { people: n, onRoad: bad, crossing, groups, accident, shopOff };
  }
}
