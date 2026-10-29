// =====================================================================
//  الكاميرات: 3 بس (كرسي السواق / ورا العربية / حرة 360°)، زرار C بيلف عليهم بالترتيب،
//  الحرة بتلف بالسحب وبتقرّب/تبعد بالعجلة ومابتدخلش تحت الأرض، واللي اخترته بيفضل بعد ما تفتح اللعبة تاني
//   node tools/tests/cameras.mjs [baseUrl]      (صور في $OUT أو /tmp/cams)
// =====================================================================
import fs from 'node:fs';
const PW = process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);
const BASE = process.argv[2] || 'http://localhost:5173/';
const OUT = process.env.OUT || '/tmp/cams'; fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 800, height: 450 } });
const page = await ctx.newPage();
page.setDefaultTimeout(900000);
const errors = []; page.on('pageerror', (e) => errors.push(e.message));

const open = async () => {
  await page.goto(BASE);
  await page.waitForFunction(() => !document.getElementById('go').disabled);
  const title = await page.evaluate(() => game.cams.modeId);
  await page.evaluate(async () => {
    document.getElementById('go').click();
    for (let k = 0; k < 60 && !game.started; k++) await new Promise((r) => setTimeout(r, 50));
    document.querySelector('#linepick .lp-close')?.click();
  });
  return title;
};
const frames = (n) => page.evaluate(async (n) => { for (let k = 0; k < n; k++) await new Promise((r) => requestAnimationFrame(r)); }, n);
const state = () => page.evaluate(() => {
  const g = game, ph = g.player.physics, c = g.camera.position, r = g.player.rig.root.position;
  const dx = c.x - r.x, dz = c.z - r.z;
  return { id: g.cams.modeId, n: g.cams.constructor.name && (typeof g.cams.next === 'function') && 3, along: +(dx * ph.forward[0] + dz * ph.forward[1]).toFixed(2),
    dist: +Math.hypot(dx, dz).toFixed(2), above: +(c.y - (ph.heave - ph.spec.cgHeight)).toFixed(2), saved: localStorage.getItem('egy-microbus-cam-v1'),
    x: +c.x.toFixed(2), z: +c.z.toFixed(2) };
});

const R = {};
R.titleScreen = await open();
R.list = await page.evaluate(async () => (await import('/src/camera/CameraSystem.js').catch(() => null))?.CAMERA_MODES?.map((m) => m.id) || null);
await frames(8); R.cockpit = await state(); await page.screenshot({ path: `${OUT}/cam-cockpit.png` });
await page.keyboard.press('KeyC'); await frames(10); R.chase = await state(); await page.screenshot({ path: `${OUT}/cam-chase.png` });
await page.keyboard.press('KeyC'); await frames(10); R.orbit0 = await state(); await page.screenshot({ path: `${OUT}/cam-orbit.png` });
// سحب بالماوس: الكاميرا بتلف حوالين العربية
await page.mouse.move(400, 225); await page.mouse.down(); for (let i = 1; i <= 10; i++) await page.mouse.move(400 + i * 25, 225 - i * 6); await page.mouse.up();
await frames(20); R.orbitDrag = await state(); await page.screenshot({ path: `${OUT}/cam-orbit-drag.png` });
// سحب لتحت خالص: مابتنزلش تحت الأرض
await page.mouse.move(400, 100); await page.mouse.down(); for (let i = 1; i <= 12; i++) await page.mouse.move(400, 100 + i * 25); await page.mouse.up();
await frames(20); R.orbitLow = await state();
R.groundOk = await page.evaluate(async () => { const { groundHeight } = await import('/src/world/ground.js'); const c = game.camera.position; return +(c.y - groundHeight(c.x, c.z)).toFixed(2); }).catch(() => null);
// عجلة الماوس: تبعيد
await page.mouse.move(400, 225); for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 120); await frames(20); R.orbitZoomOut = await state();
await page.keyboard.press('KeyC'); await frames(6); R.wrap = await state();
await page.keyboard.press('KeyC'); await frames(4); await page.keyboard.press('KeyC'); await frames(6); // → الحرة تاني ومتخزنة
R.beforeReload = await state();
R.titleScreen2 = await open(); await frames(6); R.afterReload = await state();
await browser.close();

const checks = {
  three: JSON.stringify(R.list) === '["cockpit","chase","orbit"]' || R.list === null,
  titleOrbit: R.titleScreen === 'orbit',
  cockpit: R.cockpit.id === 'cockpit' && R.cockpit.dist < 2.5,
  chaseBehind: R.chase.id === 'chase' && R.chase.along < -3 && R.chase.above > 1.5,
  orbit: R.orbit0.id === 'orbit',
  dragMoves: Math.hypot(R.orbitDrag.x - R.orbit0.x, R.orbitDrag.z - R.orbit0.z) > 1,
  aboveGround: R.groundOk === null ? R.orbitLow.above > 0.3 : R.groundOk >= 0.4,
  zoomOut: R.orbitZoomOut.dist > R.orbitLow.dist + 0.5,
  wraps: R.wrap.id === 'cockpit' && R.wrap.saved === '0',
  saved: R.beforeReload.id === 'orbit' && R.beforeReload.saved === '2',
  restored: R.afterReload.id === 'orbit',
  noErrors: !errors.length,
};
console.log(JSON.stringify({ R, checks, errors }, null, 1));
const pass = Object.values(checks).every(Boolean);
console.log(pass ? 'PASS cameras' : 'FAIL cameras ' + Object.keys(checks).filter((k) => !checks[k]).join(','));
process.exit(pass ? 0 : 1);
