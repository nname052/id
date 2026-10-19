// =====================================================================
//  المدينة الحية: كثافة المرور حسب وقت اليوم (ذروة نهار/عصاري، أخف بالليل)، الناس بتدخل وتخرج من المحلات
//  وبتتفرج على الفترينات (من غير ما تنزل الشارع)، والكلاكس: اللي قدامك بيستجيب (يسرّع/يخلّص تحميل)
//   node tools/tests/living-city.mjs [baseUrl]
// =====================================================================
const PW = process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);
const BASE = process.argv[2] || 'http://localhost:5173/';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await (await browser.newContext({ viewport: { width: 640, height: 360 } })).newPage(); p.setDefaultTimeout(900000);
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(`${BASE}?map=shibin`);
await p.waitForFunction(() => !document.getElementById('go').disabled);
await p.evaluate(() => document.getElementById('go').click());
await p.waitForTimeout(2000);
const r = await p.evaluate(async () => {
  const g = game, W = g.world, C = g.crowd; g.renderer.setAnimationLoop(null);
  const out = { density: { day: null, night: null } };
  out.density.day = g.traffic.active;
  g.env.setPreset('night'); out.density.night = g.traffic.active; g.env.setPreset('sunset'); out.density.sunset = g.traffic.active; g.env.setPreset('day');
  // المحلات: نمشي على شارع تجاري (tertiary في الاختبارات السابقة) ونعدّ
  const cam = { x: -282, y: 2, z: 458 };
  g.player.physics.reset(cam.x + 30, cam.z, 0);
  let maxShop = 0, inside = 0, look = 0, done = 0, onRoad = 0;
  const seen = new Set();
  for (let i = 0; i < 30 * 120; i++) {
    if (i % 8 === 0) W.updateVisibility(cam, 400);
    W.update(1 / 30);
    C.update(1 / 30, cam, g.player.physics, new window.__THREE.Vector3(0, 0, 1));
    let n = 0;
    for (const q of C.people) if (q.on && q.shop) { n++; seen.add(q); if (q.shop.phase === 'in') inside++; if (q.shop.phase === 'look') look++; }
    for (const q of seen) if (!q.shop) { done++; seen.delete(q); }
    maxShop = Math.max(maxShop, n);
    if (i % 30 === 0) onRoad += C.debugOnRoad().onRoad;
  }
  out.shops = { maxConcurrent: maxShop, insideFrames: inside, lookFrames: look, completedVisits: done, onRoad };
  // الكلاكس: ميكروباص واقف بيحمّل قدامك
  const T = g.traffic, e = W.graph.edges.filter((q) => !q.closed && !q.elevated && q.length > 120 && q.cls !== 'service').sort((a, b) => b.length - a.length)[0];
  const car = T.cars.find((c) => c.type === 'microbus') || T.cars[0];
  for (const c of T.cars) if (c !== car) { c.on = false; c.virtual = false; c.off = true; }
  const set = T._laneSet?.(e), lane = set ? set[0] : e.half / 2;
  Object.assign(car, { on: true, off: false, virtual: false, line: null, e, dir: 1, s: 70, lane, laneHome: lane, v: 0, turn: null, next: null, hold: null, pull: null, dwell: 12, bumped: 0, kox: 0, koz: 0, deadEnd: false, lcCd: 0, laneChanges: 0 });
  T._at(e, 1, 70, lane, {}); T._place(car);
  const q = {}; T._at(e, 1, 55, lane, q);
  const fl = Math.hypot(car.x - q.x, car.z - q.z) || 1, fx = (car.x - q.x) / fl, fz = (car.z - q.z) / fl;
  car.lastDx = fx; car.lastDz = fz;
  const ph = g.player.physics; ph.reset(q.x, q.z, Math.atan2(-fx, -fz)); // (forward = (−sin yaw, −cos yaw))
  const n = T.honked(ph);
  out.horn = { responders: n, dwellAfter: car.dwell, hornT: car.hornT, dbg: { on: car.on, off: car.off, virt: car.virtual, cx: car.x, cz: car.z, px: ph.x, pz: ph.z, fx, fz, qx: q.x, qz: q.z } };
  return out;
});
await browser.close();
const pass = r.density.night < r.density.day && r.density.sunset >= r.density.day && r.shops.completedVisits >= 5 && r.shops.insideFrames > 0 && r.shops.lookFrames > 0 && r.shops.onRoad === 0 &&
  r.horn.responders >= 1 && r.horn.dwellAfter <= 1 && r.horn.hornT > 0 && !errs.length;
console.log(JSON.stringify({ ...r, errors: errs }, null, 1));
console.log(pass ? 'PASS living-city' : 'FAIL living-city');
process.exit(pass ? 0 : 1);
