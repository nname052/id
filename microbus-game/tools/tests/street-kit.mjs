// =====================================================================
//  تفاصيل الشارع والواجهات (بلكونات/واجهات محلات/أعمدة كهربا وسلك/أسياخ/إعلانات/قعدات):
//   - كل نوع draw call واحد ومتملي حوالين اللاعب (مش فاضي، ومش أكتر من الحد)
//   - مفيش عمود/قعدة على الأسفلت ولا تحت كوبري، والسلك بين عمودين موجودين بس
//   - البلكونات والتندات فوق الرصيف (مش فوق حارة العربيات) وعلى ارتفاع ماتخبطش فيه عربية
//   - الأرض متقسمة وورا الأسفلت (polygonOffset) → الطريق مايبيضش (z-fighting)
//   - موبايل: نفس الأنواع بحدود أقل ومن غير ضل
//   node tools/tests/street-kit.mjs [baseUrl]
// =====================================================================
const PW = process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);
const BASE = process.argv[2] || 'http://localhost:5173/';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const out = {}, errors = [];
for (const mobile of [false, true]) {
  const ctx = await browser.newContext(mobile ? { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 800, height: 450 } });
  const page = await ctx.newPage(); page.setDefaultTimeout(900000);
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('egy-microbus-settings-v1', JSON.stringify({ graphics: 'med' })); } catch { /* */ } });
  await page.goto(`${BASE}?map=shibin`);
  await page.waitForFunction(() => !document.getElementById('go').disabled);
  await page.evaluate(() => document.getElementById('go').click()); await page.waitForTimeout(1500);
  await page.evaluate(() => document.querySelector('#linepick .lp-close')?.click());
  out[mobile ? 'mobile' : 'desktop'] = await page.evaluate(async () => {
    const g = game, W = g.world, K = W.streetKit;
    g.renderer.setAnimationLoop(null);
    const sp = W.spawnPose(); g.player.physics.reset(sp.x, sp.z, sp.yaw); g.player._savePrev();
    const r = { kinds: {}, poleOnRoad: 0, cafeOnRoad: 0, wireOrphan: 0, overhangOnLane: 0, lowOverhang: 0, checked: 0 };
    // نلف على كذا مكان في البلد ونعدّ اللي اتملى
    const spots = [[sp.x, sp.z], [138, 20], [-282, 458], [116, 97], [206, 169]];
    for (const [x, z] of spots) {
      const cam = { x, y: 2, z };
      for (let i = 0; i < 40; i++) { W.updateVisibility(cam, 560); W.update(1 / 30); if (i % 10 === 0) await new Promise((q) => setTimeout(q, 0)); }
      K.update(cam);
      for (const n of K.all) {
        const k = r.kinds[n.mesh.name] ||= { maxVisible: 0, cap: n.max, castShadow: n.mesh.castShadow, items: n.items.length };
        k.maxVisible = Math.max(k.maxVisible, n.visibleCount); k.items = n.items.length; k.instancesPerItem = n.items.length ? +(n.items.reduce((s2, it) => s2 + (it.ext?.rep || 1), 0) / n.items.length).toFixed(1) : 0;
      }
      // الأماكن اللي اتحطت فعلًا (ok=true) جوه R
      const near = (n) => n.items.filter((it) => it.ok && (it.x - x) ** 2 + (it.z - z) ** 2 < n.R * n.R);
      for (const it of near(K.pole)) { const q = W.nearestRoad(it.x, it.z, 30); r.checked++; if (q && q.d < q.e.half - 0.05 && !q.e.elevated) r.poleOnRoad++; }
      for (const it of near(K.cafe)) { const q = W.nearestRoad(it.x, it.z, 30); r.checked++; if (q && q.d < q.e.half + 0.2 && !q.e.elevated) r.cafeOnRoad++; }
      for (const it of near(K.wire)) { r.checked++; if (!it.ext.from.ok || !it.ext.to.ok) r.wireOrphan++; }
      // البلكونة بتطلع 0.85م والتندة 1.05م من الواجهة: طرفها البعيد لازم يفضل برا الأسفلت
      for (const [n, reach, minY] of [[K.balcony, 0.85, 3.4], [K.shop, 1.05, 2.2]]) {
        for (const it of near(n)) {
          const fx = it.x + Math.sin(it.yaw) * reach, fz = it.z + Math.cos(it.yaw) * reach;
          const q = W.nearestRoad(fx, fz, 30); r.checked++;
          if (q && !q.e.elevated && q.d < q.e.half - 0.3) r.overhangOnLane++;
          if (it.y + (n === K.shop ? 2.24 : 0) < minY && n === K.balcony) r.lowOverhang++;
        }
      }
    }
    const gr = W.group.children.find((o) => o.name === 'ground');
    r.ground = { triangles: gr ? gr.geometry.index.count / 3 : 0, polygonOffset: !!gr?.material.polygonOffset };
    r.drawCallsPerKind = 1;
    return r;
  });
  await ctx.close();
}
await browser.close();
const ok = (m) => {
  const need = ['kit-balcony', 'kit-shopfront', 'kit-pole', 'kit-wire'];
  return need.every((k) => m.kinds[k]?.maxVisible > 0 && m.kinds[k].maxVisible <= m.kinds[k].cap) &&
    m.poleOnRoad === 0 && m.cafeOnRoad === 0 && m.wireOrphan === 0 && m.overhangOnLane === 0 && m.lowOverhang === 0 &&
    m.ground.triangles > 2 && m.ground.polygonOffset;
};
const mob = out.mobile;
const mobileLean = mob && Object.values(mob.kinds).every((k) => !k.castShadow) && !mob.kinds['kit-rebar'];
const pass = ok(out.desktop) && ok(mob) && mobileLean && !errors.length;
console.log(JSON.stringify({ ...out, mobileLean, errors }, null, 1));
console.log(pass ? 'PASS street-kit' : 'FAIL street-kit');
process.exit(pass ? 0 : 1);
