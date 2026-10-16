// =====================================================================
//  مسح كل حارات المدينة: بنقيس ارتفاع الأرض (اللي الفيزيا شايفاه) كل 50سم على خط كل حارة في كل الطرق.
//  أي تغيير مفاجئ (> 6سم) على طريق مش كوبري = "مطب مخفي" (رصيف داخل في الحارة، تداخل أسطح، ...).
//    node tools/tests/lane-scan.mjs [baseUrl]
// =====================================================================
const PW = process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);
const BASE = process.argv[2] || 'http://localhost:5173/';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await browser.newPage({ viewport: { width: 320, height: 200 } });
p.setDefaultTimeout(3600000);
await p.goto(`${BASE}?map=shibin`);
await p.waitForFunction(() => !document.getElementById('go').disabled);
const res = await p.evaluate(async () => {
  const g = game, W = g.world, TS = W.TS;
  g.renderer.setAnimationLoop(null);
  const { edgePoint } = await import('/src/world/shibin/ShibinData.js');
  const byTile = new Map();
  for (const e of W.graph.edges) {
    if (e.closed) continue;
    const m = e.pts[e.pts.length >> 1];
    const k = `${Math.floor(m.x / TS)},${Math.floor(m.z / TS)}`;
    if (!byTile.has(k)) byTile.set(k, []);
    byTile.get(k).push(e);
  }
  const bumps = [], q = {};
  let samples = 0, edges = 0;
  for (const [k, list] of byTile) {
    const [i, j] = k.split(',').map(Number);
    const cx = (i + 0.5) * TS, cz = (j + 0.5) * TS;
    for (let n = 0; n < 400; n++) { W.updateVisibility({ x: cx, z: cz }, 560); W.update(0.05); if (!W.queue.length && n > 4 && [...W.tiles.values()].every((T) => T.ready || T.dead)) break; await new Promise((r) => setTimeout(r, 2)); }
    for (const e of list) {
      edges++;
      const offs = e.oneway ? [0] : [-e.half * 0.5, e.half * 0.5];
      for (const off of offs) {
        let prev = null;
        for (let s = Math.min(6, e.length / 3); s <= e.length - Math.min(6, e.length / 3); s += 0.5) {
          edgePoint(e, s, q);
          const x = q.x - q.dz * off, z = q.z + q.dx * off;
          const h = W.height(x, z, prev ?? q.y);
          samples++;
          if (prev !== null && Math.abs(h - prev) > 0.06) { bumps.push({ edge: e.id, name: e.name, cls: e.cls, x: +x.toFixed(1), z: +z.toFixed(1), from: +prev.toFixed(2), to: +h.toFixed(2) }); break; }
          prev = h;
        }
      }
    }
  }
  const kinds = {};
  for (const b of bumps) { const key = `${b.from}->${b.to}`; kinds[key] = (kinds[key] || 0) + 1; }
  return { edges, samples, bumps: bumps.length, kinds, examples: bumps.slice(0, 15) };
});
console.log(JSON.stringify(res, null, 1));
await browser.close();
