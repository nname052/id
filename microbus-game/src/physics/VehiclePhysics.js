// فيزياء الميكروباص: جسم صلب على المستوى (x,z,yaw) + تعليق مستقل لكل عجلة
// (heave / pitch / roll) + نموذج إطارات مبسط (Pacejka) + ناقل حركة أوتوماتيكي.
// الملف ده مش معتمد على Three.js عشان يتجرب لوحده (tools/physics-test.mjs).

import { obbOverlap } from './Collision.js';

const TIRE_K = 230000, TIRE_C = 900, WHEEL_M = 55; // كاوتش + كتلة العجلة والمحور (لكل عجلة)

// تاكسي سيدان (1.6 بنزين)
export const TAXI_SPEC_BASE = {
  mass: 1180, inertiaYaw: 1850, inertiaPitch: 1750, inertiaRoll: 470, cgHeight: 0.52,
  wheelBase: 2.64, cgToFront: 1.25, track: 1.44, wheelRadius: 0.315, // نص قطر كاوتش موديل الـ Seal بعد التحجيم (عشان العجلة متغطسش في الأرض)
  springK: 27000, damperBump: 2100, damperRebound: 2800, maxCompression: 0.12,
  tireMu: 1.0, tireB: 8.5, tireC: 1.45, rearLatGrip: 1.0, slideMu: 0.75, rollingResistance: 0.013,
  dragCoef: 0.53, brakeForce: 11500, brakeBiasFront: 0.65, handbrakeForce: 4200, // شيال السقف + سيدان قديمة
  maxSteer: 0.6, steeringRatio: 15,
  gears: [3.45, 1.95, 1.35, 1.0, 0.82], reverseRatio: 3.4, finalDrive: 4.1, drivetrainEff: 0.88,
  idleRpm: 800, maxRpm: 6300, shiftTime: 0.3, shift: [2600, 5800, 1500],
  torqueCurve: [[700, 95], [2000, 128], [3500, 148], [4500, 152], [5500, 140], [6400, 115]],
  halfWidth: 0.88, halfLength: 2.22, boxOffset: 0.07, roofHeight: 1.43,
  antiRollK: 19000, antiRollC: 1900,
};

// توكتوك (باجاج 200 سي سي، 3 عجلات)
export const TUKTUK_SPEC_BASE = {
  mass: 430, inertiaYaw: 280, inertiaPitch: 300, inertiaRoll: 110, cgHeight: 0.52,
  wheelBase: 2.0, cgToFront: 1.32, track: 1.14, trackFront: 0.06, wheelRadius: 0.225, // نفس مقاس موديل التوكتوك الحقيقي (أعرض شوية)
  // توجيه خفيف وهادي: الجادون بيتابع صباعك أبطأ، وزاوية العجلة بتقل بسرعة مع السرعة (عشان مايتقلبش)
  steerFollow: 20, steerRate: 13, steerFade: 0.013, steerMin: 0.2,
  springK: 9500, damperBump: 750, damperRebound: 1000, maxCompression: 0.09,
  tireMu: 0.84, tireB: 7, tireC: 1.4, rearLatGrip: 1.0, slideMu: 0.64, rollingResistance: 0.02,
  dragCoef: 0.5, brakeForce: 2900, brakeBiasFront: 0.45, handbrakeForce: 1500,
  maxSteer: 0.72, steeringRatio: 1.35, // جادون (handlebar) مش دركسيون: ±56 درجة
  gears: [3.1, 1.95, 1.35, 0.98], reverseRatio: 3.2, finalDrive: 10.5, drivetrainEff: 0.85,
  idleRpm: 1450, maxRpm: 7800, shiftTime: 0.25, shift: [3600, 7100, 2600],
  torqueCurve: [[1300, 11], [3000, 16.5], [5000, 19.5], [6500, 18.5], [7800, 13]],
  halfWidth: 0.76, halfLength: 1.35, boxOffset: -0.12, roofHeight: 1.72,
  antiRollK: 3600, antiRollC: 650,
};

export const MICROBUS_SPEC = {
  mass: 2500,              // كجم (ميكروباص هاي روف محمّل جزئيًا)
  inertiaYaw: 6600,
  inertiaPitch: 6200,
  inertiaRoll: 1650,
  cgHeight: 0.95,          // ارتفاع مركز الثقل عن الأرض
  wheelBase: 3.0,
  cgToFront: 1.5,          // المسافة من مركز الثقل للمحور الأمامي
  track: 1.66,
  wheelRadius: 0.33,
  springK: 52000,          // N/m لكل عجلة
  damperBump: 3600,
  damperRebound: 4800,
  maxCompression: 0.17,
  tireMu: 0.95,
  tireB: 7.5,
  tireC: 1.45,
  rearLatGrip: 1.0,
  slideMu: 0.72,           // احتكاك انزلاق (فرامل اليد)
  rollingResistance: 0.016,
  dragCoef: 0.85,          // 0.5 * rho * Cd * A
  brakeForce: 17500,       // أقصى قوة فرامل (N) كلها
  brakeBiasFront: 0.62,
  handbrakeForce: 7000,
  maxSteer: 0.62,          // rad عند العجلة (حوالي 35.5 درجة)
  steeringRatio: 15.2,     // لفة الدركسيون / لفة العجلة → 540 درجة (1.5 لفة) لكل ناحية
  // ناقل الحركة
  gears: [3.9, 2.3, 1.45, 1.0, 0.82],
  reverseRatio: 3.7,
  finalDrive: 3.9,
  drivetrainEff: 0.85,
  idleRpm: 780,
  maxRpm: 4300,
  shiftTime: 0.32,
  shift: [2100, 3700, 1200],
  // 2.5 ديزل تيربو (D-4D): عزم عالي بدري → تقيل بس بيشد كويس من تحت
  torqueCurve: [[600, 140], [1000, 200], [1600, 262], [2400, 268], [3200, 245], [3900, 200], [4400, 140]],
  // صندوق التصادم (نصف العرض، نصف الطول، إزاحة المركز للأمام)
  halfWidth: 0.95,
  halfLength: 2.64,
  boxOffset: -0.085,
};

const G = 9.81;
// شدّة أكتر من الأرقام الحقيقية (اللعبة كانت بتحس العربية بطيئة/رخمة): ×1.3 على عزم كل العربيات
const PUNCH = 1.3;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

function torqueAt(curve, rpm) {
  if (rpm <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    if (rpm <= curve[i][0]) {
      const [r0, t0] = curve[i - 1];
      const [r1, t1] = curve[i];
      return lerp(t0, t1, (rpm - r0) / (r1 - r0));
    }
  }
  return curve[curve.length - 1][1];
}

export class VehiclePhysics {
  constructor(spec = MICROBUS_SPEC, groundHeight = () => 0) {
    this.spec = spec;
    this.groundHeight = groundHeight;
    const s = spec;
    const a = s.cgToFront, b = s.wheelBase - s.cgToFront, t = s.track / 2, tf = (s.trackFront ?? s.track) / 2;
    // rx = يمين، rf = أمام (بالنسبة لمركز الثقل). التوكتوك: عجلة واحدة قدام = trackFront صغير جدًا
    this.wheels = [
      { id: 'FL', rx: -tf, rf: a, front: true },
      { id: 'FR', rx: tf, rf: a, front: true },
      { id: 'RL', rx: -t, rf: -b, front: false },
      { id: 'RR', rx: t, rf: -b, front: false },
    ].map((w) => ({
      ...w,
      staticLoad: (s.mass * G * (w.front ? b : a)) / s.wheelBase / 2,
      compression: 0, compressionVel: 0, load: 0,
      ground: 0, centerY: s.wheelRadius,
      spin: 0, spinVel: 0,
      slipLat: 0, slipLong: 0, skid: 0,
      worldX: 0, worldZ: 0,
    }));
    for (const w of this.wheels) {
      // طول السوستة الحر بحيث يكون الميكروباص في حالة اتزان على الأرض المستوية
      w.restLength = s.cgHeight - s.wheelRadius + w.staticLoad / s.springK + w.staticLoad / TIRE_K;
    }
    this.reset(0, 0, 0);
  }

  reset(x, z, yaw) {
    this.x = x; this.z = z; this.yaw = yaw;
    this.vx = 0; this.vz = 0; this.yawRate = 0;
    this.heave = this.spec.cgHeight + this.groundHeight(x, z); this.heaveVel = 0;
    this.pitch = 0; this.pitchVel = 0; this.roll = 0; this.rollVel = 0;
    this.steer = 0;          // -1..1 (موجب = شمال)
    this.steerSmooth = 0;
    this.wheelAngle = 0;     // زاوية الدركسيون (rad) موجب = شمال
    this.wheelVel = 0;
    this.switching = false;
    this.steerAngle = 0;     // زاوية العجلة الأمامية rad
    this.gear = 1;           // -1 = R, 0 = N, 1..5
    this.shiftTimer = 0;
    this.rpm = this.spec.idleRpm;
    this.throttle = 0; this.brake = 0; this.handbrake = 0;
    this.stoppedTimer = 0;
    this.accelLong = 0; this.accelLat = 0;
    this.lastImpact = 0;
    this.speed = 0; this.forwardSpeed = 0;
    this.flip = { mode: 0, theta: 0, omega: 0, corner: -1, rest: 0 };
    for (const w of this.wheels) { w.compression = 0; w.compressionVel = 0; w.spin = 0; w.spinVel = 0; w.load = w.staticLoad; w.y = undefined; w.ground = undefined; w.stepFx = 0; w.stepFz = 0; }
    this._settle();
  }

  _settle() {
    // نحسب الارتفاع المبدئي من غير ما الجسم ينط
    this.heave = this.spec.cgHeight + this.groundHeight(this.x, this.z);
  }

  get forward() { return [-Math.sin(this.yaw), -Math.cos(this.yaw)]; }
  get right() { return [Math.cos(this.yaw), -Math.sin(this.yaw)]; }

  /** صندوق التصادم (OBB) في الإحداثيات العالمية */
  getBox() {
    const [fx, fz] = this.forward;
    return {
      cx: this.x + fx * this.spec.boxOffset,
      cz: this.z + fz * this.spec.boxOffset,
      hx: this.spec.halfWidth, hz: this.spec.halfLength, angle: this.yaw,
    };
  }

  /**
   * الدركسيون — الحالة الأساسية هي زاوية الدركسيون نفسه (rad) زي العربية الحقيقية.
   * أوضاع الإدخال:
   *  - input.wheelHeld + input.wheelAngle: دركسيون اللمس الدائري (1:1 مع صباعك)
   *  - input.analog + input.steer: يد تحكم (-1..1)
   *  - input.steer بدون analog: كيبورد A/D (بيلف بمعدل ثابت)
   *  - مفيش إدخال: رجوع ذاتي للمنتصف (زنبرك + damping) قوته بتزيد مع السرعة
   */
  _updateSteering(dt, input) {
    const s = this.spec;
    const u = Math.abs(this.forwardSpeed);
    const maxWheel = s.maxSteer * s.steeringRatio; // ≈ 540 درجة
    if (input.wheelHeld) {
      const target = clamp(input.wheelAngle || 0, -maxWheel, maxWheel);
      const prev = this.wheelAngle;
      // متابعة شبه لحظية (ناعمة جدًا عشان مفيش رعشة)
      this.wheelAngle += (target - this.wheelAngle) * Math.min(1, dt * (s.steerFollow ?? 30));
      this.wheelVel = (this.wheelAngle - prev) / dt;
    } else if (input.analog && Math.abs(input.steer || 0) > 0.01) {
      const target = clamp(input.steer, -1, 1) * maxWheel;
      const prev = this.wheelAngle;
      this.wheelAngle += (target - this.wheelAngle) * Math.min(1, dt * 9);
      this.wheelVel = (this.wheelAngle - prev) / dt;
    } else if (Math.abs(input.steer || 0) > 0.01) {
      // كيبورد/أزرار: لفة سريعة وناعمة. أقصى لفة بتقل شوية مع السرعة (استقرار على السريع)
      // بس بتفضل كفاية للمناورة في السرعات البطيئة. العكس (من يمين لشمال) أسرع
      const ks = this.keySens ?? 1;
      const limit = 1 / (1 + u * 0.045);
      const target = clamp(input.steer, -1, 1) * maxWheel * limit;
      const rate = (maxWheel * 1.7 * ks) / (1 + u * 0.02);
      const diff = target - this.wheelAngle;
      const r = Math.sign(diff) !== Math.sign(this.wheelAngle) && Math.abs(this.wheelAngle) > 0.3 ? rate * 1.6 : rate;
      const prev = this.wheelAngle;
      this.wheelAngle += clamp(diff, -r * dt, r * dt);
      this.wheelVel = (this.wheelAngle - prev) / dt;
    } else {
      // رجوع ذاتي للنص لما تسيب: زنبرك حرج (من غير اهتزاز) سريع (~0.6 ثانية من لفة كاملة)،
      // مع حد أقصى لسرعة اللفة عشان مايبقاش "snap". أسرع شوية مع السرعة زي العربية الحقيقية
      const w = 7.5 + Math.min(u, 25) * 0.14;
      const acc = -w * w * this.wheelAngle - 2 * w * this.wheelVel;
      this.wheelVel += acc * dt;
      const vMax = maxWheel * 1.9; // أقصى سرعة رجوع (≈1000°/ث للميكروباص)
      this.wheelVel = clamp(this.wheelVel, -vMax, vMax);
      this.wheelAngle += this.wheelVel * dt;
      if (Math.abs(this.wheelAngle) < 0.002 && Math.abs(this.wheelVel) < 0.02) { this.wheelAngle = 0; this.wheelVel = 0; }
    }
    this.wheelAngle = clamp(this.wheelAngle, -maxWheel, maxWheel);
    // حساسية التوجيه بتقل مع السرعة (Variable ratio) لمنع الحركات العصبية
    // (التوكتوك: بتقل أسرع بكتير — عجلة واحدة قدام ومركز ثقل عالي، لفة جامدة في السرعة = انقلاب)
    const sens = Math.max(s.steerMin ?? 0.3, 1 / (1 + (s.steerFade ?? 0.0022) * u * u));
    const target = (this.wheelAngle / s.steeringRatio) * sens;
    this.steerAngle += (target - this.steerAngle) * Math.min(1, dt * (s.steerRate ?? 18));
    this.steer = this.wheelAngle / maxWheel;
    this.steerSmooth = this.steer;
  }

  get steeringWheelAngle() { return this.wheelAngle; }
  get maxWheelAngle() { return this.spec.maxSteer * this.spec.steeringRatio; }
  /** D / N / R للعرض */
  get gearMode() { return this.gear < 0 ? 'R' : this.shiftTimer > 0.2 && this.switching ? 'N' : 'D'; }

  _updateDrivetrain(dt, input) {
    const s = this.spec;
    const u = this.forwardSpeed;
    let throttleIn = clamp(input.throttle || 0, 0, 1);
    let brakeIn = clamp(input.brake || 0, 0, 1);
    // البنزين: آخر نقطة بتقطّع (الموتور بيكح)، ولما يخلص الموتور طافي (مفيش عزم خالص)
    if (this.starve > 0) {
      this._cutT = (this._cutT || 0) - dt;
      if (this._cutT <= -0.35 && Math.random() < dt * 5) this._cutT = 0.12 + Math.random() * 0.25;
      if (this._cutT > 0) throttleIn *= 0.08;
    }

    // منطق الريوس: لو واقف ودايس فرامل → ريوس. لو في ريوس ودايس بنزين → قدام
    // منطق ألعاب الموبايل: فرامل لحد الوقوف → استمرار الضغط شوية → ريوس. والعكس بالبنزين.
    // Dead-zone حوالين الصفر (0.35 م/ث) + مدة ضغط عشان ميبدّلش بين D و R كل شوية
    if (Math.abs(u) < 0.35 && this.shiftTimer <= 0) this.stoppedTimer += dt; else this.stoppedTimer = 0;
    if (this.gear > 0 && brakeIn > 0.1 && throttleIn < 0.1 && this.stoppedTimer > 0.4) {
      this.gear = -1; this.shiftTimer = 0.35; this.switching = true;
    } else if (this.gear < 0 && throttleIn > 0.1 && brakeIn < 0.1 && this.stoppedTimer > 0.3) {
      this.gear = 1; this.shiftTimer = 0.35; this.switching = true;
    }
    if (this.shiftTimer <= 0) this.switching = false;
    if (this.gear < 0) { const t = throttleIn; throttleIn = brakeIn; brakeIn = t; }

    this.shiftTimer = Math.max(0, this.shiftTimer - dt);
    const ratio = this.gear < 0 ? s.reverseRatio : s.gears[this.gear - 1];
    const total = ratio * s.finalDrive;
    const wheelRpm = (Math.abs(u) / s.wheelRadius) * 60 / (2 * Math.PI);
    let rpm = wheelRpm * total;
    // الدبرياج بيزحلق في السرعات البطيئة (انطلاق ناعم)
    const launch = s.idleRpm + throttleIn * 1400;
    if (this.gear === 1 || this.gear === -1) rpm = Math.max(rpm, lerp(rpm, launch, clamp(1 - wheelRpm * total / 1800, 0, 1)));
    rpm = Math.max(rpm, s.idleRpm);
    if (this.shiftTimer > 0) rpm = lerp(rpm, s.idleRpm + throttleIn * 900, 0.3);
    if (this.engineOff) { rpm = 0; throttleIn = 0; }
    this.rpm += (rpm - this.rpm) * Math.min(1, dt * (this.engineOff ? 3 : 12));

    // تغيير السرعات أوتوماتيك
    if (this.gear > 0 && this.shiftTimer <= 0 && !this.engineOff) {
      // نقط التغيير حسب نوع الموتور (ديزل الميكروباص بيغيّر بدري، البنزين والتوكتوك بيوصلوا لفات أعلى)
      const [upLo, upHi, down] = s.shift || [2300, 3800, 1250];
      const up = upLo + (upHi - upLo) * throttleIn;
      if (this.rpm > up && this.gear < s.gears.length) { this.gear++; this.shiftTimer = s.shiftTime; }
      else if (this.rpm < down && this.gear > 1) { this.gear--; this.shiftTimer = s.shiftTime * 0.7; }
    }

    let engineTorque = 0;
    if (this.shiftTimer <= 0 && !this.engineOff) {
      if (throttleIn > 0.01) {
        engineTorque = torqueAt(s.torqueCurve, this.rpm) * throttleIn * PUNCH;
        const limit = this.gear < 0 ? 1900 : s.maxRpm;
        if (this.rpm > limit) engineTorque *= clamp(1 - (this.rpm - limit) / 250, 0, 1);
      } else if (wheelRpm * total > s.idleRpm * 1.15) {
        engineTorque = -(18 + this.rpm * 0.011); // فرملة المحرك
      }
    }
    const dir = this.gear < 0 ? -1 : 1;
    this.driveForce = (engineTorque * total * s.drivetrainEff / s.wheelRadius) * dir;
    // فرملة المحرك لازم تكون عكس الحركة
    if (engineTorque < 0) this.driveForce = -Math.abs(this.driveForce) * Math.sign(u || 1);
    this.throttle = throttleIn;
    this.brake = brakeIn;
    this.handbrake = clamp(input.handbrake || 0, 0, 1);
  }

  step(dt, input, colliders) {
    const s = this.spec;
    const [fx, fz] = this.forward;
    const [rx, rz] = this.right;
    this.forwardSpeed = this.vx * fx + this.vz * fz;
    this._updateSteering(dt, input);
    this._updateDrivetrain(dt, input);
    if (this.flip.mode) { this._stepFlip(dt, colliders); return; }

    // ===== التعليق =====
    let springSum = 0, pitchT = 0, rollT = 0;
    // أرض نص العربية: العجلة اللي عدّت حرف كوبري/مطلع ماتقراش الأرض اللي تحت بمترات (كانت بتقلب العربية على جنبها)
    this._gC = this.groundHeight(this.x, this.z);
    for (const w of this.wheels) {
      const wx = this.x + rx * w.rx + fx * w.rf;
      const wz = this.z + rz * w.rx + fz * w.rf;
      w.worldX = wx; w.worldZ = wz;
      this._wheelContact(w, wx, wz, w.front ? this.yaw + this.steerAngle : this.yaw);
      const attachY = this.heave + w.rf * this.pitch + w.rx * this.roll;
      // العجلة ليها كتلة وكاوتش مرن (quarter-car): الخبطة بتتمص في الكاوتش والعجلة قبل ما توصل للجسم
      const top = w.ground + s.wheelRadius;
      if (w.y === undefined) { w.y = top - w.staticLoad / TIRE_K; w.vy = 0; w.compression = w.restLength - (attachY - w.y); }
      const length = attachY - w.y;
      const c = w.restLength - length;
      const cv = (c - w.compression) / dt;
      w.compression = c; w.compressionVel = cv;
      let f = 0;
      if (c > 0) {
        f = s.springK * c + (cv > 0 ? s.damperBump : s.damperRebound) * cv;
        // مصد الكاوتش (bump stop): بيمتص الطاقة (مش بيرجعها كلها) عشان العربية متتنططش
        if (c > s.maxCompression) {
          const over = c - s.maxCompression;
          f += over * s.springK * (cv > 0 ? 7 : 2.5) + (cv > 0 ? 2 : 0.6) * s.damperBump * cv * Math.min(1, over / 0.03);
        }
        f = Math.max(0, f);
      }
      const tc = top - w.y; // انضغاط الكاوتش
      const ft = tc > 0 ? Math.max(0, TIRE_K * tc + TIRE_C * -w.vy) : 0;
      w.vy += ((ft - f) / WHEEL_M - G) * dt;
      w.y += w.vy * dt;
      // الكاوتش ميتنضغطش أكتر من 7سم (الجنط) والعجلة متتدلاش أكتر من حدها
      if (w.y < top - 0.07) { w.y = top - 0.07; w.vy = Math.max(w.vy, 0); }
      const droop = attachY - w.restLength - 0.14;
      if (w.y < droop) { w.y = droop; w.vy = Math.max(w.vy, this.heaveVel); }
      w.load = tc > 0 ? Math.min(ft, f + w.staticLoad * 2) : 0; // قبضة الكاوتش من قوة الأرض
      w.centerY = Math.max(w.y, top - 0.03);
      springSum += f;
      pitchT += f * w.rf;
      rollT += f * w.rx;
    }

    // ===== الإطارات =====
    let Fx = 0, Fz = 0, torque = 0, fLong = 0, fLat = 0;
    const brakeTotal = this.brake * s.brakeForce;
    for (const w of this.wheels) {
      const px = rx * w.rx + fx * w.rf;
      const pz = rz * w.rx + fz * w.rf;
      const ang = this.yaw + (w.front ? this.steerAngle : 0);
      const wfx = -Math.sin(ang), wfz = -Math.cos(ang);
      const wrx = Math.cos(ang), wrz = -Math.sin(ang);
      const vpx = this.vx + this.yawRate * pz;
      const vpz = this.vz - this.yawRate * px;
      const vLong = vpx * wfx + vpz * wfz;
      const vLat = vpx * wrx + vpz * wrz;
      const Fzw = w.load;
      const mu = s.tireMu;

      let fl = 0;
      if (!w.front) fl += this.driveForce / 2;
      const bf = brakeTotal * (w.front ? s.brakeBiasFront : 1 - s.brakeBiasFront) / 2;
      fl -= bf * clamp(vLong / 0.35, -1, 1);
      fl -= s.rollingResistance * Fzw * clamp(vLong / 0.5, -1, 1);

      const alpha = Math.atan2(vLat, Math.max(Math.abs(vLong), 2.5));
      const grip = w.front ? 1 : s.rearLatGrip;
      let fy = -mu * grip * Fzw * Math.sin(s.tireC * Math.atan(s.tireB * alpha));

      // فرامل اليد: العجل الخلفي بيقفل ويتزحلق
      if (!w.front && this.handbrake > 0) {
        const sp = Math.hypot(vLong, vLat);
        const k = Math.max(sp, 0.6);
        const hb = this.handbrake;
        const slideL = -s.slideMu * Fzw * vLong / k;
        const slideT = -s.slideMu * Fzw * vLat / k;
        fl = lerp(fl, slideL, hb);
        fy = lerp(fy, slideT, hb);
      }
      // دائرة الاحتكاك
      const maxF = mu * Fzw;
      const mag = Math.hypot(fl, fy);
      let sat = 0;
      if (mag > maxF && mag > 0) { const k = maxF / mag; fl *= k; fy *= k; sat = 1; }
      const spdW = Math.abs(vLong);
      w.skid = clamp(Math.max(
        (Math.abs(alpha) - 0.09) * 4 * (spdW > 3 ? 1 : 0),
        sat * clamp(Math.hypot(vLong, vLat) / 5, 0, 1) * 0.8,
        !w.front ? this.handbrake * clamp(spdW / 4, 0, 1) : 0), 0, 1);
      w.slipLat = alpha;

      // حرف رصيف قدام/ورا العجلة: رد فعل مايل بيقاوم الطلوع (وبيزق لقدام وهي نازلة)
      const sf = Math.min(Fzw, 2 * w.staticLoad);
      const wx = wfx * fl + wrx * fy + w.stepFx * sf;
      const wz = wfz * fl + wrz * fy + w.stepFz * sf;
      Fx += wx; Fz += wz;
      torque += pz * wx - px * wz;
      fLong += wx * fx + wz * fz;
      fLat += wx * rx + wz * rz;

      // دوران العجل (شكلي)
      const locked = !w.front && this.handbrake > 0.5;
      w.spinVel = locked ? 0 : vLong / s.wheelRadius;
      w.spin += w.spinVel * dt;
    }

    // الجاذبية على المطالع والنزلات (كباري / جبل)
    {
      const W = this.wheels;
      const gF = (W[0].ground + W[1].ground) / 2, gR = (W[2].ground + W[3].ground) / 2;
      const gL = (W[0].ground + W[2].ground) / 2, gRt = (W[1].ground + W[3].ground) / 2;
      const slopeF = (gF - gR) / s.wheelBase, slopeR = (gRt - gL) / s.track;
      if (Math.abs(slopeF) < 0.4 && Math.abs(slopeR) < 0.4) {
        const fl = -s.mass * G * slopeF / Math.sqrt(1 + slopeF * slopeF);
        const fr = -s.mass * G * slopeR / Math.sqrt(1 + slopeR * slopeR) * 0.6;
        Fx += fx * fl + rx * fr; Fz += fz * fl + rz * fr;
      }
    }
    // مقاومة الهوا
    const sp = Math.hypot(this.vx, this.vz);
    Fx -= s.dragCoef * sp * this.vx;
    Fz -= s.dragCoef * sp * this.vz;

    // ===== التكامل =====
    const ax = Fx / s.mass, az = Fz / s.mass;
    this.vx += ax * dt; this.vz += az * dt;
    this.yawRate += (torque / s.inertiaYaw) * dt;
    // ثبات في السرعات شبه الصفرية
    if (sp < 0.05 && Math.abs(this.driveForce) < 1 && this.brake + this.handbrake > 0) { this.vx *= 0.5; this.vz *= 0.5; this.yawRate *= 0.5; }
    this.x += this.vx * dt; this.z += this.vz * dt;
    this.yaw += this.yawRate * dt;

    this.accelLong = fLong / s.mass;
    this.accelLat = fLat / s.mass;

    // الحركة الرأسية (heave / pitch / roll) + انتقال الوزن
    const heaveAcc = springSum / s.mass - G;
    const pitchAcc = (pitchT + s.cgHeight * fLong * 0.85) / s.inertiaPitch;
    // عمود التوازن (anti-roll bar): بيقلل الميلان والمرجحة في اللفات
    const arb = -(s.antiRollK ?? 52000) * this.roll - (s.antiRollC ?? 5200) * this.rollVel;
    const rollAcc = (rollT + s.cgHeight * fLat * 0.85 + arb) / s.inertiaRoll;
    // سقف أمان: مفيش مطب/حرف (ولا غلطة في ارتفاع الأرض) يقذف العربية لفوق زي الصاروخ (كانت بتطير 18م وتتقلب)
    this.heaveVel = Math.min(this.heaveVel + heaveAcc * dt, 3.5); this.heave += this.heaveVel * dt;
    this.pitchVel = Math.max(-2.2, Math.min(2.2, this.pitchVel + pitchAcc * dt)); this.pitch += this.pitchVel * dt;
    this.rollVel += rollAcc * dt; this.roll += this.rollVel * dt;
    // تخميد بسيط للدوران الزائد
    this.pitchVel *= 1 - 0.6 * dt; this.rollVel *= 1 - 0.6 * dt;
    // بداية انقلاب: العجلتين اللي فوق سابوا الأرض والميل كبير → فيزياء دوران حوالين الحرف
    if (Math.abs(this.roll) > 0.3) {
      const up = this.roll > 0 ? 1 : -1; // الجنب اللي طالع لفوق (+ = اليمين)
      const lifted = this.wheels.filter((w) => Math.sign(w.rx) === up && Math.abs(w.rx) > 0.2).every((w) => w.load < 40 * (this.spec.mass / 2250));
      if (lifted && this.rollVel * up > -0.2) this._enterFlip();
    }
    // أمان: لو الجسم نزل تحت الأرض
    const minH = this.groundHeight(this.x, this.z) + 0.35;
    if (this.heave < minH) { this.heave = minH; this.heaveVel = Math.max(0, this.heaveVel); }

    if (colliders) this._collide(colliders);

    this.speed = Math.hypot(this.vx, this.vz);
    this.forwardSpeed = this.vx * fx + this.vz * fz;
    this.lastImpact = Math.max(0, this.lastImpact - dt * 4);
  }

  /** تلامس العجلة (دايرة) مع الأرض على خط اتجاهها: بيخلي العجلة تطلع على حرف الرصيف تدريجيًا
   *  ويحسب ميل نقطة التلامس (stepTan) اللي بيعمل مقاومة الطلوع أو الخبطة لو السرعة عالية. */
  _wheelContact(w, wx, wz, ang) {
    const R = this.spec.wheelRadius, gh = this.groundHeight;
    const hx = -Math.sin(ang), hz = -Math.cos(ang);
    const g0 = gh(wx, wz);
    const gA = gh(wx + hx * R * 0.92, wz + hz * R * 0.92), gB = gh(wx - hx * R * 0.92, wz - hz * R * 0.92);
    let need = g0 + R, bestD = 0;
    // عرض الكاوتش: لو حرف الرصيف تحت جنب الكاوتش (داخل عليه بالجنب أو مايل) العجلة بتطلع من ساعتها،
    // مش لما نص العجلة يبقى جوه الرصيف
    const tw = 0.11, rxw = Math.cos(ang), rzw = -Math.sin(ang);
    const gL = gh(wx - rxw * tw, wz - rzw * tw), gR = gh(wx + rxw * tw, wz + rzw * tw);
    if (gL > g0 + 0.02 || gR > g0 + 0.02) need = Math.max(need, Math.max(gL, gR) + R);
    if (Math.abs(gA - g0) > 0.02 || Math.abs(gB - g0) > 0.02) {
      for (let k = -12; k <= 12; k++) {
        if (!k) continue;
        const d = (k / 12) * R * 0.92;
        const n = gh(wx + hx * d, wz + hz * d) + Math.sqrt(R * R - d * d);
        if (n > need) { need = n; bestD = d; }
      }
    }
    const prev = w.ground ?? g0;
    // ولا سطح أعلى بكتير لازق جنبها (الكوبري التاني في الاتجاه العكسي أعلى بـ 40سم = عجلتين بيطلعوا فجأة = انقلاب)
    // (حرف رصيف عادي 15-20سم لسه بيتطلع عادي)
    if (this._gC !== undefined) need = Math.max(this._gC - 0.45, Math.min(this._gC + 0.3, need - R)) + R;
    w.ground = need - R;
    w.stepFx = 0; w.stepFz = 0;
    if (bestD) {
      const tan = clamp(Math.abs(bestD) / Math.sqrt(R * R - bestD * bestD), 0, 1.7);
      // اتجاه الحرف: ميل الأرض عند نقطة التلامس (نازل من الرصيف للشارع)
      const px = wx + hx * bestD, pz = wz + hz * bestD, e = 0.12;
      let nx = gh(px - e, pz) - gh(px + e, pz), nz = gh(px, pz - e) - gh(px, pz + e);
      const nl = Math.hypot(nx, nz);
      if (nl > 1e-4) { nx /= nl; nz /= nl; } else { nx = -hx * Math.sign(bestD); nz = -hz * Math.sign(bestD); }
      // لو داخل على الحرف بزاوية مايلة: المقاومة أقل والعربية بتتزق لبره شوية بدل ما تقف
      const c = Math.abs(hx * nx + hz * nz);
      w.stepFx = nx * tan * c; w.stepFz = nz * tan * c;
    }
    // خبطة في حرف (للصوت/الكاميرا/الضرر): ارتفاع مفاجئ والعربية ماشية
    const rise = w.ground - prev;
    if (rise > 0.035 && this.onCurb) this.onCurb(rise, Math.abs(this.forwardSpeed), w);
  }

  // ===================== الانقلاب =====================
  // مقطع العربية (من ورا): مستطيل عرضه العجل تحت والصاج فوق، بيلف حوالين أوطى ركن لامس الأرض.
  _corners(theta, out) {
    const s = this.spec, a = s.track / 2, W = s.halfWidth, h = s.cgHeight, top = (s.roofHeight || 1.95) - h;
    const c = Math.cos(theta), sn = Math.sin(theta);
    const pts = [[-a, -h], [a, -h], [W, top], [-W, top]]; // تحت شمال، تحت يمين، فوق يمين، فوق شمال
    for (let i = 0; i < 4; i++) { const [x, y] = pts[i]; out[i * 2] = x * c - y * sn; out[i * 2 + 1] = x * sn + y * c; }
    return out;
  }

  _enterFlip() {
    const f = this.flip;
    f.mode = 1; f.theta = this.roll; f.omega = this.rollVel; f.corner = -1; f.rest = 0;
    for (const w of this.wheels) { w.load = 0; w.skid = 0; }
  }

  get flipped() { return this.flip.mode === 1 && Math.abs(Math.atan2(Math.sin(this.flip.theta), Math.cos(this.flip.theta))) > 0.9; }

  /** يعدل العربية في مكانها (بعد ما تتقلب) */
  recover() {
    const { x, z, yaw } = this;
    this.reset(x, z, yaw);
  }

  _stepFlip(dt, colliders) {
    const s = this.spec, f = this.flip, m = s.mass;
    const [fx, fz] = this.forward, [rx, rz] = this.right;
    const C = (this._cbuf ||= new Float32Array(8));
    this._corners(f.theta, C);
    // أوطى ركن = نقطة الارتكاز
    let lo = 0;
    for (let i = 1; i < 4; i++) if (C[i * 2 + 1] < C[lo * 2 + 1] - 1e-4 || (Math.abs(C[i * 2 + 1] - C[lo * 2 + 1]) < 1e-4 && Math.sign(C[i * 2]) === Math.sign(f.omega))) lo = i;
    const xp = C[lo * 2], yp = C[lo * 2 + 1];
    // ركن جديد خبط في الأرض: فقد طاقة + خبطة (صوت/ضرر)
    if (f.corner >= 0 && lo !== f.corner) {
      const hit = Math.abs(f.omega) * Math.hypot(xp, yp);
      f.omega *= lo >= 2 || f.corner >= 2 ? 0.5 : 0.62;
      if (hit > 0.8 && this.onRollHit) this.onRollHit(hit, lo, f.theta);
      this.lastImpact = Math.max(this.lastImpact, hit);
    }
    f.corner = lo;
    const thetaN = Math.atan2(Math.sin(f.theta), Math.cos(f.theta));
    const onWheels = Math.abs(thetaN) < 0.75;
    // قوى الأرض الجانبية (كاوتش لو لسه على العجل، صاج بيتزحلق لو على جنبه/سقفه)
    const vLong = this.vx * fx + this.vz * fz, vLat = this.vx * rx + this.vz * rz;
    const sp = Math.hypot(vLong, vLat);
    let FLat, FLong;
    if (onWheels) {
      FLat = -clamp(vLat * 2600, -0.8 * m * G, 0.8 * m * G);
      const drive = this.flip.corner <= 1 ? this.driveForce * 0.5 : 0;
      FLong = drive - this.brake * s.brakeForce * 0.5 * clamp(vLong / 0.4, -1, 1) - 0.02 * m * G * clamp(vLong / 0.5, -1, 1);
    } else {
      const mu = 0.55 * m * G / Math.max(sp, 0.4);
      FLat = -vLat * mu; FLong = -vLong * mu;
    }
    // دوران حوالين الركن: الجاذبية + القوة الجانبية عند الأرض
    const Ip = s.inertiaRoll + m * (xp * xp + yp * yp);
    const tau = m * G * xp - yp * FLat;
    f.omega += (tau / Ip) * dt;
    // لسه على عجلتين: المساعدين والكاوتش بيمتصوا جزء من الدوران
    f.omega *= 1 - (onWheels ? 2.2 : 0.25) * dt;
    // واقفة على وش (ركنين لامسين) ومفيش حركة تقريبًا → تستقر
    let second = 99;
    for (let i = 0; i < 4; i++) if (i !== lo) second = Math.min(second, C[i * 2 + 1] - yp);
    if (second < 0.02 && Math.abs(f.omega) < 0.5) { f.omega = 0; f.rest += dt; } else f.rest = 0;
    f.theta += f.omega * dt;
    // رجعت على عجلها
    if (Math.abs(thetaN) < 0.18 && Math.abs(f.omega) < 2.5 && lo <= 1) {
      f.mode = 0; this.roll = thetaN; this.rollVel = f.omega * 0.5; f.rest = 0;
      for (const w of this.wheels) { w.y = undefined; w.ground = undefined; }
      return;
    }
    // الحركة على الأرض
    this.vx += ((fx * FLong + rx * FLat) / m) * dt;
    this.vz += ((fz * FLong + rz * FLat) / m) * dt;
    this.yawRate *= 1 - (onWheels ? 1.5 : 3) * dt;
    this.x += this.vx * dt; this.z += this.vz * dt;
    this.yaw += this.yawRate * dt;
    this.accelLat = FLat / m; this.accelLong = FLong / m;
    // الارتفاع: أوطى ركن على الأرض
    const g = this.groundHeight(this.x, this.z);
    this.heave = g - yp; this.heaveVel = 0;
    this.roll = f.theta; this.rollVel = f.omega;
    this.pitch *= 1 - 3 * dt; this.pitchVel = 0;
    for (const w of this.wheels) { w.load = 0; w.compressionVel = 0; w.skid = 0; w.spinVel *= 1 - dt; w.spin += w.spinVel * dt; }
    if (colliders) this._collide(colliders);
    this.speed = Math.hypot(this.vx, this.vz);
    this.forwardSpeed = this.vx * fx + this.vz * fz;
    this.lastImpact = Math.max(0, this.lastImpact - dt * 4);
  }

  /** تطبيق دفعة (impulse) عند نقطة */
  applyImpulse(px, pz, jx, jz) {
    const rX = px - this.x, rZ = pz - this.z;
    this.vx += jx / this.spec.mass;
    this.vz += jz / this.spec.mass;
    this.yawRate += (rZ * jx - rX * jz) / this.spec.inertiaYaw;
  }

  _collide(colliders) {
    const s = this.spec;
    for (let iter = 0; iter < 2; iter++) {
      const box = this.getBox();
      const list = colliders(box);
      for (const other of list) {
        const hit = obbOverlap(box, other);
        if (!hit) continue;
        const { nx, nz, depth, px, pz } = hit; // n من الميكروباص للجسم التاني
        const invB = other.mass ? 1 / other.mass : 0;
        const share = invB > 0 ? (1 / s.mass) / (1 / s.mass + invB) : 1;
        this.x -= nx * depth * share; this.z -= nz * depth * share;
        box.cx -= nx * depth * share; box.cz -= nz * depth * share;
        if (invB > 0 && other.onPush) other.onPush(nx * depth * (1 - share), nz * depth * (1 - share));

        const rX = px - this.x, rZ = pz - this.z;
        let vpx = this.vx + this.yawRate * rZ;
        let vpz = this.vz - this.yawRate * rX;
        if (other.vx !== undefined) { vpx -= other.vx; vpz -= other.vz; }
        const vn = vpx * nx + vpz * nz;
        if (vn <= 0) continue;
        const k = rZ * nx - rX * nz;
        const e = other.restitution ?? 0.18;
        const j = ((1 + e) * vn) / (1 / s.mass + invB + (k * k) / s.inertiaYaw);
        this.applyImpulse(px, pz, -nx * j, -nz * j);
        // خبطة من الجنب (تحت مركز الثقل): بتميّل العربية وممكن تقلبها لو جامدة
        {
          const [rxB, rzB] = this.right;
          const jl = -(nx * rxB + nz * rzB) * j; // + = زقة ناحية اليمين
          // سور/حيطة ثابتة (مش عربية): بتزحلق العربية جنبها، مش بتقلبها (كانت بتنام على جنبها جنب سور الكوبري)
          const lever = Math.max(0.15, s.cgHeight - 0.45) * (invB > 0 ? 1 : 0.25);
          if (this.flip.mode) this.flip.omega += (jl * lever) / (s.inertiaRoll * 3);
          else this.rollVel += (jl * lever) / (s.inertiaRoll * 1.6);
        }
        // احتكاك تماسي
        const tx = -nz, tz = nx;
        const vt = vpx * tx + vpz * tz;
        const kt = rZ * tx - rX * tz;
        let jt = -vt / (1 / s.mass + invB + (kt * kt) / s.inertiaYaw);
        const mu = 0.35;
        jt = clamp(jt, -mu * j, mu * j);
        this.applyImpulse(px, pz, tx * jt, tz * jt);
        const impactSpeed = vn;
        this.lastImpact = Math.max(this.lastImpact, impactSpeed);
        if (this.onImpact) this.onImpact(impactSpeed, px, pz, other, nx, nz);
        if (other.onHit) other.onHit(j / s.mass, nx * j - tx * jt, nz * j - tz * jt, px, pz); // الدفعة اللي راحت للجسم التاني
      }
    }
  }
}
