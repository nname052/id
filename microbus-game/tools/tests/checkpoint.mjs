// =====================================================================
//  الكمين في شبين: الكمين ظاهر (حواجز/أقماع/ظابط) → تقف → تفتيش الرخص → اتفضل/مخالفة
//  وهروب من الكمين → مطاردة بتبدأ من مكان عربية الكمين (مش جنبك) وماشية على الطرق → تقف → محضر
//   node tools/tests/checkpoint.mjs [baseUrl]
// =====================================================================
const PW = process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);
const BASE = process.argv[2] || 'http://localhost:5173/';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
page.setDefaultTimeout(1200000);
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${BASE}?map=shibin`);
await page.waitForFunction(() => !document.getElementById('go').disabled);
await page.click('#go'); await page.waitForTimeout(1500);
await page.evaluate(() => document.querySelector('#linepick .lp-close')?.click());
const r = await page.evaluate(async () => {
  const g = game, Pol = g.police, Inc = g.incidents, ph = g.player.physics, W = g.world;
  g.renderer.setAnimationLoop(null);
  const { findRoute } = await import('/src/nav/RoadGraph.js');
  const c = Pol.cps[0], q = c.q, dt = 1 / 30;
  const out = { name: c.def.name };
  const tick = (n) => { for (let i = 0; i < n; i++) { Pol.update(dt, ph, g.player.kind, i * dt); Inc.update(dt, ph); } };
  // 1) قرّب ناحية الكمين: يظهر بالحواجز والأقماع
  const place = (along) => { ph.reset(q.x + q.dx * along, q.z + q.dz * along, Math.atan2(q.dx * Math.sign(along), q.dz * Math.sign(along))); g.player._savePrev(); };
  c.cool = 0; c.rolled = false; c.state = 'idle';
  const rnd = Math.random; Math.random = () => 0; // الكمين شغال أكيد في الاختبار
  place(120); tick(2); place(60); tick(5);
  Math.random = rnd;
  out.visible = c.root.visible; out.barriers = c.colliders.length; out.state1 = c.state;
  // 2) وقفة عند الظابط → تفتيش → (الرخص سليمة) اتفضل
  place(4); tick(10); out.state2 = c.state;
  // الظابط بيمشي لحد شباك السواق الأول (لحد 15 ثانية)، وبعدين يفتش
  let walked = 0; const o0 = c.off.position.clone();
  for (let i = 0; i < 450 && c.state !== 'done'; i++) { tick(1); walked = Math.max(walked, c.off.position.distanceTo(o0)); }
  out.state3 = c.state; out.officerWalkedM = +walked.toFixed(1);
  // 3) الهروب: كمين تاني شغال، وعدّيته بسرعة
  c.state = 'idle'; c.cool = 0; c.rolled = false; c.on = true; Inc._cool = 0;
  place(60); tick(5);
  out.signal = c.state;
  Pol._flee(c);
  out.chase = Inc.state;
  const P = Inc.p;
  out.spawnDistFromPlayer = Math.round(Math.hypot(P.x - ph.x, P.z - ph.z));
  // اللاعب ماشي بعيد على طريق حقيقي، والشرطة وراه
  const far = W.graph.edges.find((e) => !e.elevated && Math.hypot(e.pts[0].x - q.x, e.pts[0].z - q.z) > 500 && Math.hypot(e.pts[0].x - q.x, e.pts[0].z - q.z) < 700);
  const rt = findRoute(ph.x, ph.z, far.pts[0].x, far.pts[0].z);
  let offRoad = 0, minDist = 1e9, samples = 0;
  for (let s = 0; s < Math.min(rt.length, 420); s += 11 * dt) {
    let i = 0; while (i < rt.pts.length - 2 && rt.cum[i + 1] < s) i++;
    const a = rt.pts[i], b = rt.pts[i + 1], t = (s - rt.cum[i]) / ((rt.cum[i + 1] - rt.cum[i]) || 1);
    ph.reset(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, Math.atan2(-(b.x - a.x), -(b.z - a.z)));
    ph.vx = -Math.sin(ph.yaw) * 11; ph.vz = -Math.cos(ph.yaw) * 11;
    Inc.update(dt, ph);
    const d = Math.hypot(P.x - ph.x, P.z - ph.z);
    minDist = Math.min(minDist, d);
    if (samples++ % 10 === 0) { const nr = W.nearestRoad(P.x, P.z, 60); if (!nr || nr.d > nr.e.half + 3.5) offRoad++; }
  }
  out.chaseSamples = samples; out.policeOffRoadSamples = offRoad; out.minDistToPlayer = +minDist.toFixed(1);
  // 4) وقفت → محضر هروب من كمين
  ph.reset(ph.x, ph.z, ph.yaw); ph.vx = ph.vz = 0;
  for (let i = 0; i < 150; i++) { Inc.update(dt, ph); }
  out.afterStop = Inc.state; out.card = !!g.hud.cardOpen;
  out.cardTitle = document.querySelector('#paycard .pc-h')?.textContent;
  return out;
});
const pass = r.visible && r.barriers >= 4 && r.state1 === 'signal' && ['signal', 'check', 'done'].includes(r.state2) && r.state3 === 'done' && r.officerWalkedM > 1 && r.chase === 'chase' && r.spawnDistFromPlayer > 25 && r.policeOffRoadSamples === 0 && r.minDistToPlayer >= 6.5 && r.afterStop === 'ticket' && !errors.length;
console.log(JSON.stringify({ ...r, errors }));
console.log(pass ? 'PASS checkpoint' : 'FAIL checkpoint');
await browser.close();
process.exit(pass ? 0 : 1);
