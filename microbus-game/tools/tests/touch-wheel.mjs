// دركسيون اللمس (الموبايل): لمس حقيقي (CDP Input.dispatchTouchEvent) — بيلف مع الصباع في كل الحالات:
//  1) سحبة عادية على الحافة → الدركسيون والعجل بيلفوا بنفس الاتجاه
//  2) لمسة بتبدأ في ركن منطقة الدركسيون → برضه بتلف (كانت بتتجاهل)
//  3) صباع قديم "معلّق" (نزل ومارفعش — الحدث ضاع) → لمسة جديدة بتاخد الدركسيون (كان بيفضل مش بيستجيب)
//  4) لف دايرة كاملة وأكتر → الزاوية بتتراكم صح لحد أقصى لفة
//   node tools/tests/touch-wheel.mjs [url]
const { chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs');
const BASE = process.argv[2] || 'http://localhost:5173/';
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
const p = await ctx.newPage(); p.setDefaultTimeout(900000);
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(`${BASE}?map=shibin`); await p.waitForFunction(() => !document.getElementById('go').disabled);
await p.evaluate(() => document.getElementById('go').click()); await p.waitForTimeout(6000);
await p.evaluate(() => { document.querySelector('#linepick .lp-close')?.click(); game.renderer.render = () => {}; if (game.postfx) game.postfx.render = () => {}; }); // (من غير رسم: المنطق شغال والاختبار أسرع)
const cdp = await ctx.newCDPSession(p);
const W = await p.evaluate(() => { const r = document.getElementById('t-wheel').getBoundingClientRect(), z = document.getElementById('t-wheel-zone').getBoundingClientRect(); return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, R: document.getElementById('t-wheel').offsetWidth / 2, z: [z.left, z.top, z.width, z.height] }; });
const touch = async (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i + 1 })) });
const st = () => p.evaluate(() => ({ held: game.touch.state.wheelHeld, a: game.touch.state.wheelAngle, phys: game.player.physics.steeringWheelAngle }));
// سحبة على قوس من زاوية a0 لزاوية a1 (راديان، مع عقارب الساعة على الشاشة = يمين)
const arc = async (r, a0, a1, steps = 16, keep = false, startPts = null) => {
  const P = (a) => [W.cx + Math.cos(a) * r, W.cy + Math.sin(a) * r];
  await touch('touchStart', [...(startPts || []), P(a0)]);
  for (let i = 1; i <= steps; i++) { await touch('touchMove', [...(startPts || []), P(a0 + (a1 - a0) * i / steps)]); await p.waitForTimeout(16); }
  const s = await st();
  if (!keep) await touch('touchEnd', []);
  return s;
};
const out = { W };
await p.waitForTimeout(800);
// 1) سحبة عادية: من فوق (−90°) لليمين (0°) = لفة يمين 90°
out.normal = await arc(W.R * 0.85, -Math.PI / 2, 0);
await p.waitForTimeout(1500);
out.afterRelease = await st();
// 2) من ركن المنطقة (فوق شمال) — أبعد من 1.35 نص قطر
const cornerR = Math.hypot(W.z[0] - W.cx + 6, W.z[1] - W.cy + 6);
out.cornerR = +(cornerR / W.R).toFixed(2);
out.corner = await arc(cornerR, Math.atan2(W.z[1] + 6 - W.cy, W.z[0] + 6 - W.cx), Math.atan2(W.z[1] + 6 - W.cy, W.z[0] + 6 - W.cx) + 1.2);
await p.waitForTimeout(1500);
// 3) صباع معلّق: pointerdown صناعي من غير up (زي حدث ضايع) وبعدين لمسة حقيقية
await p.evaluate(({ cx, cy, R }) => { const z = document.getElementById('t-wheel-zone'); z.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 77, clientX: cx, clientY: cy - R * 0.8, bubbles: true, cancelable: true, pointerType: 'touch' })); }, W);
out.stuckThenNew = await arc(W.R * 0.85, -Math.PI / 2, -Math.PI / 2 - 1.2); // لفة شمال ~69°
await p.waitForTimeout(1500);
// 4) لفتين كاملين يمين (بيتراكم لحد الأقصى)
out.multi = await arc(W.R * 0.8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2.2, 60);
out.maxWheel = await p.evaluate(() => game.touch.maxWheel);
await b.close();
const deg = (r) => Math.round(r * 57.3);
const res = {
  normalDeg: deg(-out.normal.a), normalPhysDeg: deg(-out.normal.phys), cornerR: out.cornerR, cornerDeg: deg(-out.corner.a),
  stuckDeg: deg(-out.stuckThenNew.a), stuckHeld: out.stuckThenNew.held, multiDeg: deg(-out.multi.a), maxDeg: deg(out.maxWheel), released: deg(-out.afterRelease.phys),
};
console.log(JSON.stringify({ res, errs }));
const ok = Math.abs(res.normalDeg - 90) < 12 && res.normalPhysDeg > 70 && Math.abs(res.cornerDeg - 69) < 15 && res.stuckHeld && Math.abs(res.stuckDeg + 69) < 15 &&
  res.multiDeg > 380 && res.multiDeg <= res.maxDeg + 1 && Math.abs(res.released) < 30 && !errs.length;
console.log(ok ? 'PASS touch-wheel' : 'FAIL touch-wheel'); process.exit(ok ? 0 : 1);
