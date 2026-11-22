// اختبار موديلات الطيران من غير متصفح (node): إقلاع/صعود/انهيار/هبوط للطيارة + حوم/طيران/هبوط للهليكوبتر.
//   node tools/tests/fdm-sim.mjs
import * as THREE from 'three';
import { PlaneFDM, HeliFDM } from '../../src/vehicles/Aircraft.js';
const DT = 1 / 120, flat = (x, z) => ({ y: 0 });
const deg = (r) => (r * 180 / Math.PI).toFixed(1);
const out = {}; let ok = true; const check = (name, cond, info) => { out[name] = { pass: !!cond, ...info }; if (!cond) ok = false; };

// ===== الطيارة: إقلاع =====
{
  const P = new PlaneFDM(); P.place(0, 0, 0, 0);
  // ثبات على الأرض
  for (let i = 0; i < 240; i++) P.step(DT, { thr: 0 }, flat);
  const rest = { y: P.B.pos.y.toFixed(2), pitch: deg(P.B.pitch), comp: P.gear.map((g) => g.comp.toFixed(2)).join('/') };
  let t = 0, liftX = null, liftV = null, rotT = null, maxA = 0;
  const z0 = P.B.pos.z;
  for (; t < 90; t += DT) {
    const V = P.V, th = P.B.pitch;
    let pitch = 0;
    if (V > 72) { rotT ??= t; pitch = th < 0.16 ? 0.7 : 0; }
    if (P.airT > 2) pitch = th < 0.15 ? 0.4 : th > 0.19 ? -0.4 : 0;
    if (P.airT > 3 && P.gearDown) P.toggleGear();
    P.step(DT, { thr: 1, pitch }, flat);
    if (!P.onGround && liftX === null) { liftX = Math.abs(P.B.pos.z - z0); liftV = P.V; }
    maxA = Math.max(maxA, P.alpha);
    if (P.crashed) break;
  }
  check('plane_takeoff', !P.crashed && liftX > 700 && liftX < 2300 && P.B.pos.y > 150, { rest, liftoffDist: liftX?.toFixed(0), liftoffKt: (liftV * 1.944).toFixed(0), alt90s: P.B.pos.y.toFixed(0), kt: (P.V * 1.944).toFixed(0), maxAlphaDeg: deg(maxA), crashed: P.crashed });
}
// ===== الطيارة: طيران مستقيم بالـ Normal Law (العصاية سايبة) + لف 25° + شدّ لآخره (حماية الانهيار) =====
{
  const P = new PlaneFDM(); P.place(0, 0, 0, 0, { alt: 900, speed: 125 });
  P.throttle = 0.55;
  const y0 = P.B.pos.y;
  for (let i = 0; i < 120 * 30; i++) P.step(DT, { thr: 0.55 }, flat);
  const lvl = { dAlt: (P.B.pos.y - y0).toFixed(0), pitch: deg(P.B.pitch), bank: deg(P.B.bank), kt: (P.V * 1.944).toFixed(0) };
  // لف يمين لحد 25° وبعدين سيب
  let tt = 0; while (P.B.bank < 0.44 && tt < 10) { P.step(DT, { thr: 0.6, roll: 1 }, flat); tt += DT; }
  const h0 = P.B.heading;
  for (let i = 0; i < 120 * 20; i++) P.step(DT, { thr: 0.6 }, flat);
  const turn = { bankHeld: deg(P.B.bank), headingChange: deg(P.B.heading - h0), altLoss: (y0 - P.B.pos.y).toFixed(0) };
  // سيبه يعدل: لف شمال لحد 0
  while (P.B.bank > 0.02) P.step(DT, { thr: 0.6, roll: -0.5 }, flat);
  // شدّ لآخره والدفع خامل: الحماية مش هتسيب زاوية الهجوم تعدي الانهيار
  let maxA = 0, stalled = false;
  for (let i = 0; i < 120 * 40; i++) { P.step(DT, { thr: 0, pitch: 1 }, flat); maxA = Math.max(maxA, P.alpha); stalled ||= P.stall; }
  check('plane_normal_law', Math.abs(+lvl.dAlt) < 120 && Math.abs(+turn.bankHeld - 25) < 6 && Math.abs(+turn.headingChange) > 20 && !stalled, { level: lvl, turn, prot: { maxAlphaDeg: deg(maxA), stalled, ktEnd: (P.V * 1.944).toFixed(0) } });
}
// ===== الطيارة: انهيار حقيقي في التحكم المباشر (من غير حماية) =====
{
  const P = new PlaneFDM(); P.place(0, 0, 0, 0, { alt: 1500, speed: 90 }); P.forceDirect = true; // (تحكم مباشر من غير حمايات)
  let maxA = 0, stalled = false, minVy = 0;
  const fake = (x, z) => ({ y: -1e4 });
  for (let i = 0; i < 120 * 25; i++) { P.step(DT, { thr: 0, pitch: 1 }, fake); maxA = Math.max(maxA, P.alpha); stalled ||= P.stall; minVy = Math.min(minVy, P.B.vel.y); }
  check('plane_stall_direct', stalled && minVy < -15, { maxAlphaDeg: deg(maxA), minVy: minVy.toFixed(1) });
}
// ===== الطيارة: هبوط (اقتراب 3° → لمس → فرامل) بطيار اختبار بسيط =====
{
  const P = new PlaneFDM(); const D = 2200; P.place(0, 0, D, 0, { alt: D * Math.tan(3 * Math.PI / 180) + 15, speed: 72 });
  P.gearDown = true; P.gearPos = 1; P.flapIdx = 3; P.flaps = 1;
  let touch = null, t = 0, flare = false;
  for (; t < 160; t += DT) {
    const B = P.B, dist = B.pos.z, gs = Math.max(0, dist) * Math.tan(3 * Math.PI / 180) + P.s.cg.y;
    const h = B.pos.y - P.s.cg.y;
    let pitch = 0, thr = P.throttle;
    if (!touch) {
      // على خط الانزلاق: نزول = السرعة × 3°
      const vyT = h < 14 ? -1.0 : -P.V * Math.tan(3 * Math.PI / 180) - (B.pos.y - gs) * 0.08;
      pitch = Math.max(-1, Math.min(1, (vyT - B.vel.y) * 0.6));
      if (h < 14) { flare = true; }
      thr = Math.max(0, Math.min(1, P.throttle + ((h < 10 ? 0 : 72) - P.V) * 0.02 * DT * 60));
      if (h < 10) thr = 0;
    }
    P.step(DT, { thr, pitch, brake: touch ? 1 : 0 }, flat);
    if (P.onGround && !touch) touch = { t: t.toFixed(1), kt: (P.V * 1.944).toFixed(0), sink: P.touchSink.toFixed(2), at: B.pos.z.toFixed(0) };
    if (P.crashed) break;
    if (touch && P.V < 1) break;
  }
  check('plane_landing', touch && !P.crashed && P.V < 2 && +touch.sink < 3, { touch, stopAt: P.B.pos.z.toFixed(0), crashed: P.crashed, flare, maxComp: Math.max(...P.gear.map((g) => g.comp)).toFixed(2) });
}
// ===== الهليكوبتر =====
{
  const rig = { cg: new THREE.Vector3(0, 1.25, -2.2), hub: new THREE.Vector3(0, 4.3, -2.2), R: 5.6, skids: [new THREE.Vector3(-1.2, 0, -3.2), new THREE.Vector3(-1.2, 0, -0.6), new THREE.Vector3(1.2, 0, -3.2), new THREE.Vector3(1.2, 0, -0.6)], tailZ: 7, tailY: 1.6 };
  const H = new HeliFDM(rig); H.place(0, 0, 0, 0);
  const flatH = (x, z) => ({ y: 0 }); 
  const stepH = (n, ctl) => { for (let i = 0; i < n; i++) { H._agl = H.B.pos.y - H.cg.y; H.step(DT, ctl, flatH); H.maxSink = Math.max(H.maxSink || 0, H.touchSink || 0); if (H.crashed) break; } };
  stepH(120 * 8, { coll: 0 }); // تشغيل الريشة
  const spun = H.rpm.toFixed(2);
  // طيار اختبار (collective بس): سرعة طلوع/نزول مطلوبة من فرق الارتفاع → PI على السرعة الرأسية. العصاية سايبة (SAS)
  let I = 0.55;
  const pilot = (hT, extra = {}, vyCap = 2) => { const h = H.B.pos.y - H.cg.y, vyT = Math.max(-vyCap, Math.min(vyCap, 0.6 * (hT - h))), e = vyT - H.B.vel.y; I = Math.max(0, Math.min(1, I + 0.08 * e * DT)); stepH(1, { coll: Math.max(0, Math.min(1, I + 0.12 * e)), ...extra }); };
  const hov = [], coll = [];
  for (let i = 0; i < 120 * 40; i++) { pilot(10); if (i > 120 * 25) { hov.push(H.B.pos.y - H.cg.y); coll.push(H.coll); } }
  const drift = Math.hypot(H.B.pos.x, H.B.pos.z);
  const hovC = coll.reduce((a, b) => a + b, 0) / coll.length, hovH = hov.reduce((a, b) => a + b, 0) / hov.length;
  const hovRange = Math.max(...hov) - Math.min(...hov);
  // طيران لقدام: العصاية لقدام 60% لمدة 20ث
  for (let i = 0; i < 120 * 20; i++) pilot(30, { pitch: -0.6 }, 4);
  const fwd = { kt: (H.B.vel.dot(H.B.f) * 1.944).toFixed(0), pitch: deg(H.B.pitch), alt: (H.B.pos.y - H.cg.y).toFixed(0) };
  // لف بالبدالات 2ث
  const h0 = H.B.heading; for (let i = 0; i < 240; i++) pilot(30, { yaw: 1 });
  // وقوف (SAS بيوقف الانجراف لما السرعة تقل) + هبوط رأسي بطيء
  for (let i = 0; i < 120 * 20; i++) pilot(30, { pitch: Math.hypot(H.B.vel.x, H.B.vel.z) > 6 ? 0.6 : 0 });
  for (let i = 0; i < 120 * 40 && !(H.onGround && H.coll < 0.2); i++) { if (H.onGround) { stepH(1, { coll: Math.max(0, H.coll - 0.4 * DT) }); continue; } pilot(-2, {}, H.B.pos.y - H.cg.y > 6 ? 2 : 0.5); }
  const landSink = H.maxSink;
  check('heli', spun > 0.99 && !H.crashed && Math.abs(hovH - 10) < 1 && hovRange < 1.2 && drift < 6 && +fwd.kt > 40 && H.onGround, { spun, hoverColl: hovC.toFixed(3), hoverAlt: hovH.toFixed(2), hoverRange: hovRange.toFixed(2), drift: drift.toFixed(1), fwd, yawDeg: deg(H.B.heading - h0), landed: H.onGround, touchSink: landSink?.toFixed(2), crashed: H.crashed });
}
console.log(JSON.stringify(out, null, 1));
console.log(ok ? 'PASS fdm-sim' : 'FAIL fdm-sim'); process.exit(ok ? 0 : 1);
