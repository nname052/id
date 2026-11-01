// الجولة السياحية بعربية الجولف (MAJOR UPDATE — STAGE 5) في الجيزة: فيه معالم حقيقية من OSM (الأهرامات)،
// السايح بيظهر ويركب (بيقعد في كرسي الراكب)، المحطات بالترتيب (مشهد التصوير)، الرجوع → فلوس، ومن غير أخطاء.
// وفي شبين (مفيش معالم أثرية): المهمة مابتشتغلش ومابتوقعش حاجة.
//   node tools/tests/tour-mission.mjs [url]
const { chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs');
const BASE = process.argv[2] || 'http://localhost:5173/';
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const out = {};
for (const map of ['giza', 'shibin']) {
  const p = await b.newPage({ viewport: { width: 800, height: 450 } }); p.setDefaultTimeout(900000);
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(`${BASE}?map=${map}`); await p.waitForFunction(() => !document.getElementById('go').disabled);
  await p.evaluate(() => document.getElementById('go').click()); await p.waitForTimeout(2000);
  out[map] = await p.evaluate(async () => {
    const g = game; document.querySelector('#linepick .lp-close')?.click(); g.renderer.setAnimationLoop(null);
    await g.setVehicle('golf');
    const T = g.tourMission, ph = g.player.physics, r = { pois: T?.pois.length || 0, available: !!T?.available };
    const tick = (n) => { for (let i = 0; i < n; i++) { T.update(1 / 30, ph, g.player); g.cine?.update(1 / 30, g.camera); } };
    const at = (x, z) => { ph.reset(x, z, ph.yaw || 0); g.player._savePrev(); };
    tick(30 * 5); // الانتظار → السايح يظهر
    r.afterWait = T.state;
    if (!T.available) return r;
    r.stops = T.stops?.map((s) => s.name); r.pickDist = Math.round(T.dist);
    r.touristShown = (T.extras?.length || 0) > 0;
    at(T.pick.rx, T.pick.rz); tick(30 * 4);
    r.seated = !!g.passengers.seats?.[0]?.pax && !!g.passengers.seatedMesh;
    r.legs = [];
    const w0 = g.wallet?.balance ?? g.wallet?.cash ?? 0;
    for (let k = 0; k < (T.stops?.length || 0); k++) {
      const S = T.stops[T.leg]; at(S.tx, S.tz); tick(30 * 1);
      const cine = !!g.cine?.active; tick(30 * 6);
      r.legs.push({ name: S.name, cine, standoff: Math.round(Math.hypot(S.tx - S.x, S.tz - S.z)), r: Math.round(S.r) });
    }
    r.back = T.state;
    at(T.pick.rx, T.pick.rz); tick(30 * 1);
    r.done = T.done; r.paid = (g.wallet?.balance ?? g.wallet?.cash ?? 0) - w0; r.seatFreed = !g.passengers.seats?.[0]?.pax;
    return r;
  });
  out[map].errs = errs;
  await p.close();
}
await b.close();
console.log(JSON.stringify(out, null, 1));
const G = out.giza, S = out.shibin;
const ok = G.available && G.pois >= 2 && G.touristShown && G.seated && G.legs.length >= 2 && G.legs.every((l) => l.cine) && G.back === 'toBack' && G.done === 1 && G.seatFreed &&
  !S.available && !G.errs.length && !S.errs.length;
console.log(ok ? 'PASS tour-mission' : 'FAIL tour-mission'); process.exit(ok ? 0 : 1);
