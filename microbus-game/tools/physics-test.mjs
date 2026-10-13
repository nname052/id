// اختبار سريع للفيزياء من غير متصفح: node tools/physics-test.mjs
import { VehiclePhysics, MICROBUS_SPEC } from '../src/physics/VehiclePhysics.js';

const dt = 1 / 120;
const v = new VehiclePhysics(MICROBUS_SPEC, () => 0);
const kmh = (ms) => (ms * 3.6).toFixed(1);
const log = (...a) => console.log(...a);

// 1) اتزان
for (let i = 0; i < 240; i++) v.step(dt, {});
log('settle heave', v.heave.toFixed(3), 'pitch', v.pitch.toFixed(4), 'loads', v.wheels.map((w) => w.load.toFixed(0)).join(','));

// 2) تسارع كامل
let t = 0, t60 = null, t100 = null, maxPitch = 0;
while (t < 40) {
  v.step(dt, { throttle: 1 }); t += dt;
  maxPitch = Math.max(maxPitch, v.pitch);
  if (!t60 && v.speed >= 60 / 3.6) t60 = t;
  if (!t100 && v.speed >= 100 / 3.6) t100 = t;
}
log('0-60', t60?.toFixed(1), 's  0-100', t100?.toFixed(1), 's  speed@40s', kmh(v.speed), 'gear', v.gear, 'rpm', v.rpm.toFixed(0), 'squat deg', (maxPitch * 57.3).toFixed(2));

// 3) فرملة من 60
v.reset(0, 0, 0);
for (let i = 0; i < 1200 && v.speed < 60 / 3.6; i++) v.step(dt, { throttle: 1 });
let z0 = v.z, minPitch = 0; t = 0;
while (v.speed > 0.1 && t < 10) { v.step(dt, { brake: 1 }); t += dt; minPitch = Math.min(minPitch, v.pitch); }
log('brake 60-0 dist', Math.abs(v.z - z0).toFixed(1), 'm time', t.toFixed(2), 'dive deg', (minPitch * 57.3).toFixed(2), 'final gear', v.gear);

// 4) ريوس
for (let i = 0; i < 240; i++) v.step(dt, { brake: 1 });
for (let i = 0; i < 360; i++) v.step(dt, { brake: 1 });
log('reverse gear', v.gear, 'speed', v.forwardSpeed.toFixed(2));

// 5) لف ثابت 40 كم/س
v.reset(0, 0, 0);
for (let i = 0; i < 2000; i++) { v.step(dt, { throttle: v.speed < 40 / 3.6 ? 0.6 : 0.15 }); }
let maxRoll = 0;
for (let i = 0; i < 600; i++) { v.step(dt, { throttle: v.speed < 40 / 3.6 ? 0.5 : 0.2, steer: 1 }); maxRoll = Math.max(maxRoll, Math.abs(v.roll)); }
log('turn 40kmh: speed', kmh(v.speed), 'yawRate', v.yawRate.toFixed(3), 'radius', (v.speed / Math.abs(v.yawRate)).toFixed(1), 'latG', (v.accelLat / 9.81).toFixed(2), 'roll deg', (maxRoll * 57.3).toFixed(2), 'steer', v.steer.toFixed(2), 'wheel deg', (v.steeringWheelAngle * 57.3).toFixed(0));

// 6) أقل نصف قطر لف في سرعة بطيئة
v.reset(0, 0, 0);
for (let i = 0; i < 400; i++) v.step(dt, { throttle: 0.3 });
for (let i = 0; i < 600; i++) v.step(dt, { throttle: v.speed < 2.5 ? 0.35 : 0, steer: 1 });
log('slow turn radius', (v.speed / Math.abs(v.yawRate)).toFixed(1), 'm  steering wheel deg', (v.steeringWheelAngle * 57.3).toFixed(0));

// 7) رجوع الدركسيون للمنتصف
for (let i = 0; i < 240; i++) v.step(dt, { throttle: 0.3 });
log('after release 2s steer', v.steer.toFixed(3));

// 8) فرامل اليد
v.reset(0, 0, 0);
for (let i = 0; i < 2000 && v.speed < 50 / 3.6; i++) v.step(dt, { throttle: 1 });
for (let i = 0; i < 60; i++) v.step(dt, { steer: 0.5 });
for (let i = 0; i < 120; i++) v.step(dt, { handbrake: 1, steer: 0.5 });
log('handbrake turn yawRate', v.yawRate.toFixed(2), 'speed', kmh(v.speed), 'skid', v.wheels.map((w) => w.skid.toFixed(2)).join(','));

// 9) مطب
const bump = (x, z) => { const d = z + 30; return Math.abs(d) < 0.45 ? 0.09 * 0.5 * (1 + Math.cos(Math.PI * d / 0.45)) : 0; };
const vb = new VehiclePhysics(MICROBUS_SPEC, bump);
for (let i = 0; i < 1200 && vb.speed < 25 / 3.6; i++) vb.step(dt, { throttle: 0.6 });
let maxH = 0, minH = 9, nan = false;
for (let i = 0; i < 600; i++) { vb.step(dt, { throttle: 0.2 }); maxH = Math.max(maxH, vb.heave); minH = Math.min(minH, vb.heave); if (!isFinite(vb.x)) nan = true; }
log('bump heave range', minH.toFixed(3), maxH.toFixed(3), 'z', vb.z.toFixed(1), 'nan?', nan);

// 10) اصطدام بحيطة
const wall = { cx: 0, cz: -20, hx: 10, hz: 0.5, angle: 0 };
const vc = new VehiclePhysics(MICROBUS_SPEC, () => 0);
for (let i = 0; i < 600; i++) vc.step(dt, { throttle: 0.7 }, () => [wall]);
log('wall: z', vc.z.toFixed(2), 'v', vc.forwardSpeed.toFixed(2), 'impact', vc.lastImpact.toFixed(2));
