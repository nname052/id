// =====================================================================
//  "العربية بتربش": رعشة جسم العربية المرسوم والكاميرا وهي ماشية على طريق حقيقي بسرعة ثابتة.
//  بنفس لوب اللعبة (فيزيا 1/120 ثابتة + فريمات متغيرة 1/45–1/60 + interpolation)، على أرض شبين الحقيقية.
//  بيقيس: أكبر تغيّر مفاجئ من فريم للتاني (التسارع/الفرق التاني) في الـ pitch/roll/الارتفاع، وتذبذب الـ pitch (درجة).
//   node tools/tests/ride-smoothness.mjs [url] [kind ...]
// =====================================================================
const { chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs');
const BASE = process.argv[2] || 'http://localhost:5173/';
const KINDS = process.argv.slice(3).length ? process.argv.slice(3) : ['microbus', 'car', 'taxi', 'bus'];
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 400, height: 300 } }); p.setDefaultTimeout(900000);
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(`${BASE}?map=shibin`); await p.waitForFunction(() => !document.getElementById('go').disabled);
await p.evaluate(() => document.getElementById('go').click()); await p.waitForTimeout(1500);
const R = await p.evaluate(async (KINDS) => {
  document.querySelector('#linepick .lp-close')?.click();
  const g = game, W = g.world; g.renderer.setAnimationLoop(null);
  const out = {};
  let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (const k of KINDS) {
    g.setVehicle(k); const P = g.player, ph = P.physics, cams = g.cams;
    const sp = W.spawnPose(); ph.reset(sp.x, sp.z, sp.yaw); P._savePrev();
    for (let i = 0; i < 60; i++) { W.updateVisibility({ x: ph.x, z: ph.z }, 400); W.update(0.05); if (!W.queue.length && i > 5) break; await new Promise((q) => setTimeout(q, 5)); }
    cams.mode = 1; cams.snap = true;
    const FIX = 1 / 120; let acc = 0;
    const frame = (inp, FDT) => {
      acc += FDT; let n = 0;
      while (acc >= FIX && n < 8) { W.refY = ph.heave - ph.spec.cgHeight; P.beforeStep(); ph.step(FIX, { throttle: 0, brake: 0, steer: 0, handbrake: 0, actions: {}, ...inp }, g._colliders); acc -= FIX; n++; }
      P.syncVisuals(FDT, acc / FIX); cams.update(FDT, {});
    };
    const res = {};
    // (ثابت 30 و55، تعريج بالدركسيون، ودوسة بنزين وفرامل مفاجئة)
    for (const mode of ['30', '55', 'weave', 'stopgo']) {
      const kmh = mode === '55' ? 55 : 35;
      ph.reset(sp.x, sp.z, sp.yaw); P._savePrev();
      for (let i = 0; i < 1500 && ph.speed * 3.6 < kmh; i++) frame({ throttle: 0.8 }, 1 / 60);
      const s = []; let T = 0;
      for (let i = 0; i < 240; i++) {
        const FDT = 1 / (45 + rnd() * 15); T += FDT;
        const inp = mode === 'weave' ? { throttle: ph.speed * 3.6 < kmh ? 0.45 : 0.05, steer: Math.sin(T * 2.2) * 0.35 }
          : mode === 'stopgo' ? (Math.floor(T / 1.0) % 2 ? { brake: 0.9 } : { throttle: 1 })
          : { throttle: ph.speed * 3.6 < kmh ? 0.45 : 0.05 };
        frame(inp, FDT);
        const bd = P.rig.body, c = g.camera.position, r = P.rig.root;
        s.push([bd.rotation.x, bd.rotation.z, bd.position.y, c.y - r.position.y, Math.hypot(c.x - r.position.x, c.z - r.position.z), ph.speed * 3.6, ph.wheels.some((w) => Math.abs(w.ground ?? 0) > 0.04)]);
      }
      // (بنستبعد لحظات الخبط — السرعة نزلت فجأة — وطلوع الرصيف: دي حاجات حقيقية مش رعشة)
      const hitAt = new Set(); for (let i = 1; i < s.length; i++) if (s[i - 1][5] - s[i][5] > 1.5 && !(mode === 'stopgo') || s[i][6]) for (let j = i - 2; j <= i + 6; j++) hitAt.add(j);
      const d2 = (a) => { let m = 0; for (let i = 2; i < s.length; i++) { if (hitAt.has(i)) continue; m = Math.max(m, Math.abs(s[i][a] - 2 * s[i - 1][a] + s[i - 2][a])); } return m; };
      const rangeOf = (a) => { let lo = Infinity, hi = -Infinity; for (const q of s) { lo = Math.min(lo, q[a]); hi = Math.max(hi, q[a]); } return hi - lo; };
      // عدد مرات تغيير اتجاه الـ pitch (تذبذب سريع)
      let flips = 0; for (let i = 2; i < s.length; i++) { const a = s[i][0] - s[i - 1][0], b2 = s[i - 1][0] - s[i - 2][0]; if (a * b2 < 0 && Math.abs(a) > 1e-4) flips++; }
      res[mode] = { mode, kmh: Math.round(ph.speed * 3.6), camDistJerkMm: +(d2(4) * 1000).toFixed(1), pitchJerkDeg: +(d2(0) * 57.3).toFixed(3), rollJerkDeg: +(d2(1) * 57.3).toFixed(3), heaveJerkMm: +(d2(2) * 1000).toFixed(1), camJerkMm: +(d2(3) * 1000).toFixed(1), pitchRangeDeg: +(rangeOf(0) * 57.3).toFixed(2), heaveRangeMm: +(rangeOf(2) * 1000).toFixed(0), pitchFlips: flips };
    }
    out[k] = res;
  }
  return out;
}, KINDS);
await b.close();
console.log(JSON.stringify({ R, errs }, null, 1));
// العتبات: تغيير مفاجئ في الميل < 0.15° بين فريمين، والارتفاع < 6مم، والكاميرا < 8مم، ومفيش تذبذب سريع في الـ pitch (< 40 تغيير اتجاه في 4ث)
const checks = {};
for (const [k, r] of Object.entries(R)) for (const v of Object.values(r)) {
  checks[`${k}@${v.mode}`] = v.pitchJerkDeg < 0.15 && v.rollJerkDeg < 0.15 && v.heaveJerkMm < 6 && v.camJerkMm < 8 && v.camDistJerkMm < 8 && v.pitchFlips < 40;
}
const pass = Object.values(checks).every(Boolean) && !errs.length;
console.log(pass ? 'PASS ride-smoothness' : 'FAIL ride-smoothness ' + Object.keys(checks).filter((k) => !checks[k]).join(','));
process.exit(pass ? 0 : 1);
