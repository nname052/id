// =====================================================================
//  السكة الشغالة: الخط الرئيسي من OSM، القطر (حركة + وقوف في محطة شبين)، المزلقانات (تقفل قبل القطر
//  وتفتح بعده)، المرور بيقف قدام المزلقان المقفول، البوابة النازلة ليها تصادم، وعربيات القطر على الخط
//   node tools/tests/rail-system.mjs [baseUrl]
// =====================================================================
const PW = process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);
const BASE = process.argv[2] || 'http://localhost:5173/';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.setDefaultTimeout(900000);
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${BASE}?map=shibin`);
await page.waitForFunction(() => !document.getElementById('go').disabled);
await page.evaluate(() => document.getElementById('go').click()); await page.waitForTimeout(1500);
await page.evaluate(() => document.querySelector('#linepick .lp-close')?.click());
const r = await page.evaluate(async () => {
  const g = game, W = g.world, R = W.rail, Tr = g.traffic; g.renderer.setAnimationLoop(null);
  const out = { ...R.debugStats() };
  const T = R.trains[0], cam = { x: 0, y: 2, z: 0 };
  const step = (n, f) => { for (let i = 0; i < n; i++) { R.update(1 / 30, cam); f?.(i); } };
  // 1) المزلقان: القطر جاي من 400م
  const C = R.crossings[0];
  Object.assign(T, { state: 'run', dir: 1, v: 15, s: C.s - 400, lastStop: null });
  // (المحطات اللي في السكة دي ماتوقفوش في الاختبار ده)
  const keep = R.stations; R.stations = [];
  cam.x = C.x; cam.z = C.z;
  out.cross = { name: C.name, closedBefore: C.closed, closedAt300: false, downAtPass: 0, openAfter: null, minGapTrain: 1e9 };
  step(30 * 40, () => {
    const ahead = (C.s - T.s) * T.dir;
    if (ahead < 300 && ahead > 250 && C.closed) out.cross.closedAt300 = true;
    if (Math.abs(ahead) < 3) out.cross.downAtPass = Math.max(out.cross.downAtPass, C.down);
  });
  // بعد ما عدّى بـ 40 ثانية: البوابة لازم تبقى مفتوحة
  out.cross.trainPassed = (T.sTail - C.s) * T.dir > 0;
  out.cross.openAfter = !C.closed && C.down < 0.15;
  // 2) المرور قدام المزلقان المقفول: عربية جاية على الشارع من 45م
  Object.assign(T, { state: 'run', dir: 1, v: 0.0, s: C.s - 120 }); step(30 * 4); // قطر واقف قريب = مقفول
  out.traffic = { closed: C.closed };
  const e = C.e, P = e.pts;
  // مسافة نقطة المزلقان على الشارع
  let sC = 0, bd = 1e9; for (let i = 0; i < P.length - 1; i++) { const a = P[i], b = P[i + 1], ex = b.x - a.x, ez = b.z - a.z, l2 = ex * ex + ez * ez || 1e-9; const t = Math.max(0, Math.min(1, ((C.x - a.x) * ex + (C.z - a.z) * ez) / l2)); const d = Math.hypot(C.x - (a.x + ex * t), C.z - (a.z + ez * t)); if (d < bd) { bd = d; sC = e.cum[i] + Math.sqrt(l2) * t; } }
  const car = Tr.cars.find((c) => c.type === 'sedan' || c.type === 'taxi');
  for (const c of Tr.cars) if (c !== car) { c.on = false; c.virtual = false; c.off = true; }
  // العربية على نفس الوصلة قبل المزلقان (لحد 40م، جوه طول الوصلة)
  const dir = sC > e.length / 2 ? 1 : -1, s0 = dir > 0 ? Math.max(1, sC - 40) : Math.min(e.length - 1, sC + 40);
  const set = Tr._laneSet?.(e);
  const lane = set ? set[0] : e.half / 2;
  Object.assign(car, { on: true, off: false, virtual: false, line: null, e, dir, s: s0, lane, laneHome: lane, v: 6, turn: null, next: null, hold: null, pull: null, dwell: 0, bumped: 0, kox: 0, koz: 0, deadEnd: false, lcCd: 0, laneChanges: 0 });
  Tr._at(e, dir, s0, lane, {}); Tr._place(car);
  // اللاعب بعيد شوية (مش قدام العربية) عشان العربية ماتتشالش
  const ph = g.player.physics; ph.reset(C.x + 60, C.z + 60, 0); g.player._savePrev();
  let minD = 1e9;
  for (let i = 0; i < 30 * 12; i++) { R.update(1 / 30, cam); Tr.update(1 / 30, g.player, { x: C.x, y: 2, z: C.z }); minD = Math.min(minD, Math.hypot(car.x - C.x, car.z - C.z)); }
  out.traffic.minDistToCrossing = +minD.toFixed(1); out.traffic.vEnd = +car.v.toFixed(2); out.traffic.stillOn = car.on;
  // 3) تصادم البوابة النازلة
  const box = { cx: C.x, cz: C.z, hx: 2, hz: 3 }; const cols = []; R.colliders(box, cols);
  out.barrierColliders = cols.filter((c) => !c.train).length;
  // 4) الوقوف في محطة شبين
  R.stations = keep;
  const st = R.stations.find((q) => q.main);
  Object.assign(T, { state: 'run', dir: 1, v: 15, s: st.s - 500, lastStop: null });
  let stopped = null;
  for (let i = 0; i < 30 * 90 && !stopped; i++) { R.update(1 / 30, { x: 0, y: 0, z: 0 }); if (T.state === 'stop') stopped = { d: +(T.s - st.s).toFixed(1), name: T.stopAt?.name }; }
  out.station = stopped; out.trainLen = T.len;
  // 5) العربيات على الخط (كل مركز عربية قريب من الخط)
  let off = 0;
  for (const c of T.cars) { let b = 1e9; for (let i = 0; i < R.line.pts.length - 1; i++) { const a = R.line.pts[i], q = R.line.pts[i + 1], ex = q.x - a.x, ez = q.z - a.z, l2 = ex * ex + ez * ez || 1e-9; const t = Math.max(0, Math.min(1, ((c.col.cx - a.x) * ex + (c.col.cz - a.z) * ez) / l2)); b = Math.min(b, Math.hypot(c.col.cx - (a.x + ex * t), c.col.cz - (a.z + ez * t))); } off = Math.max(off, b); }
  out.carsOffLineMax = +off.toFixed(2);
  return out;
});
await browser.close();
const pass = r.lineKm > 3 && r.stations.length >= 1 && r.crossings.length >= 3 &&
  r.cross.closedAt300 && r.cross.downAtPass > 0.9 && r.cross.trainPassed && r.cross.openAfter &&
  r.traffic.closed && r.traffic.minDistToCrossing > 3 && r.traffic.vEnd < 0.5 &&
  r.barrierColliders >= 2 && r.station && Math.abs(r.station.d - r.trainLen / 2) < 3 && r.carsOffLineMax < 1.5 && !errors.length;
console.log(JSON.stringify({ ...r, errors }, null, 1));
console.log(pass ? 'PASS rail-system' : 'FAIL rail-system');
process.exit(pass ? 0 : 1);
