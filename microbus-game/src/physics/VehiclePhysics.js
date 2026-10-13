// فيزياء الميكروباص: جسم صلب على المستوى (x,z,yaw) + تعليق مستقل لكل عجلة
// (heave / pitch / roll) + نموذج إطارات مبسط (Pacejka) + ناقل حركة أوتوماتيكي.
// الملف ده مش معتمد على Three.js عشان يتجرب لوحده (tools/physics-test.mjs).

import { obbOverlap } from './Collision.js';

export const MICROBUS_SPEC = {
  mass: 2350,              // كجم (ميكروباص محمّل جزئيًا)
  inertiaYaw: 5600,
  inertiaPitch: 5200,
  inertiaRoll: 1500,
  cgHeight: 0.92,          // ارتفاع مركز الثقل عن الأرض
  wheelBase: 2.6,
  cgToFront: 1.25,         // المسافة من مركز الثقل للمحور الأمامي
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
  steeringRatio: 16.5,     // لفة الدركسيون / لفة العجلة → حوالي 1.6 لفة لكل ناحية
  // ناقل الحركة
  gears: [3.9, 2.3, 1.45, 1.0, 0.82],
  reverseRatio: 3.7,
  finalDrive: 3.9,
  drivetrainEff: 0.85,
  idleRpm: 780,
  maxRpm: 4300,
  shiftTime: 0.45,
  torqueCurve: [[600, 130], [1000, 175], [1600, 222], [2200, 235], [3000, 225], [3800, 190], [4400, 130]],
  // صندوق التصادم (نصف العرض، نصف الطول، إزاحة المركز للأمام)
  halfWidth: 0.95,
  halfLength: 2.48,
  boxOffset: -0.13,
};

const G = 9.81;
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
    const a = s.cgToFront, b = s.wheelBase - s.cgToFront, t = s.track / 2;
    // rx = يمين، rf = أمام (بالنسبة لمركز الثقل)
    this.wheels = [
      { id: 'FL', rx: -t, rf: a, front: true },
      { id: 'FR', rx: t, rf: a, front: true },
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
      w.restLength = s.cgHeight - s.wheelRadius + w.staticLoad / s.springK;
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
    this.steerAngle = 0;     // زاوية العجلة الأمامية rad
    this.gear = 1;           // -1 = R, 0 = N, 1..5
    this.shiftTimer = 0;
    this.rpm = this.spec.idleRpm;
    this.throttle = 0; this.brake = 0; this.handbrake = 0;
    this.stoppedTimer = 0;
    this.accelLong = 0; this.accelLat = 0;
    this.lastImpact = 0;
    this.speed = 0; this.forwardSpeed = 0;
    for (const w of this.wheels) { w.compression = 0; w.compressionVel = 0; w.spin = 0; w.spinVel = 0; w.load = w.staticLoad; }
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
   * تحديث الدركسيون: input.steer (-1..1)، input.analog = true للجيم باد
   */
  _updateSteering(dt, input) {
    const u = Math.abs(this.forwardSpeed);
    // كل ما السرعة تزيد، أقصى لفة مسموحة تقل (زي العربيات الحقيقية مع السواق)
    const speedLimit = 1 / (1 + 0.0032 * u * u);
    const target = clamp(input.steer || 0, -1, 1) * speedLimit;
    if (input.analog) {
      this.steer += (target - this.steer) * Math.min(1, dt * 10);
    } else if (Math.abs(input.steer || 0) > 0.01) {
      // ضغط مستمر على A/D: الدركسيون بيلف بمعدل ثابت (أبطأ في السرعات العالية)
      const rate = 1.25 / (1 + u * 0.045);
      const diff = target - this.steer;
      // لو بنعكس الاتجاه نرجع أسرع شوية
      const r = Math.sign(diff) !== Math.sign(this.steer) && Math.abs(this.steer) > 0.05 ? rate * 1.8 : rate;
      this.steer += clamp(diff, -r * dt, r * dt);
    } else {
      // رجوع تلقائي للمنتصف حسب سرعة العربية (Caster / self-aligning torque)
      const ret = 0.12 + u * 0.11;
      this.steer -= clamp(this.steer, -ret * dt, ret * dt);
    }
    this.steer = clamp(this.steer, -1, 1);
    // نعومة إضافية للحركة (critically damped) عشان الدركسيون ميقفزش
    this.steerSmooth += (this.steer - this.steerSmooth) * Math.min(1, dt * 12);
    this.steerAngle = this.steerSmooth * this.spec.maxSteer;
  }

  get steeringWheelAngle() { return this.steerAngle * this.spec.steeringRatio; }

  _updateDrivetrain(dt, input) {
    const s = this.spec;
    const u = this.forwardSpeed;
    let throttleIn = clamp(input.throttle || 0, 0, 1);
    let brakeIn = clamp(input.brake || 0, 0, 1);

    // منطق الريوس: لو واقف ودايس فرامل → ريوس. لو في ريوس ودايس بنزين → قدام
    if (Math.abs(u) < 0.4 && this.shiftTimer <= 0) this.stoppedTimer += dt; else this.stoppedTimer = 0;
    if (this.gear > 0 && brakeIn > 0.1 && throttleIn < 0.1 && this.stoppedTimer > 0.35) {
      this.gear = -1; this.shiftTimer = 0.3;
    } else if (this.gear < 0 && throttleIn > 0.1 && brakeIn < 0.1 && this.stoppedTimer > 0.2) {
      this.gear = 1; this.shiftTimer = 0.3;
    }
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
    this.rpm += (rpm - this.rpm) * Math.min(1, dt * 12);

    // تغيير السرعات أوتوماتيك
    if (this.gear > 0 && this.shiftTimer <= 0) {
      const up = 2300 + 1500 * throttleIn;
      if (this.rpm > up && this.gear < s.gears.length) { this.gear++; this.shiftTimer = s.shiftTime; }
      else if (this.rpm < 1250 && this.gear > 1) { this.gear--; this.shiftTimer = s.shiftTime * 0.7; }
    }

    let engineTorque = 0;
    if (this.shiftTimer <= 0) {
      if (throttleIn > 0.01) {
        engineTorque = torqueAt(s.torqueCurve, this.rpm) * throttleIn;
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

    // ===== التعليق =====
    let springSum = 0, pitchT = 0, rollT = 0;
    for (const w of this.wheels) {
      const wx = this.x + rx * w.rx + fx * w.rf;
      const wz = this.z + rz * w.rx + fz * w.rf;
      w.worldX = wx; w.worldZ = wz;
      w.ground = this.groundHeight(wx, wz);
      const attachY = this.heave + w.rf * this.pitch + w.rx * this.roll;
      const length = attachY - (w.ground + s.wheelRadius);
      const c = w.restLength - length;
      const cv = (c - w.compression) / dt;
      w.compression = c; w.compressionVel = cv;
      let f = 0;
      if (c > 0) {
        f = s.springK * c + (cv > 0 ? s.damperBump : s.damperRebound) * cv;
        if (c > s.maxCompression) f += (c - s.maxCompression) * s.springK * 12; // مصد (bump stop)
        f = Math.max(0, f);
      }
      w.load = f;
      w.centerY = Math.max(w.ground + s.wheelRadius, attachY - w.restLength - 0.05);
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

      const wx = wfx * fl + wrx * fy;
      const wz = wfz * fl + wrz * fy;
      Fx += wx; Fz += wz;
      torque += pz * wx - px * wz;
      fLong += wx * fx + wz * fz;
      fLat += wx * rx + wz * rz;

      // دوران العجل (شكلي)
      const locked = !w.front && this.handbrake > 0.5;
      w.spinVel = locked ? 0 : vLong / s.wheelRadius;
      w.spin += w.spinVel * dt;
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
    const rollAcc = (rollT + s.cgHeight * fLat * 0.85) / s.inertiaRoll;
    this.heaveVel += heaveAcc * dt; this.heave += this.heaveVel * dt;
    this.pitchVel += pitchAcc * dt; this.pitch += this.pitchVel * dt;
    this.rollVel += rollAcc * dt; this.roll += this.rollVel * dt;
    // تخميد بسيط للدوران الزائد
    this.pitchVel *= 1 - 0.6 * dt; this.rollVel *= 1 - 0.6 * dt;
    // أمان: لو الجسم نزل تحت الأرض
    const minH = this.groundHeight(this.x, this.z) + 0.35;
    if (this.heave < minH) { this.heave = minH; this.heaveVel = Math.max(0, this.heaveVel); }

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
        if (this.onImpact) this.onImpact(impactSpeed, px, pz, other);
        if (other.onHit) other.onHit(j / s.mass);
      }
    }
  }
}
