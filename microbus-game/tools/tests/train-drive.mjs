// سواقة القطر (MAJOR UPDATE — STAGE 6): بيدخل القطر، يسرّع، يفرمل ويقف في المحطة التانية (الأبواب بتفتح)،
// يعكس الاتجاه، والمصدّ آخر الخط بيوقفه. فيزيا: 0→40 كم/س وقت معقول لقطر ركاب، ومسافة فرملة من 60.
//   node tools/tests/train-drive.mjs [url]
const { chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs');
const BASE = process.argv[2] || 'http://localhost:5173/';
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 800, height: 450 } }); p.setDefaultTimeout(900000);
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(`${BASE}?map=shibin`); await p.waitForFunction(() => !document.getElementById('go').disabled);
await p.evaluate(() => document.getElementById('go').click()); await p.waitForTimeout(2000);
const r = await p.evaluate(async () => {
  const g = game; document.querySelector('#linepick .lp-close')?.click(); g.renderer.setAnimationLoop(null);
  g.setVehicle('train');
  const td = g.trainDrive, T = td?.T, out = { driving: g.driving, ok: !!td?.ok };
  if (!td?.ok) return out;
  const step = (n, inp) => { for (let i = 0; i < n; i++) { g.clock.getDelta(); g.clock.elapsedTime += 1 / 30; g.trainDrive.update(1 / 30, inp); g.world.rail.update(1 / 30, g.camera.position); } };
  out.s0 = Math.round(T.s); out.len = T.len; out.lineLen = Math.round(g.world.rail.line.length);
  // 1) التسارع: 0→40 كم/س
  let t = 0; while (T.v * 3.6 < 40 && t < 120) { step(1, { throttle: 1 }); t += 1 / 30; }
  out.t0to40 = +t.toFixed(1);
  // 2) فرملة كاملة من السرعة دي: المسافة
  const s1 = T.s, v1 = T.v; t = 0; while (T.v > 0.01 && t < 60) { step(1, { brake: 1 }); t += 1 / 30; }
  out.brakeFrom = Math.round(v1 * 3.6); out.brakeDist = +Math.abs(T.s - s1).toFixed(1);
  // 3) الاتجاه العكسي بالفرامل وهو واقف
  const d0 = T.dir; step(45, { brake: 1 }); out.reversed = T.dir === -d0;
  // 4) يروح لمحطة (أي محطة غير اللي اتخدمت) ويقف في نص الرصيف → الأبواب
  const R = g.world.rail, st = R.stations.find((q) => q !== td.served) || null;
  out.stations = R.stations.length;
  if (st) {
    T.dir = Math.sign(st.s - (T.s - T.dir * T.len / 2)) || 1;
    // نحط القطر قبل المحطة بمسافة ونسوق بالتحكم: نوصل ونفرمل على نص الرصيف
    T.s = Math.max(T.len + 3, Math.min(R.line.length - 3, st.s + T.dir * T.len / 2 - T.dir * 120)); T.v = 0; td.served = null;
    let doors = false; t = 0;
    while (t < 200 && !doors) {
      const mid = T.s - T.dir * T.len / 2, rem = (st.s - mid) * T.dir;
      const vT = Math.sqrt(Math.max(0, 2 * 0.6 * Math.max(0, rem)));
      step(1, T.v < vT - 0.3 ? { throttle: 0.6 } : T.v > vT ? { brake: 0.8 } : {});
      if (td.doors > 0) doors = true; t += 1 / 30;
    }
    out.doorsAtStation = doors; out.earned = td.earned;
  }
  // 5) المصدّ: لو سوقت لآخر الخط القطر بيقف جوه الخط
  T.dir = 1; T.s = R.line.length - 60; T.v = 12; td.doors = 0; step(30 * 20, { throttle: 1 });
  out.bufferStop = T.s <= R.line.length - 1.9 && T.v === 0;
  // 6) الكاميرا قدام الجرار
  g.cams.mode = 0; td.camera(g.camera, 0, 1 / 30); const c = T.cars[0].m.position;
  out.camDist = +Math.hypot(g.camera.position.x - c.x, g.camera.position.z - c.z).toFixed(1); out.camY = +g.camera.position.y.toFixed(2);
  g.setVehicle('microbus'); out.backToCar = g.driving === null && g.player.rig.root.visible;
  return out;
});
await b.close();
console.log(JSON.stringify({ r, errs }));
const ok = r.ok && r.driving === 'train' && r.t0to40 > 8 && r.t0to40 < 40 && r.brakeDist > 20 && r.brakeDist < 120 && r.reversed && (r.stations < 2 || r.doorsAtStation) && r.bufferStop && r.camDist < 12 && r.backToCar && !errs.length;
console.log(ok ? 'PASS train-drive' : 'FAIL train-drive'); process.exit(ok ? 0 : 1);
