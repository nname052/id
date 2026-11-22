// =====================================================================
//  الطيران (STAGE 7): جسم صلب 6 درجات حرية + موديل طيران لكل نوع (مش "عربية طايرة"):
//  - الطيارة (A320 تقريبًا): رفع/سحب من معاملات الجناح (CL(α) خطي لحد زاوية الانهيار وبعدها بيقع)، دفع المحركات
//    بيقل مع السرعة، جاذبية، عزوم الاستقرار (الطيارة بتعدل نفسها لاتجاه الهوا) والتخميد، قلابات (flaps)، عجل بيتلم،
//    عجل على الأرض بزنبرك/مخمّد (بيتضغط) + احتكاك + فرامل + توجيه العجلة الأمامية.
//    التحكم "Fly-by-wire" زي الإيرباص الحقيقية (Normal Law مبسّط): العصاية = معدل ميل، سايبها = الطيارة ماسكة وضعها،
//    حماية زاوية الهجوم (مابتنهارش لوحدها لو شدّيت) وحد الميل الجانبي 67°. على الأرض: تحكم مباشر.
//  - الهليكوبتر: دفع الريشة في اتجاه قرص الريشة (الـ cyclic بيميّل القرص، الـ collective بيغيّر الدفع)، تأثير الأرض،
//    الرفع الانتقالي (ETL)، الدفع بيقل وانت طالع، دوامة الريشة (VRS) لو نزلت بسرعة وانت واقف، عزم الريشة على الجسم
//    + ريشة الديل (البدالات)، سحب الجسم، تخميد. SAS (مساعد ثبات) شغال افتراضيًا: العصاية = زاوية الجسم المطلوبة.
//  الأرقام تقريبية من بيانات منشورة (كتلة/مساحة جناح/دفع) — مش محاكي معتمد.
// =====================================================================
import * as THREE from 'three';

export const G = 9.81, RHO = 1.225;
const V3 = THREE.Vector3;
const _a = new V3(), _b = new V3(), _c = new V3(), _d = new V3(), _w = new V3();
const _ka = new V3(), _kb = new V3(), _kc = new V3(), _kf = new V3(); // (مؤقتات التلامس لوحدها)
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/** جسم صلب: المحاور f لقدام، u لفوق، r لليمين (r = f × u). السرعات الزاوية p (ميل جانبي: الجناح اليمين لتحت +)،
 *  q (الأنف لفوق +)، r (الأنف شمال +) — كلها لفة موجبة حوالين المحور بقاعدة اليد اليمين */
export class RigidBody {
  constructor(m, I) {
    this.m = m; this.I = I;
    this.pos = new V3(); this.vel = new V3(); this.q = new THREE.Quaternion(); this.w = { p: 0, q: 0, r: 0 };
    this.f = new V3(); this.u = new V3(); this.r = new V3(); this.F = new V3(); this.T = new V3();
    this.axes();
  }
  axes() { this.f.set(0, 0, -1).applyQuaternion(this.q); this.u.set(0, 1, 0).applyQuaternion(this.q); this.r.set(1, 0, 0).applyQuaternion(this.q); }
  omega(out) { return out.copy(this.f).multiplyScalar(this.w.p).addScaledVector(this.r, this.w.q).addScaledVector(this.u, this.w.r); }
  /** نقطة في إحداثيات الموديل (بالنسبة لمركز الثقل) → إزاحة في العالم */
  off(local, out) { return out.copy(local).applyQuaternion(this.q); }
  pointVel(off, out) { return out.crossVectors(this.omega(_w), off).add(this.vel); }
  force(F) { this.F.add(F); }
  forceAt(F, off) { this.F.add(F); this.T.add(_d.crossVectors(off, F)); }
  /** عزم بمركّبات الجسم (ميل جانبي، ميل أمامي، لف) */
  moment(Mp, Mq, Mr) { this.T.addScaledVector(this.f, Mp).addScaledVector(this.r, Mq).addScaledVector(this.u, Mr); }
  integrate(dt) {
    this.vel.addScaledVector(this.F, dt / this.m);
    this.pos.addScaledVector(this.vel, dt);
    const T = this.T;
    this.w.p += (T.dot(this.f) / this.I.roll) * dt;
    this.w.q += (T.dot(this.r) / this.I.pitch) * dt;
    this.w.r += (T.dot(this.u) / this.I.yaw) * dt;
    const W = this.omega(_w), q = this.q;
    const qw = new THREE.Quaternion(W.x * 0.5 * dt, W.y * 0.5 * dt, W.z * 0.5 * dt, 0).multiply(q);
    q.set(q.x + qw.x, q.y + qw.y, q.z + qw.z, q.w + qw.w).normalize();
    this.axes();
    this.F.set(0, 0, 0); this.T.set(0, 0, 0);
  }
  /** زوايا للعرض والتحكم: pitch (الأنف لفوق +)، bank (اليمين لتحت +)، heading (0 = شمال = -z، 90 = شرق) */
  get pitch() { return Math.asin(clamp(this.f.y, -1, 1)); }
  get bank() { return Math.atan2(-this.r.y, this.u.y); }
  get heading() { return Math.atan2(this.f.x, -this.f.z); }
}

/** نقط تلامس (عجل/زحافات/جسم): زنبرك + مخمّد عمودي + احتكاك. بترجع أقصى انضغاط وسرعة الخبطة */
function contact(B, pt, groundFn, opt, res) {
  const off = B.off(pt.p, _ka), P = _kb.copy(B.pos).add(off);
  const g = groundFn(P.x, P.z, P.y);
  pt.wp = pt.wp || new V3(); pt.wp.copy(P);
  const pen = g.y - P.y;
  pt.comp = Math.max(0, pen); pt.on = pen > 0;
  if (pen <= 0) return;
  if (g.water) res.water = true;
  if (g.roof) res.roof = true;
  const vp = B.pointVel(off, _kc);
  res.sink = Math.max(res.sink, -vp.y);
  res.pen = Math.max(res.pen, pen);
  if (!pt.k) { res.body = true; if (!pt.soft) res.hard = true; return; } // نقطة من الجسم (ديل/جناح/محرك/ريشة) لمست الأرض = خبطة (الديل: tail strike مش تحطم لو خفيفة)
  let N = pt.k * pen - pt.c * vp.y;
  if (N <= 0) return;
  N = Math.min(N, pt.k * 1.5); // (الانضغاط الجامد: مايطيرش الطيارة لو اتغرزت فجأة)
  const F = _kf.set(0, N, 0);
  // اتجاه العجلة على الأرض (العجلة الأمامية بتلف مع الدركسيون)
  let fx = B.f.x, fz = B.f.z; const L = Math.hypot(fx, fz) || 1; fx /= L; fz /= L;
  if (pt.steer && opt.steer) { const c = Math.cos(opt.steer), s = Math.sin(opt.steer), rx = -fz, rz = fx; const nx = fx * c + rx * s, nz = fz * c + rz * s; fx = nx; fz = nz; }
  const lx = -fz, lz = fx; // يمين العجلة
  const vl = vp.x * fx + vp.z * fz, vt = vp.x * lx + vp.z * lz;
  const mu = pt.skid ? opt.muSkid ?? 0.6 : (pt.brake ? opt.brake * 0.55 : 0) + 0.016;
  const share = pt.share || B.m / 4;
  const Fl = -clamp(vl * share * 6, -mu * N, mu * N), Ft = -clamp(vt * share * 10, -0.85 * N, 0.85 * N);
  F.x += fx * Fl + lx * Ft; F.z += fz * Fl + lz * Ft;
  B.forceAt(F, off);
}

const groundRes = () => ({ sink: 0, pen: 0, body: false, water: false, roof: false, onGround: false });

// ========================================================================================
//  الطيارة
// ========================================================================================
export const PLANE_SPEC = {
  name: 'إيرباص A320', m: 64000, S: 122.6, b: 34.1, c: 4.19, I: { roll: 1.6e6, pitch: 3.1e6, yaw: 4.4e6 },
  Tmax: 222000, cg: new V3(0, 3.0, -2.4), engines: new V3(0, -1.6, -1.0),
  // (إحداثيات الموديل: x يمين، y فوق، z لورا؛ العجل عند y=0) — المسافة بين العجل 12.3م والعرض 7.5م زي الحقيقة
  gear: [
    { p: [0, 0, -13.72], k: 0.45e6, c: 70000, steer: true, share: 6400 },
    { p: [-3.74, 0, -1.38], k: 1.2e6, c: 260000, brake: true, share: 29000 },
    { p: [3.74, 0, -1.38], k: 1.2e6, c: 260000, brake: true, share: 29000 },
  ],
  body: [[0, 3.8, 17.0], [-16.9, 3.6, 2.5], [16.9, 3.6, 2.5], [-5.7, 0.55, -5.8], [5.7, 0.55, -5.8], [0, 1.3, -17.6]],
  flapSteps: [0, 0.33, 0.66, 1],
};

export class PlaneFDM {
  constructor(spec = PLANE_SPEC) {
    this.s = spec; this.B = new RigidBody(spec.m, spec.I);
    const cg = spec.cg;
    this.gear = spec.gear.map((g) => ({ ...g, p: new V3(...g.p).sub(cg) }));
    this.bodyPts = spec.body.map((p, i) => ({ p: new V3(...p).sub(cg), soft: i === 0 }));
    this.engOff = spec.engines.clone();
    this.throttle = 0; this.flapIdx = 2; this.flaps = spec.flapSteps[2]; this.gearDown = true; this.gearPos = 1;
    this.eI = 0; this.onGround = true; this.airT = 0; this.crashed = null; this.stall = false; this.law = 'ground';
    this.alpha = 0; this.beta = 0; this.V = 0; this.n = 1; this.thrust = 0; this.res = groundRes();
  }

  /** حط الطيارة واقفة على الأرض (العجل على y) واتجاهها yaw (0 = -z) */
  place(x, y, z, yaw, { speed = 0, alt = 0, pitch = 0 } = {}) {
    const B = this.B; B.q.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ')); B.axes();
    B.pos.set(x, y + this.s.cg.y - 0.25 + alt, z); B.vel.copy(B.f).multiplyScalar(speed);
    B.w.p = B.w.q = B.w.r = 0; this.eI = 0; this.crashed = null; this.airT = alt > 5 ? 10 : 0; this.onGround = alt < 1;
    if (alt > 5) { this.gearDown = false; this.gearPos = 0; this.flapIdx = 0; this.flaps = 0; this.throttle = 0.62; }
  }

  setFlaps(d) { this.flapIdx = clamp(this.flapIdx + d, 0, this.s.flapSteps.length - 1); }
  toggleGear() { if (this.onGround && this.gearDown) return false; this.gearDown = !this.gearDown; return true; }

  /** ctl: pitch (شد = الأنف لفوق +1)، roll (يمين +1)، yaw (الأنف يمين +1)، lever (تغيير الدفع)، thr (قيمة مطلقة لو موجودة)، brake */
  step(dt, ctl, groundFn) {
    if (this.crashed) return;
    const S = this.s, B = this.B;
    // الدفع والقلابات والعجل (بتتحرك بالتدريج زي الحقيقة)
    if (ctl.thr != null) this.throttle = clamp(ctl.thr, 0, 1); else this.throttle = clamp(this.throttle + (ctl.lever || 0) * 0.45 * dt, 0, 1);
    this.flaps += clamp(S.flapSteps[this.flapIdx] - this.flaps, -0.08 * dt, 0.08 * dt);
    this.gearPos = clamp(this.gearPos + (this.gearDown ? 1 : -1) * dt / 8, 0, 1);
    const v = B.vel, V = v.length(); this.V = V;
    const vf = v.dot(B.f), vu = v.dot(B.u), vr = v.dot(B.r);
    const alpha = V > 2 ? Math.atan2(-vu, Math.max(0.1, vf)) : 0, beta = V > 2 ? Math.asin(clamp(vr / V, -1, 1)) : 0;
    this.alpha = alpha; this.beta = beta;
    const qbar = 0.5 * RHO * V * V, fl = this.flaps;
    // ===== التحكم (Normal Law في الجو / مباشر على الأرض) =====
    const sp = clamp(ctl.pitch || 0, -1, 1), sr = clamp(ctl.roll || 0, -1, 1), sy = clamp(ctl.yaw || 0, -1, 1);
    const air = this.airT > 1.5 && !this.forceDirect; // (forceDirect: للاختبار بس — تحكم مباشر من غير حمايات)
    let e, a, rd;
    const qref = 9000, sched = clamp(qref / Math.max(qbar, 300), 0.4, 25);
    const aStall = (14 + 2.5 * fl) * Math.PI / 180;
    // ===== Normal Law: العصاية = تغيير زاوية مسار الطيران (γ)؛ سايبها = الطيارة ماسكة مسارها (1g) =====
    const gam = V > 5 ? Math.asin(clamp(v.y / V, -1, 1)) : 0;
    if (!air || Math.abs(sp) > 0.04 || this.gRef == null) this.gRef = gam;
    const pitchLoop = (qc) => {
      const err = qc - B.w.q;
      this.eI = clamp(this.eI + err * 5 * sched * dt, -0.9, 0.9);
      return clamp(err * 7 * sched + this.eI, -1, 1);
    };
    if (air) {
      this.law = 'normal';
      let qc = sp * 0.09 + 0.9 * (this.gRef - gam);
      // حماية زاوية الهجوم + حد الميل (+30° / -15°)
      const aProt = aStall - 3.5 * Math.PI / 180;
      if (alpha > aProt) qc = Math.min(qc, -1.2 * (alpha - aProt));
      const th = B.pitch;
      if (th > 0.52) qc = Math.min(qc, -0.5 * (th - 0.52)); if (th < -0.26) qc = Math.max(qc, -0.5 * (th + 0.26));
      // (في اللف الأنف لازم يترفع عشان الطيارة ماتنزلش — زي الـ Normal Law: γ ثابتة)
      const bank = B.bank; qc += (1 / Math.max(0.35, Math.cos(bank)) - 1) * G / Math.max(V, 40) * Math.cos(bank);
      e = pitchLoop(qc);
      // الميل الجانبي: معدل لحد 15°/ث؛ سايبها = ماسكة الميل (لو أقل من 33°) — أكتر من 33° بترجع لـ 33°، أقصى 67°
      let pc = sr * 0.26;
      if (Math.abs(sr) < 0.05 && Math.abs(bank) > 0.576) pc = -0.6 * (bank - Math.sign(bank) * 0.576);
      if (Math.abs(bank) > 1.17) pc = -1.5 * (bank - Math.sign(bank) * 1.17);
      a = clamp((pc - B.w.p) * 6 * sched, -1, 1);
      // الدفة: البدالات + مخمّد اللف (yaw damper) بيلغي الانزلاق الجانبي
      rd = clamp(sy + 3 * beta, -1, 1);
    } else if (this.forceDirect) { this.law = 'direct'; e = sp; a = sr; rd = sy; } else {
      this.law = 'ground';
      // على الأرض فوق 40 م/ث: الشدّ = معدل رفع الأنف لحد 3°/ث وأقصى 10° (زي الحقيقة — أكتر من كده الديل بيخبط)
      if (V > 40) { let qc = sp * 0.055; if (B.pitch > 0.17) qc = Math.min(qc, -1.0 * (B.pitch - 0.17)); e = pitchLoop(qc); }
      else { this.eI = 0; e = sp; }
      a = sr * 0.5; rd = sy;
    }
    // ===== الأيروديناميكا =====
    const CL0 = 0.22 + 0.55 * fl, CLa = 5.3;
    let CL;
    if (alpha > aStall) { const mx = CL0 + CLa * aStall; CL = mx * (1 - 0.45 * smooth(0, 0.25, alpha - aStall)); }
    else if (alpha < -0.2) CL = CL0 + CLa * -0.2;
    else CL = CL0 + CLa * alpha;
    this.stall = alpha > aStall;
    const h = this._agl || 50;
    if (h < S.b) CL *= 1 + 0.08 * (1 - h / S.b); // تأثير الأرض
    let CD = 0.021 + 0.042 * CL * CL + 0.055 * fl + 0.018 * this.gearPos + (alpha > aStall ? 0.9 * Math.sin(alpha - aStall) ** 2 : 0);
    // على الأرض + فرامل + الدفع خامل: spoilers (بتقتل الرفع وبتزود السحب) زي الحقيقة
    this.spoilers = this.onGround && (ctl.brake || 0) > 0.3 && this.throttle < 0.12;
    if (this.spoilers) { CL -= 0.7; CD += 0.09; }
    if (V > 2) {
      const vh = _a.copy(v).divideScalar(V);
      const lift = _b.copy(B.u).addScaledVector(vh, -B.u.dot(vh)).normalize().multiplyScalar(qbar * S.S * CL);
      B.force(lift);
      B.force(_b.copy(vh).multiplyScalar(-qbar * S.S * CD));
      B.force(_b.copy(B.r).multiplyScalar(-qbar * S.S * 0.9 * beta));
      const ch = S.c / (2 * V), bh = S.b / (2 * V);
      const Cm = 0.045 - 0.05 * fl - 0.9 * alpha + 0.55 * e - 16 * B.w.q * ch;
      const Cl = -0.09 * beta + 0.11 * a - 0.45 * B.w.p * bh;
      const Cn = -0.11 * beta - 0.08 * rd - 0.22 * B.w.r * bh;
      B.moment(qbar * S.S * S.b * Cl, qbar * S.S * S.c * Cm, qbar * S.S * S.b * Cn);
    }
    // الدفع (المحركات تحت مركز الثقل: الدفع بيرفع الأنف شوية زي الحقيقة)
    this.thrust = this.throttle * S.Tmax * Math.max(0.55, 1 - 0.0028 * V);
    B.forceAt(_b.copy(B.f).multiplyScalar(this.thrust), B.off(this.engOff, _c));
    B.force(_a.set(0, -S.m * G, 0));
    // ===== الأرض =====
    const res = (this.res = groundRes());
    const steer = rd * (1.2 * (1 - Math.min(1, V / 18)) + 0.12);
    const opt = { steer, brake: clamp(ctl.brake || 0, 0, 1) };
    if (this.gearPos > 0.95) for (const gp of this.gear) contact(B, gp, groundFn, opt, res);
    else if (this.gearPos > 0.05) res.gearMoving = true;
    for (const bp of this.bodyPts) contact(B, bp, groundFn, opt, res);
    if (this.gearPos <= 0.95) for (const gp of this.gear) { const p = { p: gp.p }; contact(B, p, groundFn, opt, res); }
    this.onGround = this.gear.some((g) => g.on);
    this.airT = this.onGround ? 0 : this.airT + dt;
    // (أي خبطة جامدة = تحطم)
    if (res.water && res.pen > 0.2) this.crashed = 'water';
    else if (res.body && (res.sink > 2.5 || (res.hard && (res.sink > 1.2 || V > 30)))) this.crashed = 'body';
    else if (res.sink > 4.2) this.crashed = 'hard';
    else if (res.pen > 1.4) this.crashed = 'obstacle';
    this.tailStrike = res.body && !this.crashed;
    this.touchSink = res.sink;
    // تخميد بسيط عشان الأرقام الصغيرة (مش ملحوظ)
    B.w.p *= 1 - 0.02 * dt; B.w.q *= 1 - 0.02 * dt; B.w.r *= 1 - 0.02 * dt;
    // عامل الحمل (g) للعرض
    this.n = V > 5 ? (qbar * S.S * CL) / (S.m * G) : 1;
    B.integrate(dt);
  }
}

// ========================================================================================
//  الهليكوبتر
// ========================================================================================
export const HELI_SPEC = {
  name: 'هليكوبتر مدني خفيف', m: 1450, I: { roll: 1100, pitch: 3200, yaw: 2800 }, Tmax: 1.75 * 1450 * G,
};

export class HeliFDM {
  /** rig: { hub (V3 موديل), R (نص قطر الريشة), skids: [V3 ...], cg (V3) } من الموديل نفسه */
  constructor(rig, spec = HELI_SPEC) {
    this.s = spec; this.B = new RigidBody(spec.m, spec.I);
    this.cg = rig.cg.clone(); this.R = rig.R;
    this.hub = rig.hub.clone().sub(this.cg);
    const sh = spec.m / rig.skids.length;
    this.skids = rig.skids.map((p) => ({ p: p.clone().sub(this.cg), k: 75000, c: 2 * 0.8 * Math.sqrt(75000 * sh), skid: true, share: sh }));
    this.bodyPts = [{ p: this.hub.clone() }, { p: new V3(0, rig.tailY ?? 1.5, rig.tailZ ?? 6).sub(this.cg) }];
    this.coll = 0; this.rpm = 0; this.engine = true; this.sas = true; this.crashed = null;
    this.vrs = 0; this.res = groundRes(); this.onGround = true; this.cp = 0; this.cr = 0; this.ped = 0;
    this.A = Math.PI * this.R * this.R;
  }
  place(x, y, z, yaw, { alt = 0, speed = 0 } = {}) {
    const B = this.B; B.q.setFromEuler(new THREE.Euler(0, yaw, 0, 'YXZ')); B.axes();
    B.pos.set(x, y + this.cg.y + alt - 0.02, z); B.vel.copy(B.f).multiplyScalar(speed); B.w.p = B.w.q = B.w.r = 0;
    this.crashed = null; this.vrs = 0;
    if (alt > 3) { this.rpm = 1; this.coll = 0.58; } else { this.rpm = 0; this.coll = 0; }
  }

  /** ctl: pitch (شد +1 = الأنف لفوق/لورا)، roll (يمين +1)، yaw (الأنف يمين +1)، lever (الـ collective لفوق/تحت)، coll (قيمة مطلقة) */
  step(dt, ctl, groundFn) {
    if (this.crashed) return;
    const B = this.B;
    this.rpm = clamp(this.rpm + (this.engine ? 1 : -0.6) * dt * 0.16, 0, 1);
    if (ctl.coll != null) this.coll = clamp(ctl.coll, 0, 1); else this.coll = clamp(this.coll + (ctl.lever || 0) * 0.42 * dt, 0, 1);
    const sp = clamp(ctl.pitch || 0, -1, 1), sr = clamp(ctl.roll || 0, -1, 1), sy = clamp(ctl.yaw || 0, -1, 1);
    // ===== الـ cyclic: مباشر أو بالـ SAS (العصاية = زاوية الجسم المطلوبة: 20° لقدام/لورا، 25° جنب) =====
    let cp, cr;
    if (this.sas) {
      // (العصاية سايبة وانت بطيء: الـ SAS بيوقّف الانجراف — بيميل عكس الحركة لحد ما تقف في مكانك)
      const hold = (1 - Math.min(1, Math.abs(sp) * 4)) * (1 - smooth(6, 12, Math.hypot(B.vel.x, B.vel.z)));
      const holdR = (1 - Math.min(1, Math.abs(sr) * 4)) * (1 - smooth(6, 12, Math.hypot(B.vel.x, B.vel.z)));
      const thT = sp * 0.35 + hold * clamp(0.06 * B.vel.dot(B.f), -0.15, 0.15);
      const phT = sr * 0.44 - holdR * clamp(0.06 * B.vel.dot(B.r), -0.15, 0.15);
      cp = clamp(2.6 * (B.pitch - thT) + 0.9 * B.w.q, -1, 1);
      cr = clamp(2.6 * (phT - B.bank) - 0.9 * B.w.p, -1, 1);
    } else { cp = -sp; cr = sr; }
    this.cp = cp; this.cr = cr;
    // ===== الدفع =====
    const v = B.vel, V = v.length(), vh = Math.hypot(v.x, v.z);
    const T0 = this.s.Tmax * this.coll * this.rpm * this.rpm;
    const vi = Math.sqrt(Math.max(T0, 1) / (2 * RHO * this.A)); // سرعة الهوا المسحوب في الحوم
    const vz = v.dot(B.u); // (موجب = طالع على محور الريشة)
    const climb = clamp(1 - 0.5 * vz / vi, 0.6, 1.3);
    const agl = this._agl ?? 10;
    const ge = 1 + 0.2 * Math.max(0, 1 - agl / this.R);
    const etl = 1 + 0.12 * smooth(4, 12, vh) - 0.05 * smooth(35, 65, vh);
    // دوامة الريشة: نزول أسرع من ~0.5 vi وانت واقف تقريبًا (< 8 م/ث لقدام) → الدفع بيقع
    const vrsOn = -vz > 0.5 * vi && vh < 8 && this.coll > 0.35;
    this.vrs = clamp(this.vrs + (vrsOn ? 0.8 : -1.2) * dt, 0, 1);
    const T = T0 * climb * ge * etl * (1 - 0.35 * this.vrs);
    this.thrust = T;
    // قرص الريشة: بيميل مع الـ cyclic (8° لقدام، 7° جنب) + بيرجع لورا شوية مع السرعة (flap-back)
    const vfw = v.dot(B.f);
    const n = _a.copy(B.u).addScaledVector(B.f, cp * 0.14 - clamp(vfw * 0.0018, -0.05, 0.08)).addScaledVector(B.r, cr * 0.12 - clamp(v.dot(B.r) * 0.0012, -0.04, 0.04)).normalize();
    B.forceAt(_b.copy(n).multiplyScalar(T), B.off(this.hub, _c));
    // ===== اللف: عزم الريشة الكبيرة (الأنف بيروح يمين مع الدفع) + ريشة الديل (البدالات) + SAS بيوقف اللف =====
    let ped = sy;
    if (this.sas) {
      // SAS: بيوقف اللف لوحده + بيمسك الاتجاه لما تسيب البدالات
      if (Math.abs(sy) > 0.05 || this.hdgRef == null) this.hdgRef = B.heading;
      let dh = B.heading - this.hdgRef; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      ped = clamp(sy + 1.4 * B.w.r - (Math.abs(sy) > 0.05 ? 0 : 1.2 * dh), -1, 1);
    }
    this.ped = ped;
    const r2 = this.rpm * this.rpm;
    const Mtq = -1600 * (this.coll - 0.55) * r2, Mtr = -4200 * ped * r2;
    // ===== سحب الجسم + الزعنفة اللي في الديل (بتعدل الأنف مع اتجاه الطيران) =====
    const vf = v.dot(B.f), vr = v.dot(B.r), vu = v.dot(B.u);
    const kD = 0.5 * RHO;
    B.force(_b.copy(B.f).multiplyScalar(-kD * vf * Math.abs(vf) * 1.6));
    B.force(_b.copy(B.r).multiplyScalar(-kD * vr * Math.abs(vr) * 5.5));
    B.force(_b.copy(B.u).multiplyScalar(-kD * vu * Math.abs(vu) * 9));
    const beta = V > 3 ? Math.asin(clamp(vr / V, -1, 1)) : 0, qbar = kD * V * V;
    B.moment(-2600 * B.w.p - 0.5 * qbar * beta, -4500 * B.w.q, Mtq + Mtr - 3000 * B.w.r - 3.5 * qbar * beta);
    B.force(_b.set(0, -this.s.m * G, 0));
    // ===== الأرض =====
    const res = (this.res = groundRes());
    const opt = { muSkid: 0.65 };
    for (const sk of this.skids) contact(B, sk, groundFn, opt, res);
    for (const bp of this.bodyPts) contact(B, bp, groundFn, opt, res);
    this.onGround = this.skids.some((s) => s.on);
    // الريشة خبطت في مبنى/أرض (من الجنب): تحطم
    if (groundFn.rotorHit) { const hubW = _d.copy(B.pos).add(B.off(this.hub, _c)); if (this.rpm > 0.3 && groundFn.rotorHit(hubW.x, hubW.y, hubW.z, this.R * 0.96)) this.crashed = 'rotor'; }
    if (res.water && res.pen > 0.3) this.crashed = 'water';
    else if (res.body) this.crashed = 'body';
    else if (res.sink > 3.6) this.crashed = 'hard';
    else if (res.pen > 0.9) this.crashed = 'obstacle';
    else if (this.onGround && (Math.abs(B.bank) > 0.6 || Math.abs(B.pitch) > 0.6)) this.crashed = 'rollover';
    this.touchSink = res.sink;
    B.integrate(dt);
  }
}

// ========================================================================================
//  الموديل (الرسم): من الـ asset + ريش بتلف (الهليكوبتر) + العجل بيتلم (الطيارة)
// ========================================================================================
export function buildAircraftRig(asset, kind) {
  const root = new THREE.Group(); root.name = 'aircraft-' + kind;
  const model = asset.instantiate().root; root.add(model);
  model.updateMatrixWorld(true);
  const rig = { root, model, kind };
  const box = new THREE.Box3().setFromObject(model, true);
  rig.size = box.getSize(new V3());
  if (kind === 'heli') {
    const mk = (name, axis) => {
      const o = model.getObjectByName(name); if (!o) return null;
      const b = new THREE.Box3().setFromObject(o, true), c = b.getCenter(new V3());
      const pivot = new THREE.Group(); pivot.name = name + '-pivot';
      root.worldToLocal(c); pivot.position.copy(c); root.add(pivot); pivot.updateMatrixWorld(true);
      pivot.attach(o);
      return { pivot, axis, size: b.getSize(new V3()), center: c };
    };
    rig.main = mk('rotor_main', 'y'); rig.tail = mk('rotor_tail', 'x');
    // قرص شفاف خفيف لما الريشة بتلف بسرعة (العين بتشوف دايرة مش ريشتين)
    if (rig.main) {
      const R = Math.max(rig.main.size.x, rig.main.size.z) / 2; rig.R = R;
      const disc = new THREE.Mesh(new THREE.CircleGeometry(R, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x222222, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
      disc.position.copy(rig.main.center); disc.renderOrder = 3; root.add(disc); rig.disc = disc;
    }
    // الزحافات: أوطى نقط في الموديل → 4 نقط (قدام/ورا × يمين/شمال)
    const low = []; model.traverse((m) => { if (!m.isMesh) return; const P = m.geometry.attributes.position, v = new V3();
      for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i).applyMatrix4(m.matrixWorld); if (v.y < box.min.y + 0.06) low.push(v.clone()); } });
    const side = (s) => low.filter((p) => Math.sign(p.x) === s);
    rig.skids = [];
    for (const s of [-1, 1]) { const L = side(s); if (!L.length) continue; L.sort((a, b) => a.z - b.z); const x = L.reduce((t, p) => t + p.x, 0) / L.length; rig.skids.push(new V3(x, 0, L[0].z + 0.15), new V3(x, 0, L[L.length - 1].z - 0.15)); }
    if (rig.skids.length < 4) rig.skids = [new V3(-1, 0, -1.6), new V3(-1, 0, 1.2), new V3(1, 0, -1.6), new V3(1, 0, 1.2)];
    const hub = rig.main ? rig.main.center.clone() : new V3(0, 3.5, -1);
    rig.hub = hub; rig.cg = new V3(0, 1.25, hub.z); // (مركز الثقل تحت الصاري بالظبط — زي الحقيقة) rig.tailZ = box.max.z - 0.6; rig.tailY = 1.6;
  } else {
    // العجل وأرجله: القطع الصغيرة الواطية جنب أماكن العجل — بتختفي لما العجل يتلم
    rig.gearMeshes = [];
    const G0 = PLANE_SPEC.gear.map((g) => g.p);
    model.traverse((m) => { if (!m.isMesh) return; const b = new THREE.Box3().setFromObject(m, true); const c = b.getCenter(new V3());
      if (b.max.y < 3.4 && b.min.y < 1.9 && G0.some(([x, , z]) => Math.hypot(c.x - x, c.z - z) < 1.9) && b.getSize(new V3()).length() < 5) rig.gearMeshes.push(m); });
  }
  model.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = false; } });
  return rig;
}

/** حدّث شكل الموديل من الفيزيا: المكان + الميل + لف الريش + العجل */
export function syncAircraftRig(rig, fdm, dt, cg) {
  const B = fdm.B, root = rig.root;
  root.quaternion.copy(B.q);
  root.position.copy(B.pos).sub(_a.copy(cg).applyQuaternion(B.q));
  if (rig.kind === 'heli') {
    const rpm = fdm.rpm;
    rig.ang = (rig.ang || 0) + rpm * 41 * dt; rig.tang = (rig.tang || 0) + rpm * 160 * dt;
    if (rig.main) rig.main.pivot.rotation.y = rig.ang % (Math.PI * 2);
    if (rig.tail) rig.tail.pivot.rotation.x = rig.tang % (Math.PI * 2);
    if (rig.disc) rig.disc.material.opacity = 0.16 * smooth(0.45, 0.9, rpm);
  } else if (rig.gearMeshes) {
    const vis = fdm.gearPos > 0.5;
    for (const m of rig.gearMeshes) m.visible = vis;
  }
  root.updateMatrixWorld(true);
}
