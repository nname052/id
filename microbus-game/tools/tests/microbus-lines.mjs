// =====================================================================
//  خطوط الميكروباص: (1) كل خط ليه مسار رايح وجاي متصلين، (2) ميكروباصات المرور شغالة على خطوط:
//  محطات → الموقف → الرجوع، (3) وردية اللاعب: يبدأ في أول الخط وآخر الخط بيقلب رحلة الرجوع،
//  (4) التخطي الآمن: العربية بتغيّر حارة لما اللي قدامها واقف — ومابتغيّرش لو الحارة التانية فيها عربية
//   node tools/tests/microbus-lines.mjs [baseUrl]
// =====================================================================
const PW = process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);
const BASE = process.argv[2] || 'http://localhost:5173/';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
page.setDefaultTimeout(1800000);
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${BASE}?map=shibin`);
await page.waitForFunction(() => !document.getElementById('go').disabled);
await page.click('#go'); await page.waitForTimeout(1500);
const r = await page.evaluate(async () => {
  const g = game, T = g.traffic, P = g.passengers, ph = g.player.physics, out = {};
  g.renderer.setAnimationLoop(null);
  document.querySelector('#linepick .lp-close')?.click();
  T.update(1 / 30, g.player, g.camera.position);
  // 1) المسارات
  out.routes = T.lineRoutes.map((l) => {
    let gaps = 0;
    for (let i = 1; i < l.route.length; i++) { const a = l.route[i - 1], b = l.route[i]; if ((a.dir > 0 ? a.e.to : a.e.from) !== (b.dir > 0 ? b.e.from : b.e.to)) gaps++; }
    return { line: l.line.id, back: l.back, km: +(l.length / 1000).toFixed(1), stops: l.stops.length, gaps, verified: !!l.line.verified };
  });
  // 2) 8 دقايق مرور
  const e0 = T.lineRoutes[0].route[3].e.pts[0]; ph.reset(e0.x + 25, e0.z + 25, 0); g.player._savePrev();
  const ev = { stop: 0, terminal: 0, toReturn: 0 }; let maxLine = 0, overlaps = 0;
  for (let i = 0; i < 30 * 480; i++) {
    T.update(1 / 30, g.player, { x: ph.x, z: ph.z });
    for (const c of T.cars) {
      if (!c.line) continue;
      if (c.lstate !== c._ls) { if (c.lstate === 'stop') ev.stop++; if (c.lstate === 'terminal') ev.terminal++; c._ls = c.lstate; }
      if (c._lb !== undefined && c._lb !== c.line.back) ev.toReturn++;
      c._lb = c.line.back;
    }
    if (i % 60 === 0) { const st = T.debugStats(); maxLine = Math.max(maxLine, st.lineMicrobuses); overlaps = Math.max(overlaps, st.overlaps); }
    if (i % 300 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  out.ai = { ...ev, maxLineMicrobuses: maxLine, overlaps };
  // 3) وردية اللاعب
  g.setVehicle('microbus');
  P.selectLine(1); g.startLineShift();
  const st0 = P.lineStops[0], last = P.lineStops[P.lineStops.length - 1];
  out.shift = { line: P.line?.name, startDist: Math.round(Math.hypot(st0.mx - g.player.physics.x, st0.mz - g.player.physics.z)), sign: !!g.player._lineSignMesh?.visible, dir0: P.lineDir };
  // آخر الخط (فاضي): يقلب رحلة الرجوع من غير شاشة تحميل
  const ph2 = g.player.physics;
  for (const sgn of [1, -1]) { ph2.reset(last.mx, last.mz, Math.atan2(-last.ax * sgn, -last.az * sgn)); const [fx, fz] = ph2.forward; if ((last.x - ph2.x) * -fz + (last.z - ph2.z) * fx > 0.5) break; }
  g.player._savePrev(); P.onboard.length = 0;
  for (let i = 0; i < 90; i++) { g.debugSim(1 / 30); P.update(1 / 30, ph2); }
  out.shift.dirAfterEnd = P.lineDir; out.shift.newFirst = P.lineStops[0]?.name; out.shift.oldLast = last.name;
  // 4) التخطي
  const multi = g.world.graph.edges.filter((e) => !e.closed && !e.elevated && e.length > 160 && T._laneSet(e)).sort((a, b) => b.length - a.length)[0];
  out.laneTest = { edge: multi?.id, oneway: multi?.oneway, lanes: multi?.lanes };
  if (multi) {
    const cars = T.cars.filter((c) => c.type === 'sedan' || c.type === 'taxi').slice(0, 3);
    for (const c of T.cars) { if (!cars.includes(c)) { c.on = false; c.virtual = false; c.off = true; } }
    const set = T._laneSet(multi), dir = 1;
    const place = (c, s, lane, v) => { Object.assign(c, { on: true, off: false, virtual: false, line: null, e: multi, dir, s, lane, laneHome: lane, v, turn: null, next: null, hold: null, pull: null, dwell: 0, bumped: 0, kox: 0, koz: 0, deadEnd: false, lcCd: 0, laneChanges: 0 }); T._at(multi, dir, s, lane, {}); T._place(c); };
    const [A, B, C] = cars;
    // A واقف (معطّل) في الحارة الأولى، B جاي وراه
    place(A, 110, set[0], 0); A.bumped = 1e9;
    place(B, 40, set[0], 8); C.on = false; C.off = true;
    const mp = multi.pts[Math.floor(multi.pts.length / 2)], farPl = { x: mp.x + 90, z: mp.z + 90 };
    ph.reset(farPl.x, farPl.z, 0);
    let minAB = 1e9;
    for (let i = 0; i < 30 * 15; i++) { T.update(1 / 30, g.player, farPl); minAB = Math.min(minAB, Math.hypot(A.x - B.x, A.z - B.z)); }
    out.laneTest.overtook = B.laneChanges > 0; out.laneTest.minDist = +minAB.toFixed(1);
    // تاني: C ماشي جنب B في الحارة التانية → B مايغيّرش
    place(A, 110, set[0], 0); A.bumped = 1e9;
    place(B, 40, set[0], 8); place(C, 38, set[1], 8); C.vMul = B.vMul;
    let changedWhileBlocked = false;
    for (let i = 0; i < 30 * 4; i++) { T.update(1 / 30, g.player, farPl); if (B.laneChanges && Math.hypot(B.x - C.x, B.z - C.z) < 10) changedWhileBlocked = true; }
    out.laneTest.changedWhileBlocked = changedWhileBlocked;
  }
  return out;
});
const R = r.routes, pass = R.length >= 2 && R.every((x) => x.gaps === 0) && r.ai.stop > 0 && r.ai.terminal > 0 && r.ai.toReturn > 0 && r.ai.overlaps === 0
  && r.shift.startDist < 15 && r.shift.sign && r.shift.dirAfterEnd !== r.shift.dir0 && r.shift.newFirst === r.shift.oldLast
  && (!r.laneTest.edge || (r.laneTest.overtook && r.laneTest.minDist > 2 && !r.laneTest.changedWhileBlocked)) && !errors.length;
console.log(JSON.stringify({ ...r, errors }, null, 1));
console.log(pass ? 'PASS microbus-lines' : 'FAIL microbus-lines');
await browser.close();
process.exit(pass ? 0 : 1);
