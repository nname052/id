// node tools/tests/police-mission.mjs [url]
// مهمة الشرطة: البوكس + بلاغ + مشهد + مطاردة + مسك (بنقرّب العربية جنب الهربان)
const { chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs');
const BASE = process.argv[2] || 'http://localhost:5173/';
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1000, height: 560 } }); p.setDefaultTimeout(1200000);
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(BASE + '?map=shibin'); await p.waitForFunction(() => !document.getElementById('go').disabled);
await p.evaluate(() => document.getElementById('go').click()); await p.waitForTimeout(3000);
await p.evaluate(async () => {
  document.querySelector('#linepick .lp-close')?.click(); const g = game; g.renderer.setAnimationLoop(null); g.setVehicle('police');
  // نستنى البلاغ (بخطوات اللعبة نفسها)
  for (let i = 0; i < 30 * 40 && g.policeMission.state !== 'chase'; i++) { g.debugSim(1 / 30, {}); g.policeMission.update(1 / 30, g.player.physics, g.player); if (i % 30 === 0) await new Promise((r) => setTimeout(r, 0)); }
  g.cams.update(1 / 30, {}); g.cine.update(0.5, g.camera); g.renderer.render(g.scene, g.camera);
});
const s1 = await p.evaluate(() => ({ ...game.policeMission.debugStats(), cine: game.cine.active, kind: game.player.kind, bar: !!game.player.rig.policeBar, job: document.querySelector('#job')?.innerText }));

// تخطي المشهد
await p.keyboard.press('Space');
await p.evaluate(() => { const g = game; g.debugSim(1 / 30, {}); g.cams.update(1 / 30, {}); g.cine.update(1 / 30, g.camera); g.renderer.render(g.scene, g.camera); });
const s2 = await p.evaluate(() => ({ cine: game.cine.active, job: document.querySelector('#job')?.innerText }));

// نحط البوكس ورا الهربان ونمشي معاه
const s3 = await p.evaluate(async () => {
  const g = game, M = g.policeMission;
  for (let i = 0; i < 60 && M.state === 'chase'; i++) {
    const o = M.off; if (!o) break;
    g.player.physics.reset(o.x + Math.sin(o.yaw) * 6, o.z + Math.cos(o.yaw) * 6, o.yaw); g.player._savePrev();
    for (let k = 0; k < 4; k++) { g.debugSim(1 / 30, {}); M.update(1 / 30, g.player.physics, g.player); }
    await new Promise((r) => setTimeout(r, 0));
  }
  return { ...M.debugStats(), money: g.wallet.balance };
});
console.log(JSON.stringify({ s1, s2, s3, errs }));
const ok = s1.state === 'chase' && s1.cine && s1.bar && !s2.cine && s3.caught === 1 && !errs.length;
console.log(ok ? 'PASS police-mission' : 'FAIL police-mission');
await b.close(); process.exit(ok ? 0 : 1);
