// السارينة: (1) زرار G بيشغّل سارينة عربيتك (صوت + كشاف)، (2) عربيات المرور قدامك في نفس الاتجاه بتركن على جنب وتهدّي،
// (3) مفيش غرامة/مطاردة لو خبطت وإنت سايق البوكس/الإسعاف.   node tools/tests/siren-yield.mjs [url]
const { chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs');
const BASE = process.argv[2] || 'http://localhost:5173/';
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: 800, height: 450 } }); p.setDefaultTimeout(900000);
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(`${BASE}?map=shibin`); await p.waitForFunction(() => !document.getElementById('go').disabled);
await p.evaluate(() => document.getElementById('go').click()); await p.waitForTimeout(2000);
await p.evaluate(async () => { document.querySelector('#linepick .lp-close')?.click(); await game.setVehicle('ambulance'); game.ambulanceMission.state = 'wait'; game.ambulanceMission._next = 1e9; });
// (setVehicle async: لازم العربية تكون اتبدلت قبل الزرار — غير كده G بيتقرا والعربية لسه الميكروباص)
await p.waitForFunction(() => game.player.kind === 'ambulance'); await p.waitForTimeout(500);
await p.keyboard.press('KeyG');
const r = await p.evaluate(async () => {
  const g = game, T = g.traffic, ph = g.player.physics; g.renderer.setAnimationLoop(null);
  const step = (n) => { for (let i = 0; i < n; i++) { g._frame ? null : null; g.debugSim(1 / 30, {}); } };
  // نشغّل فريم لعبة عادي عشان الزرار يتقرا
  g.input.consume?.('x'); const inp = g.input.read ? g.input.read() : null;
  await new Promise((q) => requestAnimationFrame(q));
  for (let i = 0; i < 3; i++) g._frame();
  const out = { sirenOn: !!g.player.sirenOn, body: document.body.classList.contains('siren-on'), ps: !!g.audio.ps, gain: g.audio.ps ? g.audio.ps.g.gain.value : null, bar: g.player.rig.policeBar?.a.emissiveIntensity };
  // عربية مرور قدامك في نفس الاتجاه على نفس الطريق
  const [fx, fz] = ph.forward;
  const c = T.cars.find((q) => q.on && !q.off && !q.virtual && !q.line && q.e && Math.hypot(q.x - ph.x, q.z - ph.z) < 160);
  if (!c) return { ...out, noCar: true };
  // نحط عربيتك ورا العربية دي بـ 18م وبنفس اتجاهها
  ph.reset(c.x - c.lastDx * 18, c.z - c.lastDz * 18, Math.atan2(-c.lastDx, -c.lastDz)); g.player._savePrev();
  const lane0 = c.lane, v0 = c.v;
  for (let i = 0; i < 90; i++) g._frame();
  out.yield = { lane0: +lane0.toFixed(2), lane1: +c.lane.toFixed(2), v0: +v0.toFixed(1), v1: +c.v.toFixed(1), yielding: !!c.yielding };
  // خبطة وإنت إسعاف: مفيش مطاردة
  g.incidents.trigger('crash', ph, g.player.kind);
  out.incident = g.incidents.state;
  return out;
});
await b.close();
console.log(JSON.stringify({ r, errs }));
const ok = r.sirenOn && r.body && r.ps && r.yield && (r.yield.yielding || r.yield.lane1 > r.yield.lane0 + 0.3) && r.yield.v1 <= 4.5 && r.incident === 'idle' && !errs.length;
console.log(ok ? 'PASS siren-yield' : 'FAIL siren-yield'); process.exit(ok ? 0 : 1);
