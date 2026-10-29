// =====================================================================
//  كل مدن مصر (src/world/maps.js): كل خريطة بتفتح من غير أخطاء، المربعات بتتحمل، فيه مباني ومرور وخطوط،
//  والعربية بتسوق 5 ثواني على الأرض (مش بتقع ولا بتطير).
//   node tools/tests/cities.mjs [baseUrl] [id ...]
// =====================================================================
const PW = process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);
const BASE = process.argv[2] || 'http://localhost:5173/';
const { MAPS } = await import('../../src/world/maps.js');
const want = process.argv.slice(3);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let fail = 0;
for (const m of MAPS) {
  if (want.length && !want.includes(m.id)) continue;
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  page.setDefaultTimeout(600000);
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const t0 = Date.now();
  try {
    await page.goto(`${BASE}?map=${m.id}`);
    await page.waitForFunction(() => !document.getElementById('go').disabled);
    const loadS = +((Date.now() - t0) / 1000).toFixed(1);
    await page.evaluate(() => document.getElementById('go').click());
    await page.waitForTimeout(800);
    const r = await page.evaluate(async () => {
      document.querySelector('#linepick .lp-close')?.click();
      const g = game, W = g.world, ph = g.player.physics; g.renderer.setAnimationLoop(null);
      for (let k = 0; k < 200; k++) { W.updateVisibility({ x: ph.x, y: 2, z: ph.z }, 300); W.update(0.03); await new Promise((r) => setTimeout(r, 10)); if (W.stats.tilesLoaded > 6 && !W.queue.length) break; }
      const y0 = ph.heave, x0 = ph.x, z0 = ph.z;
      let minY = 9, maxY = -9;
      for (let k = 0; k < 150; k++) { g.debugSim(1 / 30, { throttle: 0.35 }); const y = ph.heave - ph.spec.cgHeight; minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
      return { map: g.mapId, tiles: W.stats.tilesLoaded, buildings: W.stats.buildings, edges: W.graph.edges.length, lines: (g.passengers.LINES || []).length,
        landmarks: W.landmarkPoints.length, moved: +Math.hypot(ph.x - x0, ph.z - z0).toFixed(1), minY: +minY.toFixed(2), maxY: +maxY.toFixed(2), flipped: !!ph.flipped, street: W.streetAt(ph.x, ph.z)?.name || '' };
    });
    const ok = !errors.length && r.map === m.id && r.tiles > 4 && r.buildings > 300 && r.edges > 200 && r.moved > 5 && r.minY > -0.6 && r.maxY < 2 && !r.flipped;
    if (!ok) fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${m.id} ${JSON.stringify({ loadS, ...r, errors: errors.slice(0, 3) })}`);
  } catch (e) { fail++; console.log(`FAIL ${m.id} ${e.message.slice(0, 200)} ${errors.slice(0, 2)}`); }
  await page.close();
}
await browser.close();
console.log(fail ? `${fail} FAILED` : 'ALL PASS');
process.exit(fail ? 1 : 0);
