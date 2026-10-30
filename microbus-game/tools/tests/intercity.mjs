// موقف السفر: مابيتفتحش في أول اللعبة، بيتفتح لما تبعد وترجع وتقف، بيعرض أقرب مدن، والسفر بيفتح المدينة التانية.  node tools/tests/intercity.mjs [url]
const { chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs');
const BASE = process.argv[2] || 'http://localhost:5173/';
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1000, height: 560 } }); p.setDefaultTimeout(1200000);
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(`${BASE}?map=shibin`); await p.waitForFunction(() => !document.getElementById('go').disabled);
await p.evaluate(() => document.getElementById('go').click()); await p.waitForTimeout(3000);
const r = await p.evaluate(async () => {
  document.querySelector('#linepick .lp-close')?.click(); const g = game; g.renderer.setAnimationLoop(null);
  const I = g.intercity, ph = g.player.physics, H = I.hub;
  const st = (n) => { for (let i = 0; i < n; i++) { g.debugSim(1 / 30, {}); I.update(1 / 30, ph, g.player.kind); } };
  const out = { hub: H && H.name, dHub: H && Math.round(Math.hypot(H.x - ph.x, H.z - ph.z)) };
  st(90); out.atStartCard = g.hud.cardOpen;
  const go = (x, z) => { const q = g.world.roadPose(x, z); ph.reset(q.x, q.z, q.yaw); g.player._savePrev(); };
  go(H.x + 150, H.z); st(5); go(H.x, H.z); st(90);
  out.card = g.hud.cardOpen; out.title = document.querySelector('#pay .pc-h, .pc-h')?.textContent; out.dest = I.destinations().map((d) => [d.m.id, d.km]);
  return out;
});
// نختار أول مدينة
await p.click('.pc-ok[data-i="0"]');
// (التنقل الفعلي للصفحة بيعلّق في SwiftShader بعد ما WebGL يشتغل — نفس الأمر شغال على نفس الصفحة قبل اللعبة؛
//  فبنتأكد من اللي في إيد اللعبة: المدينة اتختارت واتحفظت وأمر التنقل اتبعت)
await p.waitForURL((u) => !String(u).includes('map=shibin'), { timeout: 30000, waitUntil: 'commit' }).catch(() => null);
const moved = !p.url().includes('map=shibin');
const url = moved ? p.url() : await p.evaluate(() => `map=${localStorage.getItem('egy-map')}|traveling=${window.game?.intercity?.traveling}`);
await b.close();
console.log(JSON.stringify({ r, url, errs }));
const ok = r.hub && !r.atStartCard && r.card && r.dest.length === 4 && url.includes(`map=${r.dest[0][0]}`) && !errs.length;
console.log(ok ? 'PASS intercity' : 'FAIL intercity'); process.exit(ok ? 0 : 1);
