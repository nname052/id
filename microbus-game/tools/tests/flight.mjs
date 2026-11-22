// الطيران جوه اللعبة (STAGE 7): الطيارة بتقلع من ممر منطقة الطيران وتطير فوق المدينة وتهبط على الممر وتقف،
// الهليكوبتر بتدور الريشة وتحوم وتنزل على سطح مبنى، والريشة لو خبطت في حيطة = تحطم + رجوع. صور لكل مرحلة.
//   node tools/tests/flight.mjs [url] [map]
const { chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs');
const BASE = process.argv[2] || 'http://localhost:5173/', MAP = process.argv[3] || 'shibin';
const OUT = process.env.OUT || 'tools/tests/out';
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 960, height: 540 } }); p.setDefaultTimeout(900000);
const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await p.goto(`${BASE}?map=${MAP}`); await p.waitForFunction(() => !document.getElementById('go').disabled);
await p.evaluate(() => document.getElementById('go').click()); await p.waitForTimeout(2500);
await p.evaluate(() => { document.querySelector('#linepick .lp-close')?.click(); game.renderer.setAnimationLoop(null); });
const shot = async (name, mode) => {
  await p.evaluate((mode) => { const g = game; g.cams.mode = mode; const ad = g.airDrive; ad._eye = null; for (let i = 0; i < 40; i++) ad.camera(g.camera, mode, 1 / 30, {}); ad.hud(); ad.fog(); g.route.updateVisibility(g.camera.position, g.viewDist); g.world.update?.(0); if (g.postfx) g.postfx.render(1 / 30); else g.renderer.render(g.scene, g.camera); }, mode);
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}/flight-${name}.png` });
};
const res = {};
// ===== الطيارة =====
await p.evaluate(async () => { game.setVehicle('plane'); });
await p.waitForFunction(() => game.driving === 'plane', null, { timeout: 120000 });
res.plane = await p.evaluate(() => {
  const g = game, ad = g.airDrive, F = ad.fdm, B = F.B, A = ad.airport;
  const step = (n, fly, extra = {}) => { for (let i = 0; i < n; i++) { ad.update(1 / 30, { actions: {}, handbrake: 0, fly, ...extra }); if (F.crashed) break; } };
  const o = { start: { x: Math.round(B.pos.x), z: Math.round(B.pos.z), onRunway: Math.abs(B.pos.x - A.cx) < 5 }, gearMeshes: ad.rig.gearMeshes.length };
  step(60, { lever: 0 });
  o.rest = { y: +(B.pos.y - ad.cg.y).toFixed(2), comp: F.gear.map((q) => +q.comp.toFixed(2)) };
  // إقلاع: دفع كامل، شدّ عند 140 عقدة
  const z0 = B.pos.z; let t = 0, lift = null;
  while (t < 90) { const kt = F.V * 1.944; step(1, { lever: 1, pitch: kt > 140 ? (B.pitch < 0.16 ? 1 : 0) : 0 }); t += 1 / 30; if (!F.onGround && !lift) lift = { dist: Math.round(z0 - B.pos.z), kt: Math.round(F.V * 1.944) }; if (B.pos.y > 250 || F.crashed) break; }
  o.takeoff = { ...lift, t: +t.toFixed(1), crashed: F.crashed, alt: Math.round(B.pos.y) };
  F.toggleGear(); F.setFlaps(-2);
  // لف ناحية المدينة (غرب) وطير فوقها
  const W = g.world.region.bbox_local, cx = (W[0] + W[2]) / 2, cz = (W[1] + W[3]) / 2;
  // (نص قطر اللفة = V²/(g·tanφ): بـ 180 عقدة و 35° ≈ 1.2كم — زي الحقيقة، الطيارة مابتلفّش في مكانها)
  for (let i = 0; i < 30 * 150; i++) {
    const want = Math.atan2(cx - B.pos.x, -(cz - B.pos.z)); let dh = want - B.heading; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    const bankT = Math.max(-0.6, Math.min(0.6, dh * 1.5)), roll = Math.max(-1, Math.min(1, (bankT - B.bank) * 3));
    const pitch = Math.max(-1, Math.min(1, (320 - B.pos.y) * 0.01 - B.vel.y * 0.08));
    step(1, { lever: Math.max(-1, Math.min(1, (180 - F.V * 1.944) * 0.05)), roll, pitch });
    if (Math.hypot(B.pos.x - cx, B.pos.z - cz) < 250 || F.crashed) break;
  }
  // المهمة: الحلقة فوق المدينة (نحط الطيارة قدامها ونعدّي)
  const M = ad.mission; o.missionStart = M.state;
  if (M.state === 'takeoff' || M.state === 'wp') { M.state = 'wp'; const w = M.wp; M.ring.show(w.x, w.y, w.z, 0); F.place(w.x, 0, w.z + 300, 0, { alt: w.y - ad.cg.y, speed: 110 }); for (let i = 0; i < 30 * 6 && M.state === 'wp'; i++) step(1, { lever: 0 }); }
  o.missionAfterRing = M.state;
  o.overCity = { d: Math.round(Math.hypot(B.pos.x - cx, B.pos.z - cz)), alt: Math.round(B.pos.y), kt: Math.round(F.V * 1.944), crashed: F.crashed };
  return o;
});
await shot('plane-city-chase', 1);
await shot('plane-city-cockpit', 0);
res.planeLand = await p.evaluate(() => {
  const g = game, ad = g.airDrive, F = ad.fdm, B = F.B, A = ad.airport;
  const step = (n, fly) => { for (let i = 0; i < n; i++) { ad.update(1 / 30, { actions: {}, handbrake: fly.brake || 0, fly }); if (F.crashed) break; } };
  // اقتراب نهائي: 2.5كم قبل عتبة 36، خط انزلاق 3°، قلابات كاملة والعجل نازل
  const th = A.threshold(1), D = 2500;
  F.place(th.x, 0, th.z + D, 0, { alt: D * Math.tan(3 * Math.PI / 180) + 15, speed: 72 });
  const money0 = g.wallet.balance;
  F.gearDown = true; F.gearPos = 1; F.flapIdx = 3; F.flaps = 1; F.throttle = 0.35;
  let touch = null, t = 0;
  while (t < 200) {
    const h = B.pos.y - ad.cg.y, dist = B.pos.z - th.z;
    let fly = { brake: touch ? 1 : 0 };
    if (!touch) {
      const gs = Math.max(0, dist + 300) * Math.tan(3 * Math.PI / 180);
      const vyT = h < 14 ? -1.0 : -F.V * Math.tan(3 * Math.PI / 180) - (h - gs) * 0.08;
      fly.pitch = Math.max(-1, Math.min(1, (vyT - B.vel.y) * 0.6));
      const lat = B.pos.x - th.x; fly.roll = Math.max(-1, Math.min(1, (-lat * 0.01 - B.bank) * 3));
      fly.lever = h < 10 ? -1 : Math.max(-1, Math.min(1, (70 - F.V) * 0.3));
    } else fly.lever = -1;
    step(1, fly); t += 1 / 30;
    if (F.onGround && !touch) touch = { kt: Math.round(F.V * 1.944), sink: +F.touchSink.toFixed(2), z: Math.round(B.pos.z - th.z), x: +(B.pos.x - th.x).toFixed(1) };
    if (F.crashed || (touch && F.V < 1)) break;
  }
  ad.camera(g.camera, 1, 1 / 30, {});
  for (let i = 0; i < 10; i++) step(1, { brake: 1, lever: -1 });
  return { paid: g.wallet.balance - money0, missionNext: ad.mission.state, touch, stopped: F.V < 1, stopFromThreshold: Math.round(th.z - B.pos.z), onRunway: Math.abs(B.pos.x - A.cx) < 20 && Math.abs(B.pos.z - A.cz) < 1300, crashed: F.crashed, papi: A.papi[1].lights.map((m) => m.material.color.getHexString()) };
});
await shot('plane-landed', 2);
// ===== الهليكوبتر =====
await p.evaluate(() => game.setVehicle('heli'));
await p.waitForFunction(() => game.driving === 'heli', null, { timeout: 120000 });
res.heli = await p.evaluate(() => {
  const g = game, ad = g.airDrive, F = ad.fdm, B = F.B;
  const step = (n, fly) => { for (let i = 0; i < n; i++) { ad.update(1 / 30, { actions: {}, handbrake: 0, fly }); if (F.crashed) break; } };
  let I = 0.55;
  const pilot = (hT, fly = {}, vyCap = 2) => { const h = B.pos.y - ad.cg.y - (ad._roof(B.pos.x, B.pos.z) || 0) * 0, vyT = Math.max(-vyCap, Math.min(vyCap, 0.6 * (hT - h))), e = vyT - B.vel.y; I = Math.max(0, Math.min(1, I + 0.08 * e / 30)); step(1, { ...fly, lever: Math.max(0, Math.min(1, I + 0.12 * e)), leverAbs: true }); };
  const o = { start: { x: Math.round(B.pos.x), z: Math.round(B.pos.z) }, R: +(F.R).toFixed(2), skids: ad.rig.skids.length };
  step(30 * 8, { lever: 0, leverAbs: true });
  o.rpm = +F.rpm.toFixed(2);
  const y0 = B.pos.y;
  for (let i = 0; i < 30 * 25; i++) pilot(y0 - ad.cg.y + 15);
  const hov = []; const p0 = B.pos.clone();
  for (let i = 0; i < 30 * 10; i++) { pilot(y0 - ad.cg.y + 15); hov.push(B.pos.y); }
  o.hover = { alt: +(B.pos.y - y0).toFixed(1), range: +(Math.max(...hov) - Math.min(...hov)).toFixed(2), drift: +B.pos.distanceTo(p0).toFixed(2), coll: +F.coll.toFixed(2), crashed: F.crashed };
  return o;
});
await shot('heli-hover-chase', 1);
await shot('heli-hover-cockpit', 0);
res.medevac = await p.evaluate(() => {
  const g = game, ad = g.airDrive, F = ad.fdm, B = F.B, M = ad.mission;
  const step = (n, fly) => { for (let i = 0; i < n; i++) { ad.update(1 / 30, { actions: {}, handbrake: 0, fly }); if (F.crashed) break; } };
  if (M.state !== 'medevac') M.heliTurn = 0, M.start();
  const d = M.dest, money0 = g.wallet.balance, info = M.info();
  F.place(d.x, d.y, d.z, 0, { alt: 20 }); F.rpm = 1; F.coll = 0.57;
  let I = 0.57;
  for (let i = 0; i < 30 * 40 && M.state === 'medevac'; i++) {
    if (F.onGround) { step(1, { lever: Math.max(0, F.coll - 0.5 / 30), leverAbs: true }); continue; }
    const h = B.pos.y - ad.cg.y - d.y, vyT = h > 6 ? -2 : -0.5, e = vyT - B.vel.y; I = Math.max(0, Math.min(1, I + 0.08 * e / 30));
    step(1, { lever: Math.max(0, Math.min(1, I + 0.12 * e)), leverAbs: true });
  }
  return { dest: d.name, onRoof: d.y > 0, info, paid: g.wallet.balance - money0, next: M.state, crashed: F.crashed };
});
res.heliRoof = await p.evaluate(() => {
  const g = game, ad = g.airDrive, F = ad.fdm, B = F.B;
  const step = (n, fly) => { for (let i = 0; i < n; i++) { ad.update(1 / 30, { actions: {}, handbrake: 0, fly }); if (F.crashed) break; } };
  // أكبر سطح قريب (مبنى عريض كفاية للزحافات)
  let best = null;
  for (const bf of g.world._bldFoot || []) { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const [x, z] of bf.P) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } const w = Math.min(x1 - x0, z1 - z0); const c = [(x0 + x1) / 2, (z0 + z1) / 2]; if (w > 16 && ad._roof(c[0], c[1]) > 8 && ad._clearRotorAbove?.(c) !== false) { const d = Math.hypot(c[0] - B.pos.x, c[1] - B.pos.z); if (!best || d < best.d) best = { d, c, h: ad._roof(c[0], c[1]), w }; } }
  if (!best) return { skipped: 'no wide roof' };
  // نحط الهليكوبتر فوق السطح بـ 25م وننزلها بالراحة
  F.place(best.c[0], best.h, best.c[1], 0, { alt: 25 }); F.rpm = 1; F.coll = 0.57;
  let I = 0.57;
  for (let i = 0; i < 30 * 40 && !(F.onGround && F.coll < 0.25); i++) {
    if (F.onGround) { step(1, { lever: Math.max(0, F.coll - 0.4 / 30), leverAbs: true }); continue; }
    const h = B.pos.y - ad.cg.y - best.h, vyT = h > 6 ? -2 : -0.5, e = vyT - B.vel.y; I = Math.max(0, Math.min(1, I + 0.08 * e / 30));
    step(1, { lever: Math.max(0, Math.min(1, I + 0.12 * e)), leverAbs: true });
  }
  return { roofH: +best.h.toFixed(1), roofW: Math.round(best.w), onGround: F.onGround, onRoof: F.res.roof, y: +(B.pos.y - ad.cg.y).toFixed(2), sink: +(F.touchSink || 0).toFixed(2), crashed: F.crashed };
});
await shot('heli-roof', 2);
res.heliCrash = await p.evaluate(() => {
  const g = game, ad = g.airDrive, F = ad.fdm, B = F.B;
  const step = (n, fly) => { for (let i = 0; i < n; i++) ad.update(1 / 30, { actions: {}, handbrake: 0, fly }); };
  // جنب حيطة مبنى عالي وواطي عنه: الريشة تخبط
  let tgt = null;
  for (const bf of g.world._bldFoot || []) { if ((bf.h || 0) < 14) continue; const [x, z] = bf.P[0]; tgt = { x, z, h: bf.h }; break; }
  if (!tgt) return { skipped: 'no tall building' };
  F.place(tgt.x + 30, 0, tgt.z, 0, { alt: tgt.h * 0.5 }); F.rpm = 1; F.coll = 0.57;
  // نزق الهليكوبتر ناحية المبنى
  B.vel.set(-8, 0, 0);
  let crashed = null; for (let i = 0; i < 30 * 8 && !crashed; i++) { step(1, { lever: 0.57, leverAbs: true }); crashed = F.crashed; }
  const respawnIn = ad.crashT;
  step(30 * 4, {});
  return { crashed, respawnIn: +respawnIn.toFixed(1), afterRespawn: !F.crashed };
});
// ===== رجوع للعربية =====
res.back = await p.evaluate(() => { game.setVehicle('microbus'); return { driving: game.driving, carVisible: game.player.rig.root.visible, flyingClass: document.body.classList.contains('flying'), camFar: game.camera.far }; });
await b.close();
res.errs = errs;
console.log(JSON.stringify(res, null, 1));
const P = res.plane, L = res.planeLand, H = res.heli, R = res.heliRoof, C = res.heliCrash;
const ok = P.start.onRunway && !P.takeoff.crashed && P.takeoff.dist > 600 && P.takeoff.dist < 2500 && !P.overCity.crashed && P.overCity.d < 300
  && L.touch && L.stopped && L.onRunway && !L.crashed && L.touch.sink < 3
  && P.missionAfterRing === 'land' && L.paid > 0 && L.missionNext === 'takeoff' && res.medevac.paid > 0 && res.medevac.next === 'tour'
  && H.rpm > 0.99 && !H.hover.crashed && Math.abs(H.hover.alt - 15) < 1.5 && H.hover.drift < 3
  && (R.skipped || (R.onGround && R.onRoof && !R.crashed))
  && (C.skipped || (C.crashed && C.afterRespawn))
  && res.back.driving === null && res.back.carVisible && !res.back.flyingClass && !errs.length;
console.log(ok ? 'PASS flight' : 'FAIL flight'); process.exit(ok ? 0 : 1);
