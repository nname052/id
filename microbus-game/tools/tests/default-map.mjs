// =====================================================================
//  الخريطة الافتراضية: فتح اللعبة من غير ?map ومن غير أي اختيار محفوظ → شبين الكوم الحقيقية
//  + العربية على طريق حقيقي (مش على مبنى/ميه)، والكاميرا جوه كابينة السواق بعد "يلا بينا"،
//  + اختيار الخريطة القديمة بيتحفظ، والرجوع لشبين بيتحفظ
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
// حتى لو فيه اختيار قديم محفوظ بالمفتاح القديم ('current' من أيام ما كانت هي الافتراضية) → شبين
await page.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('egy-map', 'current'); sessionStorage.setItem('seeded', '1'); } });
await page.goto(BASE);
await page.waitForFunction(() => !document.getElementById('go').disabled);
const a = await page.evaluate(async () => {
  const g = game, W = g.world;
  const onBtn = document.querySelector('#maps button.on')?.dataset.m;
  document.getElementById('go').click();
  for (let k = 0; k < 60 && !g.started; k++) await new Promise((r) => setTimeout(r, 50));
  document.querySelector('#linepick .lp-close')?.click();
  const ph = g.player.physics;
  const rd = W?.nearestRoad(ph.x, ph.z, 20);
  for (let k = 0; k < 10; k++) await new Promise((r) => requestAnimationFrame(r));
  const cam = g.camera.position, eye = new (g.camera.position.constructor)(); g.player.rig.eye?.getWorldPosition(eye);
  return { mapId: g.mapId, onBtn, hasWorld: !!W, osm: !!document.getElementById('osm-ingame'), started: g.started, camMode: g.cams.mode,
    spawnOnRoad: !!rd && rd.d <= (rd.e?.half ?? 4) + 0.5, roadName: rd?.e?.name || null, camToEye: +cam.distanceTo(eye).toFixed(2) };
});
// اختيار الخريطة القديمة (صريح) بيتحفظ، والرجوع لشبين كمان
await page.goto(BASE); await page.waitForFunction(() => !document.getElementById('go').disabled || /الخريطة/.test(document.getElementById('status').textContent));
await page.evaluate(() => document.querySelector('#maps button[data-m="current"]').click());
await page.waitForFunction(() => window.game?.mapId === 'current' && !document.getElementById('go').disabled);
const b = await page.evaluate(() => ({ mapId: game.mapId, saved: localStorage.getItem('egy-map2') }));
await page.evaluate(() => document.querySelector('#maps button[data-m="shibin"]').click());
await page.waitForFunction(() => window.game?.mapId === 'shibin' && !document.getElementById('go').disabled);
const c = await page.evaluate(() => ({ mapId: game.mapId, saved: localStorage.getItem('egy-map2') }));
await browser.close();
const pass = a.mapId === 'shibin' && a.onBtn === 'shibin' && a.hasWorld && a.osm && a.started && a.camMode === 0 && a.spawnOnRoad && a.camToEye < 0.3 && b.mapId === 'current' && b.saved === 'current' && c.mapId === 'shibin' && c.saved === 'shibin' && !errors.length;
console.log(JSON.stringify({ first: a, pickedOld: b, backToShibin: c, errors }, null, 1));
console.log(pass ? 'PASS default-map' : 'FAIL default-map');
process.exit(pass ? 0 : 1);
