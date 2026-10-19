// =====================================================================
//  مراجعة الكوبري العلوي (كوبرى شبين الكوم العلوي) — الشكل والفيزيا:
//   - المطلع الواطي ردم: العربية اللي على الأرض جنبه بتخبط في الحيطة الساندة (مش بتعدّي من تحته)،
//     واللي فوق السطح مابتشوفش الحيطة دي
//   - الشوارع اللي بتعدّي من تحت: ارتفاع كافي تحت البلاطة، ومفيش عمود في نص الشارع
//   - الميل: مفيش قفزة ارتفاع بين نقطتين ورا بعض (الميل ≤ 9%)
//   - السور: حاجز على الجنبين للي فوق السطح العالي
//   (القيادة الفعلية على الكوبري بالفيزيا: road-surface)
//   node tools/tests/bridge-audit.mjs [baseUrl]
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
  const g = game, W = g.world; g.renderer.setAnimationLoop(null);
  const es = W.graph.edges.filter((e) => e.name === 'كوبرى شبين الكوم العلوي');
  const out = { edges: es.length, lengthM: Math.round(es.reduce((s, e) => s + e.length, 0)), maxH: 0, maxGrade: 0, wallSamples: 0, wallMissing: 0, wallOnDeck: 0, crossings: 0, lowClear: 0, minClear: 99, piersOnCross: 0, parapetSamples: 0, parapetMissing: 0 };
  const near = (x, z, y) => { W.refY = y; const a = []; W.queryColliders(x, z, a); return a; };
  for (const e of es) {
    for (let s = 0; s < e.length; s += 6) {
      const q = {}; window.__edgePoint ? 0 : 0;
      // نقطة على الخط
      let acc = 0, i = 0; while (i < e.pts.length - 2 && acc + Math.hypot(e.pts[i + 1].x - e.pts[i].x, e.pts[i + 1].z - e.pts[i].z) < s) { acc += Math.hypot(e.pts[i + 1].x - e.pts[i].x, e.pts[i + 1].z - e.pts[i].z); i++; }
      const a = e.pts[i], b = e.pts[i + 1], L = Math.hypot(b.x - a.x, b.z - a.z) || 1, t = Math.min(1, (s - acc) / L);
      q.x = a.x + (b.x - a.x) * t; q.z = a.z + (b.z - a.z) * t; q.y = (a.y || 0) + ((b.y || 0) - (a.y || 0)) * t;
      const dx = (b.x - a.x) / L, dz = (b.z - a.z) / L, nx = -dz, nz = dx;
      out.maxH = Math.max(out.maxH, q.y);
      out.maxGrade = Math.max(out.maxGrade, Math.abs((b.y || 0) - (a.y || 0)) / L);
      W.updateVisibility({ x: q.x, y: 2, z: q.z }, 300);
      for (let k = 0; k < 40 && [...W.tiles.values()].some((T) => !T.ready); k++) { W.update(1 / 30); await new Promise((r) => setTimeout(r, 0)); }
      // شارع بيعدّي من تحت فعلًا (خطه بيقطع خط الكوبري) — المقفول عند المطلع (e.closed) مش بيتحسب
      const crossing = W.groundCrossings(a, b, e).filter((g2) => !g2.closed).length > 0;
      if (crossing && q.y > 1.6) { out.crossings++; const clr = q.y - 0.9; out.minClear = Math.min(out.minClear, +clr.toFixed(2)); if (clr < 3.2) { out.lowClear++; (out.lowAt ||= []).push({ x: Math.round(q.x), z: Math.round(q.z), deckY: +q.y.toFixed(2), roads: W.graph.edges.filter((g2) => !g2.elevated && !g2.closed && g2.pts.some((p2) => Math.hypot(p2.x - q.x, p2.z - q.z) < 25)).map((g2) => g2.name + ':' + g2.cls + ':' + g2.id + ':' + (g2.from === e.from || g2.from === e.to || g2.to === e.from || g2.to === e.to ? 'conn' : '')) }); } }
      // المطلع الواطي (ردم): لازم حيطة لعربية على الأرض جنبه، ومش ظاهرة للي فوق
      if (q.y > 1.2 && q.y < 3.6 && !crossing && !W._groundRoadUnder(q.x, q.z, 0)) {
        for (const sd of [-1, 1]) {
          const gx = q.x + nx * sd * (e.half + 0.45), gz = q.z + nz * sd * (e.half + 0.45);
          if (W._insideOtherDeck?.(gx, gz, q.y, e.src)) continue;
          out.wallSamples++;
          if (!near(gx, gz, 0).some((c) => c.kind === 'wall' || c.kind === 'building')) out.wallMissing++;
          if (near(q.x, q.z, q.y).some((c) => c.kind === 'wall' && Math.hypot(c.cx - q.x, c.cz - q.z) < e.half - 0.5)) out.wallOnDeck++;
        }
      }
      // السطح العالي: سور للي فوق
      if (q.y > 4.5) {
        out.parapetSamples++;
        if (!near(q.x, q.z, q.y).some((c) => c.kind === 'edge')) out.parapetMissing++;
      }
    }
  }
  // عواميد في نص شارع معدّي من تحت
  for (const arr of W.colGrid.values()) for (const c of arr) {
    if (c.kind !== 'prop' || c.yMax !== 1.5 || c._seenPier) continue; c._seenPier = true;
    for (const e of es) { /* بس العواميد اللي تحت الكوبري ده */ }
  }
  for (const arr of W.colGrid.values()) for (const c of arr) {
    if (!c._seenPier) continue; delete c._seenPier;
    for (const e of W.graph.edges) {
      if (e.elevated || e.closed) continue;
      for (let i = 0; i < e.pts.length - 1; i++) {
        const a = e.pts[i], b = e.pts[i + 1], ex = b.x - a.x, ez = b.z - a.z, l2 = ex * ex + ez * ez || 1e-9;
        const t = Math.max(0, Math.min(1, ((c.cx - a.x) * ex + (c.cz - a.z) * ez) / l2));
        const d = Math.hypot(c.cx - (a.x + ex * t), c.cz - (a.z + ez * t));
        // الشارع بيعدّي بالعرض (مش الشارع اللي العمود في نصه بطوله) والعمود جوه حارته
        const along = Math.abs(Math.sin(c.angle) * ex / Math.sqrt(l2) + Math.cos(c.angle) * ez / Math.sqrt(l2));
        if (d < e.half - 0.3 && along < 0.4) { out.piersOnCross++; i = e.pts.length; }
      }
    }
  }
  out.rampBlocked = (W.rampBlocked || []).map((id) => { const e = W.graph.edges[id]; return e.name + ':' + e.cls + ':' + Math.round(e.length) + 'm'; });
  return out;
});
await browser.close();
const pass = r.edges > 0 && r.wallSamples > 0 && r.wallMissing === 0 && r.wallOnDeck === 0 && r.lowClear === 0 && r.piersOnCross === 0 && r.maxGrade <= 0.09 && r.parapetMissing === 0 && !errors.length;
console.log(JSON.stringify({ ...r, errors }, null, 1));
console.log(pass ? 'PASS bridge-audit' : 'FAIL bridge-audit');
process.exit(pass ? 0 : 1);
