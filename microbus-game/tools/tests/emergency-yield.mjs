// =====================================================================
//  المرور بيفسح للإسعاف: عربية إسعاف ماشية بالسارينة ورا عربية مرور في نفس الاتجاه →
//  العربية بتهدّي (≤ 2.5 م/ث) وبتركن ناحية الرصيف، وبعد ما الإسعاف تعدّي بترجع لحارتها.
//   node tools/tests/emergency-yield.mjs [baseUrl]
// =====================================================================
const PW = process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);
const BASE = process.argv[2] || 'http://localhost:5173/';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.setDefaultTimeout(900000);
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.goto(BASE); await page.waitForFunction(() => !document.getElementById('go').disabled);
await page.evaluate(() => document.getElementById('go').click()); await page.waitForTimeout(2000);
const r = await page.evaluate(() => {
  const g = game, T = g.traffic, E = g.emergency, ph = g.player.physics; g.renderer.setAnimationLoop(null);
  for (let i = 0; i < 60; i++) T.update(1 / 30, g.player, g.camera.position);
  // عربية ماشية على شارع عريض (فيه مكان تركن) ومش بتلف
  const c = T.cars.filter((q) => q.on && !q.off && !q.virtual && !q.turn && !q.pull && q.v > 2 && q.e.half > 3).sort((a, b) => (b.e.length - b.s) - (a.e.length - a.s))[0];
  if (!c) return { error: 'no moving car' };
  const rig = E._ambulance(); rig.root.visible = true;
  E.jobs = [{ state: 'drive', v: 9, victim: { x: 1e6, z: 1e6 } }];
  const lane0 = c.lane, home = c.laneHome, out = { lane0: +lane0.toFixed(2), half: c.e.half };
  let minV = 99, maxLane = lane0;
  for (let i = 0; i < 90; i++) { // 3 ث: الإسعاف 10م وراها
    rig.yaw = Math.atan2(c.lastDx, c.lastDz); rig.root.position.set(c.x - c.lastDx * 10, 0, c.z - c.lastDz * 10);
    T.update(1 / 30, g.player, g.camera.position);
    if (i > 30) minV = Math.min(minV, c.v);
    maxLane = Math.max(maxLane, c.lane);
  }
  out.minV = +minV.toFixed(2); out.lanePulled = +(maxLane - lane0).toFixed(2);
  // الإسعاف عدّت
  E.jobs = []; rig.root.visible = false;
  for (let i = 0; i < 30 * 8; i++) T.update(1 / 30, g.player, g.camera.position);
  out.backHome = c.e && Math.abs(c.lane - c.laneHome) < 0.3; out.home = home;
  return out;
});
await browser.close();
const pass = !r.error && r.minV <= 2.6 && r.lanePulled > 0.4 && r.backHome && !errors.length;
console.log(JSON.stringify({ r, errors }, null, 1));
console.log(pass ? 'PASS emergency-yield' : 'FAIL emergency-yield');
process.exit(pass ? 0 : 1);
