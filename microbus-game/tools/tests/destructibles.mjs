// =====================================================================
//  الشجر وعواميد الكهربا: خبطة خفيفة (≈7 كم/س) → بيفضلوا واقفين (العربية بتقف)،
//  خبطة جامدة (≈30 كم/س) → بيقعوا ناحية الحركة (والسلك اللي على العمود بيقع معاه) وبعد ما يناموا ليهم تصادم
//  على الأرض، والمرور بيقف قبلهم
//   node tools/tests/destructibles.mjs [baseUrl]
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
await page.evaluate(() => document.getElementById('go').click()); await page.waitForTimeout(2000);
await page.evaluate(() => document.querySelector('#linepick .lp-close')?.click());
const r = await page.evaluate(async () => {
  const g = game, W = g.world; g.renderer.setAnimationLoop(null);
  const ph = g.player.physics, out = {};
  const ram = async (inst, kmh, label) => {
    // عنصر متحط فعلًا (على رصيف، مربعه متحمل) قريب من البداية
    const sp = W.spawnPose();
    const cand = inst.items.filter((it) => Math.hypot(it.x - sp.x, it.z - sp.z) < 500).sort((a, b) => Math.hypot(a.x - sp.x, a.z - sp.z) - Math.hypot(b.x - sp.x, b.z - sp.z));
    let it = null;
    for (const c of cand) { W.updateVisibility({ x: c.x, y: 2, z: c.z }, 300); for (let k = 0; k < 60 && [...W.tiles.values()].some((T) => !T.ready); k++) { W.update(1 / 30); await new Promise((q) => setTimeout(q, 0)); } if (c.ok === undefined) c.ok = inst.check ? inst.check(c) : true; if (c.ok && !W.colGrid.size === false) { it = c; break; } }
    if (!it) return { label, found: false };
    const col = [...W.colGrid.values()].flat().find((c) => c.item === it);
    // العربية جاية عليه من الشارع (من ناحية أقرب طريق)
    const rd = W.nearestRoad(it.x, it.z, 30);
    let dx = it.x - rd.x, dz = it.z - rd.z; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    const d0 = ph.spec.halfLength + 3.5;
    ph.reset(it.x - dx * d0, it.z - dz * d0, Math.atan2(-dx, -dz)); // forward = (−sin, −cos)
    ph.vx = dx * kmh / 3.6; ph.vz = dz * kmh / 3.6;
    g.player._savePrev();
    const before = { dead: !!col.dead };
    for (let k = 0; k < 45; k++) { g.debugSim(1 / 30, { throttle: 0.15 }); W.update(1 / 30); W.updateVisibility(g.camera.position, 300); }
    const res = { label, found: true, kmh, broke: !!col.dead, okAfter: it.ok, fallen: W.fallen.length };
    // نسيبه يقع
    for (let k = 0; k < 90; k++) W.update(1 / 30);
    const F = W.fallen[W.fallen.length - 1];
    res.lying = !!F && F.done && res.broke; res.stops = (W.fallenStops || []).length;
    if (inst === W.streetKit.pole) res.wiresDown = W.streetKit.wire.near(it.x, it.z, 50).filter((w) => (w.ext?.from === it || w.ext?.to === it) && w.ok === false).length;
    return res;
  };
  out.poleSlow = await ram(W.streetKit.pole, 7, 'pole-slow');
  out.poleFast = await ram(W.streetKit.pole, 32, 'pole-fast');
  const tree = W.landmarksLayer.instancers.find((q) => q.mesh.name === 'trees');
  out.treeFast = await ram(tree, 32, 'tree-fast');
  return out;
});
await browser.close();
const pass = r.poleSlow.found && !r.poleSlow.broke && r.poleFast.found && r.poleFast.broke && r.poleFast.lying && r.poleFast.stops >= 1 && r.treeFast.found && r.treeFast.broke && r.treeFast.lying && !errors.length;
console.log(JSON.stringify({ ...r, errors }, null, 1));
console.log(pass ? 'PASS destructibles' : 'FAIL destructibles');
process.exit(pass ? 0 : 1);
