// مستوى "مطلوب": الحادثة بتبدأ بنجمة، بتزيد نجمة كل 20ث هروب والشرطة قريبة (لحد 3)، النجوم ظاهرة، وبتختفي لما تهرب.  node tools/tests/wanted.mjs [url]
const { chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs');
const BASE = process.argv[2] || 'http://localhost:5173/';
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1000, height: 560 } }); p.setDefaultTimeout(1200000);
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(`${BASE}?map=shibin`); await p.waitForFunction(() => !document.getElementById('go').disabled);
await p.evaluate(() => document.getElementById('go').click()); await p.waitForTimeout(3000);
const r = await p.evaluate(async () => {
  document.querySelector('#linepick .lp-close')?.click(); const g = game; g.renderer.setAnimationLoop(null);
  const I = g.incidents, ph = g.player.physics;
  I.trigger('crash', ph, g.player.kind);
  const out = { started: I.state, s0: I.stars };
  // لاعب "بيهرب": ماشي 12م/ث على خط مستقيم والشرطة وراه على 30م
  const fake = { x: ph.x, z: ph.z, speed: 12, forward: [0, -1] };
  const W = (n) => document.getElementById('wanted')?.textContent || '';
  let t = 0;
  for (; t < 70 && I.state === 'chase'; t += 1 / 30) { fake.z -= 12 / 30; I.p.x = fake.x; I.p.z = fake.z + 30; I.update(1 / 30, fake); if (Math.abs(t - 25) < 0.02) out.at25 = { stars: I.stars, hud: W() }; }
  out.at70 = { stars: I.stars, hud: W(), fine: I.fine, state: I.state };
  // بعيد عن الشرطة لحد ما الوقت يخلص
  for (let k = 0; k < 30 * 60 && I.state === 'chase'; k++) { fake.z -= 12 / 30; I.p.x = fake.x + 500; I.update(1 / 30, fake); }
  out.end = { state: I.state, hidden: document.getElementById('wanted')?.classList.contains('hidden') };
  return out;
});
await b.close();
console.log(JSON.stringify({ r, errs }));
const ok = r.started === 'chase' && r.s0 === 1 && r.at25.stars === 2 && r.at70.stars === 3 && r.at70.hud.startsWith('★★★') && r.end.state === 'idle' && r.end.hidden && !errs.length;
console.log(ok ? 'PASS wanted' : 'FAIL wanted'); process.exit(ok ? 0 : 1);
