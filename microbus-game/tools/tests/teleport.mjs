// انتقال فوري من الخريطة الكبيرة (زرار "انتقل فورًا"): العربية على أقرب شارع للمعلم، واقفة، ومفيش أخطاء.  node tools/tests/teleport.mjs
const { chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs');
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 900, height: 500 } }); p.setDefaultTimeout(900000);
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto((process.argv[2] || 'http://localhost:5173/') + '?map=alexandria'); await p.waitForFunction(() => !document.getElementById('go').disabled);
await p.evaluate(() => document.getElementById('go').click()); await p.waitForTimeout(3000);
await p.evaluate(() => document.querySelector('#linepick .lp-close')?.click());
const r = await p.evaluate(async () => {
  const g = game, W = g.world, mm = g.minimap || g.miniMap;
  const lm = W.landmarkPoints.find((l) => /قايتباي|Qaitbay/i.test(l.name || l.id)) || W.landmarkPoints[0];
  const before = [g.player.physics.x, g.player.physics.z];
  mm.toggle(); mm.sel = { x: lm.rx, z: lm.rz, name: lm.name, icon: '🏛' };
  mm.ui.querySelector('.mm-tp').click();
  for (let i = 0; i < 120; i++) await new Promise((q) => requestAnimationFrame(q));
  const ph = g.player.physics, st = W.streetAt(ph.x, ph.z);
  return { lm: lm.name, before, after: [ph.x, ph.z], dist: Math.hypot(ph.x - lm.rx, ph.z - lm.rz), y: g.player.rig.root.position.y, street: st && (st.name || String(st)), big: mm.big, flipped: Math.abs(ph.roll) > 1 };
});
console.log(JSON.stringify(r), errs); await b.close();
const ok = r.dist < 40 && !r.flipped && !r.big && !errs.length;
console.log(ok ? 'PASS teleport' : 'FAIL teleport'); process.exit(ok ? 0 : 1);
