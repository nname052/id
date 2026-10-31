// مقارنة العربيات بالحقيقة: 0→50، 0→100، أقصى سرعة، ومسافة الفرامل (على أرض مستوية من غير تصادم).
// المرجع (أرقام المصنّع/اختبارات منشورة، تقريبية): هاي إس 2.5 ديزل محمّل 0→100 ≈ 18–20ث وأقصى ≈ 145؛ لوجان 1.6 ≈ 11.5ث / 175؛
// سيدان 1.6 (تاكسي) ≈ 10–11ث / 175–180؛ بيك أب 2.5 ديزل ≈ 16–18ث / 145–150؛ كانتر 4.3ط أقصى ≈ 110–120؛ أتوبيس كاروسا أقصى ≈ 90؛ توكتوك أقصى ≈ 60–65.
// فرامل 100→0: ملاكي ≈ 42–46م، فان ≈ 46–52م، نقل ≈ 55–60م، أتوبيس ≈ 55–65م.      node tools/tests/vehicle-reality.mjs [url]
const { chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs');
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 640, height: 360 } }); p.setDefaultTimeout(900000);
await p.goto(`${process.argv[2] || 'http://localhost:5173/'}?map=shibin`); await p.waitForFunction(() => !document.getElementById('go').disabled);
await p.evaluate(() => document.getElementById('go').click()); await p.waitForTimeout(2000);
const r = await p.evaluate(async (kinds) => {
  const g = game, out = {};
  g.world.height = () => 0; g.world.nearestRoad = () => null; g._colliders = () => [];
  for (const kind of kinds) {
    await g.setVehicle(kind); await new Promise(r => setTimeout(r, 200));
    const ph = g.player.physics; g._colliders = () => [];
    const run = (sec, inp, until) => { let t = 0; for (let i = 0; i < sec * 20; i++) { const st = g.debugSim(0.05, inp); t += 0.05; if (until && until(st, t)) return [t, st]; } return [t, null]; };
    const [t50] = run(60, { throttle: 1 }, (s) => s.kmh >= 50);
    const [t100x] = run(80, { throttle: 1 }, (s) => s.kmh >= 100);
    let vmax = 0; run(60, { throttle: 1 }, (s) => { vmax = Math.max(vmax, s.kmh); return false; });
    // فرامل من 100 (أو من أقصى سرعة لو أقل): المسافة
    const v0 = ph.speed * 3.6; const x0 = ph.x, z0 = ph.z;
    run(30, { brake: 1 }, (s) => Math.abs(s.kmh) < 0.5);
    const dist = Math.hypot(ph.x - x0, ph.z - z0);
    out[kind] = { t50: +t50.toFixed(1), t100: +(t50 + t100x).toFixed(1), vmax: Math.round(vmax), brakeFrom: Math.round(v0), brakeDist: +dist.toFixed(1), mass: ph.spec.mass };
  }
  return out;
}, ['microbus', 'taxi', 'car', 'pickup', 'police', 'ambulance', 'truck', 'bus', 'tuktuk']);
console.log(JSON.stringify(r, null, 0).replace(/},/g, '},\n'));
const RANGE = { microbus: [16, 22, 135, 155], taxi: [9, 12.5, 160, 190], car: [10, 13.5, 155, 185], pickup: [15, 19.5, 135, 160], ambulance: [17, 23, 135, 155], truck: [30, 50, 105, 125], bus: [null, null, 85, 100], tuktuk: [null, null, 55, 70] };
let ok = true;
for (const [k, [a, bb, lo, hi]] of Object.entries(RANGE)) { const v = r[k]; const bad = (a !== null && (v.t100 < a || v.t100 > bb)) || v.vmax < lo || v.vmax > hi; if (bad) { ok = false; console.log('OUT OF RANGE', k, v); } }
console.log(ok ? 'PASS' : 'FAIL');
await b.close();
