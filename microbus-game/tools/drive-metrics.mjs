// قياس شخصية كل عربية: تسارع، أقصى سرعة، فرملة، ورجوع الدركسيون للنص
// node tools/drive-metrics.mjs
import { VehiclePhysics, MICROBUS_SPEC, TAXI_SPEC_BASE, TUKTUK_SPEC_BASE } from '../src/physics/VehiclePhysics.js';

const dt = 1 / 120;
const SPECS = { microbus: MICROBUS_SPEC, taxi: { ...MICROBUS_SPEC, ...TAXI_SPEC_BASE }, tuktuk: { ...MICROBUS_SPEC, ...TUKTUK_SPEC_BASE } };
for (const [kind, spec] of Object.entries(SPECS)) {
  const v = new VehiclePhysics(spec, () => 0);
  for (let i = 0; i < 240; i++) v.step(dt, {});
  let t = 0; const marks = {};
  while (t < 60) {
    v.step(dt, { throttle: 1 }); t += dt;
    for (const k of [30, 50, 80, 100]) if (!marks[k] && v.speed * 3.6 >= k) marks[k] = t.toFixed(1);
  }
  const top = (v.speed * 3.6).toFixed(0);
  // فرملة من 60
  v.reset(0, 0, 0); for (let i = 0; i < 240; i++) v.step(dt, {});
  for (let i = 0; i < 6000 && v.speed < 60 / 3.6; i++) v.step(dt, { throttle: 1 });
  let z0 = v.z, tb = 0; while (v.speed > 0.1 && tb < 10) { v.step(dt, { brake: 1 }); tb += dt; }
  const brake = Math.abs(v.z - z0).toFixed(1);
  // رجوع الدركسيون: لفة كاملة على سرعة ثابتة وبعدين نسيب
  const center = {};
  for (const kmh of [0, 15, 40]) {
    v.reset(0, 0, 0); for (let i = 0; i < 240; i++) v.step(dt, {});
    for (let i = 0; i < 6000 && v.speed < kmh / 3.6; i++) v.step(dt, { throttle: 1 });
    for (let i = 0; i < 120; i++) v.step(dt, { throttle: 0.3, steer: 1 });
    const w0 = v.steeringWheelAngle; let tc = 0;
    while (Math.abs(v.steeringWheelAngle) > Math.abs(w0) * 0.05 && tc < 8) { v.step(dt, { throttle: v.speed < kmh / 3.6 ? 0.4 : 0 }); tc += dt; }
    center[kmh] = tc.toFixed(2) + 's';
  }
  console.log(kind.padEnd(9), '0-30', marks[30], '0-50', marks[50], '0-80', marks[80], '0-100', marks[100], 'top', top, 'km/h | brake60', brake, 'm | center(0/15/40)', JSON.stringify(center));
}
