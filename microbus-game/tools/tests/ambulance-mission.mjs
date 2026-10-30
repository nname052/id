// مهمة الإسعاف: بلاغ + مشهد + الوصول للمصاب + الشيل (4ث واقف) + المستشفى (OSM) + المكافأة.  node tools/tests/ambulance-mission.mjs [url] [map]
const { chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs');
const BASE = process.argv[2] || 'http://localhost:5173/', MAP = process.argv[3] || 'shibin';
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1000, height: 560 } }); p.setDefaultTimeout(1200000);
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(`${BASE}?map=${MAP}`); await p.waitForFunction(() => !document.getElementById('go').disabled);
await p.evaluate(() => document.getElementById('go').click()); await p.waitForTimeout(3000);
const r = await p.evaluate(async () => {
  document.querySelector('#linepick .lp-close')?.click(); const g = game; g.renderer.setAnimationLoop(null); g.setVehicle('ambulance');
  const M = g.ambulanceMission, step = (n) => { for (let i = 0; i < n; i++) { g.debugSim(1 / 30, {}); M.update(1 / 30, g.player.physics, g.player); } };
  const out = { kind: g.player.kind, bar: !!g.player.rig.policeBar };
  for (let i = 0; i < 40 && M.state !== 'toCase'; i++) { step(15); await new Promise((q) => setTimeout(q, 0)); }
  out.dispatch = { ...M.debugStats(), cine: g.cine.active, extras: M.extras?.length, lying: !!M.extras?.find((q) => q.fall === 1) };
  g.cine.stop();
  const go = (x, z) => { const pz = g.world.roadPose(x, z); g.player.physics.reset(pz.x, pz.z, pz.yaw); g.player._savePrev(); };
  go(M.case.rx, M.case.rz); step(10);
  out.atCase = M.state;
  for (let i = 0; i < 20 && M.state === 'load'; i++) step(15);
  out.afterLoad = { state: M.state, hosp: M.hosp?.name, extras: M.extras };
  const money0 = g.wallet.balance;
  if (M.state === 'toHosp') { go(M.hosp.x, M.hosp.z); step(20); }
  out.end = { ...M.debugStats(), earned: g.wallet.balance - money0 };
  return out;
});
await b.close();
console.log(JSON.stringify({ r, errs }));
const ok = r.kind === 'ambulance' && r.bar && r.dispatch.cine && r.dispatch.lying && r.atCase === 'load' && r.afterLoad.state === 'toHosp' && r.end.done === 1 && r.end.earned > 0 && !errs.length;
console.log(ok ? 'PASS ambulance-mission' : 'FAIL ambulance-mission');
process.exit(ok ? 0 : 1);
