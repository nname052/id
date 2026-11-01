// عربية الجولف (MAJOR UPDATE — STAGE 5): الموديل بيتبني (مش بيرجع للتاكسي)، أقصى سرعة ~20–28 كم/س زي عربية جولف حقيقية،
// بتلف وبتفرمل، ومن غير أخطاء.   node tools/tests/golf-drive.mjs [url]
const { chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs');
const BASE = process.argv[2] || 'http://localhost:5173/';
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 800, height: 450 } }); p.setDefaultTimeout(900000);
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.addInitScript((k) => { window.KIND = k; }, process.env.KIND || 'golf'); await p.goto(`${BASE}?map=shibin`); await p.waitForFunction(() => !document.getElementById('go').disabled);
await p.evaluate(() => document.getElementById('go').click()); await p.waitForTimeout(2000);
const r = await p.evaluate(async () => {
  const g = game; document.querySelector('#linepick .lp-close')?.click();
  await g.setVehicle(window.KIND || 'golf');
  const rig = g.player.rig, ph = g.player.physics;
  // (فيزيا العربية لوحدها: أرض مستوية من غير حيطان ولا مرور)
  g.world.height = () => 0; g._colliders = () => []; g.traffic.setDensity?.(0); ph.reset(0, 0, 0); g.player._savePrev();
  const out = { kind: rig?.kind || rig?.C?.label || null, label: g.player.label || null, model: !!rig?.real };
  const s1 = g.debugSim(9, { throttle: 1 }); out.vTop = s1.kmh; out.gear = s1.gear;
  const s2 = g.debugSim(2.5, { throttle: 0.5, steer: 1 }); out.turned = Math.abs(s2.yawDeg - s1.yawDeg);
  // (الفرامل وهي واقفة بتبقى ريوس — بناخد أقل سرعة وصلتلها ووقت الوقوف)
  let vMin = 1e9, tStop = 0; for (let i = 0; i < 60 && vMin > 0.5; i++) { vMin = Math.min(vMin, Math.abs(g.debugSim(0.05, { brake: 1 }).kmh)); tStop += 0.05; }
  out.vStop = vMin; out.tStop = +tStop.toFixed(2);
  return out;
});
await b.close();
console.log(JSON.stringify({ r, errs }));
const ok = r.vTop > 15 && r.vTop < 32 && r.turned > 20 && r.vStop < 2 && !errs.length;
console.log(ok ? 'PASS golf-drive' : 'FAIL golf-drive'); process.exit(ok ? 0 : 1);
