// الطيران على التليفون: عصاية اللمس + ذراع الدفع بيحرّكوا الهليكوبتر فعلًا (pointer events حقيقية)، والدركسيون والدواسات مستخبيين.
// + صورة لمنطقة الطيران من فوق.   node tools/tests/flight-mobile.mjs [url]
const { chromium, devices } = await import('/opt/node22/lib/node_modules/playwright/index.mjs');
const BASE = process.argv[2] || 'http://localhost:5173/', OUT = process.env.OUT || 'tools/tests/out';
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await b.newContext({ ...devices['Pixel 7 landscape'] });
const p = await ctx.newPage(); p.setDefaultTimeout(900000);
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(`${BASE}?map=shibin`); await p.waitForFunction(() => !document.getElementById('go').disabled);
await p.evaluate(() => document.getElementById('go').click()); await p.waitForTimeout(2500);
await p.evaluate(() => { document.querySelector('#linepick .lp-close')?.click(); game.setVehicle('heli'); });
await p.waitForFunction(() => game.driving === 'heli', null, { timeout: 120000 });
await p.evaluate(() => game.renderer.setAnimationLoop(null));
const vis = await p.evaluate(() => ({ stick: !!document.querySelector('#ftouch:not(.hidden) .ft-stick'), wheelHidden: getComputedStyle(document.querySelector('.t-wheel-zone')).display === 'none', pedalsHidden: getComputedStyle(document.querySelector('.t-pedals')).display === 'none' }));
// (فريمات اللعبة كاملة بس من غير رسم — الرسم على كارت سوفتوير بطيء جدًا؛ الصور في الآخر بترسم عادي)
await p.evaluate(() => { const g = game; g._rr = g.renderer.render.bind(g.renderer); g.renderer.render = () => {}; if (g.postfx) { g._pr = g.postfx.render.bind(g.postfx); g.postfx.render = () => {}; } g.renderer.shadowMap.enabled = false; });
const frames = async (n) => p.evaluate((n) => { for (let i = 0; i < n; i++) { game.clock.getDelta = () => 1 / 30; game._frame(); } }, n);
await frames(30 * 8); // الريشة تدور
// ذراع الـ collective لـ 75% بإيد حقيقية
const lv = await p.locator('#ft-lever').boundingBox();
await p.mouse.move(lv.x + lv.width / 2, lv.y + lv.height * 0.25); await p.mouse.down(); await p.mouse.up();
await frames(30 * 3);
const up = await p.evaluate(() => ({ coll: +game.airDrive.fdm.coll.toFixed(2), vy: +game.airDrive.fdm.B.vel.y.toFixed(2), agl: +game.airDrive.fdm._agl.toFixed(1) }));
// العصاية لقدام (فوق) وهي مسكوكة: الأنف بينزل
const st = await p.locator('#ft-stick').boundingBox();
await p.mouse.move(st.x + st.width / 2, st.y + st.height / 2); await p.mouse.down(); await p.mouse.move(st.x + st.width / 2, st.y + 8);
await frames(30 * 2);
const fwd = await p.evaluate(() => ({ pitchDeg: +(game.airDrive.fdm.B.pitch * 57.3).toFixed(1), stick: game.flightTouch.state.pitch }));
await p.mouse.up(); await frames(10);
const rel = await p.evaluate(() => ({ stick: game.flightTouch.state.pitch, held: game.flightTouch.state.stickHeld }));
await p.evaluate(() => { const g = game; g.renderer.render = g._rr; if (g._pr) g.postfx.render = g._pr; g.renderer.shadowMap.enabled = true; g.airDrive.camera(g.camera, 1, 1 / 30, {}); if (g.postfx) g.postfx.render(1 / 30); else g.renderer.render(g.scene, g.camera); });
await p.screenshot({ path: `${OUT}/flight-mobile-heli.png` });
// منطقة الطيران من فوق
await p.evaluate(() => { const g = game, A = g.airDrive.airport; g.camera.position.set(A.cx - 650, 260, A.cz + 700); g.camera.lookAt(A.cx - 250, 0, A.cz); g.camera.updateMatrixWorld(); if (g.postfx) g.postfx.render(1 / 30); else g.renderer.render(g.scene, g.camera); });
await p.screenshot({ path: `${OUT}/flight-airport.png` });
await b.close();
const out = { vis, up, fwd, rel, errs };
console.log(JSON.stringify(out, null, 1));
const ok = vis.stick && vis.wheelHidden && vis.pedalsHidden && up.coll > 0.7 && up.vy > 0.5 && fwd.pitchDeg < -3 && fwd.stick < -0.5 && rel.stick === 0 && !rel.held && !errs.length;
console.log(ok ? 'PASS flight-mobile' : 'FAIL flight-mobile'); process.exit(ok ? 0 : 1);
