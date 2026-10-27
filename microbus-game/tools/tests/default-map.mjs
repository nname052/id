// =====================================================================
//  الخريطة: شبين الكوم الحقيقية هي الوحيدة (مفيش اختيار خريطة)، حتى لو فيه اختيار قديم محفوظ أو ?map=current في اللينك
//  + اسم اللعبة "شبين الكوم"، والعربية على طريق حقيقي (مش على مبنى/ميه)، والكاميرا جوه كابينة السواق بعد "يلا بينا"
//   node tools/tests/default-map.mjs [baseUrl]
// =====================================================================
const PW = process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);
const BASE = process.argv[2] || 'http://localhost:5173/';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 640, height: 360 } });
const page = await ctx.newPage();
page.setDefaultTimeout(900000);
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript(() => { localStorage.setItem('egy-map', 'current'); localStorage.setItem('egy-map2', 'current'); });
await page.goto(`${BASE}?map=current`);
await page.waitForFunction(() => !document.getElementById('go').disabled);
const a = await page.evaluate(async () => {
  const g = game, W = g.world;
  const title = document.querySelector('h1').textContent, sub = document.querySelector('.sub').textContent, picker = !!document.getElementById('maps');
  document.getElementById('go').click();
  for (let k = 0; k < 60 && !g.started; k++) await new Promise((r) => setTimeout(r, 50));
  document.querySelector('#linepick .lp-close')?.click();
  const ph = g.player.physics;
  const rd = W?.nearestRoad(ph.x, ph.z, 20);
  for (let k = 0; k < 10; k++) await new Promise((r) => requestAnimationFrame(r));
  const cam = g.camera.position, eye = new (g.camera.position.constructor)(); g.player.rig.eye?.getWorldPosition(eye);
  return { mapId: g.mapId, title, sub, picker, hasWorld: !!W, osm: !!document.getElementById('osm-ingame'), started: g.started, camMode: g.cams.mode,
    spawnOnRoad: !!rd && rd.d <= (rd.e?.half ?? 4) + 0.5, roadName: rd?.e?.name || null, camToEye: +cam.distanceTo(eye).toFixed(2) };
});
await browser.close();
const pass = a.mapId === 'shibin' && /شبين الكوم/.test(a.title) && /شبين الكوم/.test(a.sub) && !a.picker && a.hasWorld && a.osm && a.started && a.camMode === 0 && a.spawnOnRoad && a.camToEye < 0.3 && !errors.length;
console.log(JSON.stringify({ first: a, errors }, null, 1));
console.log(pass ? 'PASS default-map' : 'FAIL default-map');
process.exit(pass ? 0 : 1);
