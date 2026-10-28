// =====================================================================
//  دورية الشرطة على المرور: لما عربية "تخبط وتهرب" (حادثة بين عربيات المرور)، الشرطة بتجري وراها بالسارينة
//  والكشاف، ولما تلحقها بتقف قدامها وتمسكها وبعدين بتمشي. (مفيش علاقة بمطاردتك إنت — دي في Incidents)
//  الحادثة بتتولّد كل فترة قريب منك عشان تشوفها: عربية بتخبط واحدة تانية من ضهرها وتكمل بسرعة.
// =====================================================================
import { buildSedan } from '../vehicles/SedanModel.js';
import { groundHeight } from '../world/ground.js';
import { findRoute, projectToGraph } from '../nav/RoadGraph.js';

const MAX_V = 27;           // م/ث (~97 كم/س)
const EVENT_EVERY = [70, 140]; // ثانية بين الحوادث
const FLEE_MUL = 1.55;      // الهربان بيزوّد سرعته

export class Patrol {
  constructor(scene, { traffic, audio, hud, incidents } = {}) {
    Object.assign(this, { scene, traffic, audio, hud, incidents });
    this.car = buildSedan({ livery: 'police', lod: 1, seeThrough: false });
    this.car.root.visible = false; scene.add(this.car.root);
    this.p = { x: 0, z: 0, yaw: 0, v: 0 };
    this.state = 'idle'; // idle → chase → stop → leave
    this._next = 25 + Math.random() * 30;
    this.caught = 0; this.events = 0;
    this._flash = 0;
  }

  get active() { return this.state !== 'idle'; }

  /** عربية هربانة (من المرور) + مكان الحادثة */
  start(offender, why = 'hit') {
    if (this.state !== 'idle' || !offender?.on) return false;
    const o = offender;
    // الشرطة بتظهر وراه على الطريق بمسافة 90-170م
    let q = null;
    for (let k = 0; k < 14 && !q; k++) {
      const a = Math.random() * Math.PI * 2, r = 90 + Math.random() * 80;
      const c = projectToGraph(o.x + Math.cos(a) * r, o.z + Math.sin(a) * r, 80);
      if (!c) continue;
      const rt = findRoute(c.x, c.z, o.x, o.z);
      if (rt && rt.length < 420) q = { c, rt };
    }
    if (!q) return false;
    const P = this.p, n = q.rt.pts[Math.min(q.rt.pts.length - 1, 2)];
    P.x = q.c.x; P.z = q.c.z; P.v = 8; P.yaw = Math.atan2(-(n.x - P.x), -(n.z - P.z));
    this.route = q.rt; this.ri = 0; this._rt = 1;
    this.off = o; this.t = 0; this.state = 'chase'; this.events++;
    o._vMul0 = o._vMul0 ?? o.vMul; o.vMul = o._vMul0 * FLEE_MUL; o.fleeing = true;
    this.car.root.visible = true;
    this.audio?.siren?.(true);
    void why;
    return true;
  }

  update(dt, ph) {
    const T = this.traffic;
    if (this.state === 'idle') {
      // حادثة جديدة كل فترة (بس لو إنت مش في مطاردة أو غرامة)
      this._next -= dt;
      if (this._next <= 0) {
        this._next = EVENT_EVERY[0] + Math.random() * (EVENT_EVERY[1] - EVENT_EVERY[0]);
        if (!this.incidents?.busy) this._spawnEvent(ph);
      }
      return;
    }
    const o = this.off, P = this.p;
    if (!o || !o.on || o.off || this.t > 90) return this._finish();
    this.t += dt;
    const dx = o.x - P.x, dz = o.z - P.z, dist = Math.hypot(dx, dz);
    if (this.state === 'chase') {
      this._rt -= dt;
      if (this._rt <= 0 || !this.route) {
        this._rt = 1;
        this.route = findRoute(P.x, P.z, o.x, o.z, -Math.sin(P.yaw), -Math.cos(P.yaw)) || this.route; this.ri = 0;
      }
      const pts = this.route.pts;
      while (this.ri < pts.length - 1 && Math.hypot(pts[this.ri].x - P.x, pts[this.ri].z - P.z) < 8 + P.v * 0.4) this.ri++;
      const tx = dist < 25 ? o.x : pts[this.ri].x, tz = dist < 25 ? o.z : pts[this.ri].z;
      this._steer(dt, tx, tz, Math.min(MAX_V, Math.max(12, o.v * 1.4 + 6)));
      if (dist < 11) {
        // لحقته: الهربان بيقف على جنب والشرطة وراه
        this.state = 'stop'; this._st = 0;
        o.bumped = 14; o.v = 0; o.fleeing = false; o.vMul = o._vMul0;
        if (this._near(ph)) this.hud?.toast('👮 الشرطة مسكت العربية اللي خبطت وهربت', 3.5);
        this.caught++;
      }
    } else if (this.state === 'stop') {
      this._st += dt;
      P.v = Math.max(0, P.v - 14 * dt); this._move(dt);
      if (this._st > 9) { this.state = 'leave'; this._st = 0; }
    } else if (this.state === 'leave') {
      this._st += dt;
      const [fx, fz] = [-Math.sin(P.yaw), -Math.cos(P.yaw)];
      this._steer(dt, P.x + fx * 30, P.z + fz * 30, 14);
      if (this._st > 6 || Math.hypot(P.x - ph.x, P.z - ph.z) > 260) this._finish();
    }
    this._sync(dt, ph);
  }

  /** للمرور: مايدخلوش في عربية الشرطة (بيقفوا وراها) */
  get stopZones() {
    if (this.state === 'idle') return [];
    return [{ x: this.p.x, z: this.p.z, r: 2.2, gap: 4 }];
  }

  _near(ph) { return Math.hypot(this.p.x - ph.x, this.p.z - ph.z) < 160; }

  /**
   * الشرطة مش بتعدّي جوه العربيات: بتبص قدامها، ولو فيه عربية في طريقها بتعدّيها من الجنب الفاضي
   * (زي السارينة في الحقيقة)، ولو الجنبين مقفولين بتهدّي وتمشي وراها. بيرجّع [tx, tz, want] بعد التعديل.
   */
  _avoid(tx, tz, want) {
    const P = this.p, T = this.traffic;
    if (!T?.cars) return [tx, tz, want];
    const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw), rx = -fz, rz = fx;
    const look = 6 + P.v * 1.1;
    const near = [];
    for (const c of T.cars) {
      if (!c.on || c.off || c === this.off && this.state !== 'chase') continue;
      const dx = c.x - P.x, dz = c.z - P.z;
      if (dx * dx + dz * dz > (look + 6) ** 2) continue;
      near.push({ c, f: dx * fx + dz * fz, l: dx * rx + dz * rz });
    }
    const blocked = (off) => {
      let best = null;
      for (const n of near) {
        if (n.c === this.off && this.state === 'chase') continue; // الهربان نفسه: بنقرّب منه عادي
        if (n.f > -1.5 && n.f < look && Math.abs(n.l - off) < 2.6 && (!best || n.f < best.f)) best = n;
      }
      return best;
    };
    const b = blocked(0);
    this._blocked = !!b;
    if (!b) return [tx, tz, want];
    // جنب فاضي؟ (الأول اللي التارجت ناحيته)
    const tl = (tx - P.x) * rx + (tz - P.z) * rz;
    for (const side of tl >= 0 ? [3.4, -3.4] : [-3.4, 3.4]) {
      if (blocked(side)) continue;
      const k = Math.min(b.f + 4, 12);
      return [P.x + fx * k + rx * side, P.z + fz * k + rz * side, Math.min(want, Math.max(8, (b.c.v || 0) + 5))];
    }
    // مقفولة: ورا العربية بسرعتها، ولو قريبة أوي: وقوف
    return [tx, tz, b.f < 5.5 ? 0 : Math.min(want, Math.max(0, (b.c.v || 0) - 0.5))];
  }

  _steer(dt, tx, tz, want) {
    const P = this.p;
    [tx, tz, want] = this._avoid(tx, tz, want);
    const ang = Math.atan2(-(tx - P.x), -(tz - P.z));
    let d = ang - P.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    const maxTurn = (1.6 + 8 / (2 + P.v)) * dt;
    const y0 = P.yaw, was = this._overlapAt(P.x, P.z, y0);
    P.yaw += Math.max(-maxTurn, Math.min(maxTurn, d));
    // اللفة نفسها مش لازم تدخّل مقدمة/ضهر العربية في عربية جنبها
    if (!was && this._overlapAt(P.x, P.z, P.yaw)) P.yaw = y0;
    // لو عربية دخلت فيها (أو اتولدت جنبها): تتزق على جنب لحد ما يبعدوا
    if (was) {
      const rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw), side = (P.x - was.x) * rx + (P.z - was.z) * rz >= 0 ? 1 : -1;
      P.x += rx * side * 2 * dt; P.z += rz * side * 2 * dt;
    }
    if (Math.abs(d) > 1.2) want = Math.min(want, 7);
    P.v += Math.max(-16 * dt, Math.min(7 * dt, want - P.v));
    this._move(dt);
  }

  _move(dt) {
    const P = this.p;
    const nx = P.x - Math.sin(P.yaw) * P.v * dt, nz = P.z - Math.cos(P.yaw) * P.v * dt;
    // ممنوع تدخل جوه عربية: لو الخطوة الجاية هتعمل تداخل والحالية مفيهاش → تقف مكانها (لو عربية دخلت فيها هي: تقدر تتحرك وتطلع)
    const c = this._overlapAt(nx, nz, P.yaw);
    if (c && !this._overlapAt(P.x, P.z, P.yaw)) { P.v = Math.min(P.v, Math.max(0, (c.v || 0) * 0.5)); return; }
    P.x = nx; P.z = nz;
  }

  /** عربية مرور متداخلة مع عربية الشرطة لو كانت في (x,z,yaw)؟ (مستطيلين، فحص المحاور الفاصلة) */
  _overlapAt(x, z, yaw) {
    const T = this.traffic; if (!T?.cars) return null;
    const ax = [[-Math.sin(yaw), -Math.cos(yaw)], [Math.cos(yaw), -Math.sin(yaw)]], ha = [2.35, 0.95];
    for (const c of T.cars) {
      if (!c.on || c.off || (c === this.off && this.state === 'chase')) continue;
      const dx = c.x - x, dz = c.z - z;
      if (dx * dx + dz * dz > 36) continue;
      const bx = [[-Math.sin(c.yaw), -Math.cos(c.yaw)], [Math.cos(c.yaw), -Math.sin(c.yaw)]], hb = [(c.len || 4.4) / 2, (c.width || 1.8) / 2];
      let sep = false;
      for (const [ux, uz] of [...ax, ...bx]) {
        const d = Math.abs(dx * ux + dz * uz);
        const ra = ha[0] * Math.abs(ax[0][0] * ux + ax[0][1] * uz) + ha[1] * Math.abs(ax[1][0] * ux + ax[1][1] * uz);
        const rb = hb[0] * Math.abs(bx[0][0] * ux + bx[0][1] * uz) + hb[1] * Math.abs(bx[1][0] * ux + bx[1][1] * uz);
        if (d > ra + rb) { sep = true; break; }
      }
      if (!sep) return c;
    }
    return null;
  }

  _sync(dt) {
    const P = this.p, r = this.car.root;
    r.position.set(P.x, groundHeight(P.x, P.z), P.z); r.rotation.y = P.yaw;
    this._flash += dt;
    const lb = this.car.lightbar;
    if (lb) {
      const k = Math.floor(this._flash * 7) % 4;
      lb.children[1].material.emissiveIntensity = k < 2 ? (k === 0 ? 3 : 0.3) : 0.15;
      lb.children[2].material.emissiveIntensity = k >= 2 ? (k === 2 ? 3 : 0.3) : 0.15;
    }
    this.audio?.sirenAt?.(P.x, 1.4, P.z, this.state === 'chase');
  }

  _finish() {
    const o = this.off;
    if (o) { o.vMul = o._vMul0 ?? o.vMul; o.fleeing = false; }
    this.off = null; this.state = 'idle'; this.car.root.visible = false; this.p.v = 0;
    this.audio?.siren?.(false);
  }

  /** عربية بتخبط واحدة تانية من ضهرها وتهرب — قريب منك عشان تشوفها */
  _spawnEvent(ph) {
    const T = this.traffic;
    const cand = T.cars.filter((c) => c.on && !c.off && !c.virtual && !c.line && c.type !== 'tuktuk' && c.v > 4 && !c.bumped
      && (c.x - ph.x) ** 2 + (c.z - ph.z) ** 2 > 40 * 40 && (c.x - ph.x) ** 2 + (c.z - ph.z) ** 2 < 170 * 170);
    if (!cand.length) return;
    const o = cand[Math.floor(Math.random() * cand.length)];
    // "الضحية": أقرب عربية قدامه على نفس الوصلة (لو فيه) بتتخبط وتقف
    let vic = null, bd = 30;
    for (const c of T.cars) {
      if (c === o || !c.on || c.e !== o.e || c.dir !== o.dir) continue;
      const d = (c.dir > 0 ? c.s - o.s : o.s - c.s);
      if (d > 0 && d < bd) { bd = d; vic = c; }
    }
    if (vic) { vic.bumped = 9; vic.v = 0; vic.kvx = (vic.kvx || 0) - Math.sin(o.yaw) * 1.2; vic.kvz = (vic.kvz || 0) - Math.cos(o.yaw) * 1.2; }
    if (!this.start(o, 'hit')) return;
    this.audio?.thump?.(0.6);
    if (this._near(ph)) this.hud?.toast('💥 عربية خبطت واحدة وهربت — الشرطة وراها!', 3.5);
  }
}
