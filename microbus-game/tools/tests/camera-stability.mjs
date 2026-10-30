// =====================================================================
//  ثبات الكاميرا اللي ورا العربية: (1) المسافة مابتكبرش مع السرعة، (2) مفيش رعشة (الكاميرا بالنسبة للعربية
//  المرسومة مابتتنططش من فريم للتاني)، (3) العربية مالية حتة كويسة من الشاشة.
//  بنفس لوب اللعبة: فيزيا بخطوة ثابتة 1/120 + فريمات 1/50 (مش مضاعفات) + interpolation.
//   node tools/tests/camera-stability.mjs [baseUrl] [kind ...]
// =====================================================================
const PW = process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);
const BASE = process.argv[2] || 'http://localhost:5173/';
const KINDS = process.argv.slice(3).length ? process.argv.slice(3) : ['microbus', 'taxi', 'car', 'truck'];
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await browser.newPage({ viewport: { width: 640, height: 360 } }); p.setDefaultTimeout(900000);
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(`${BASE}?map=shibin`); await p.waitForFunction(() => !document.getElementById('go').disabled);
await p.evaluate(() => document.getElementById('go').click()); await p.waitForTimeout(1500);
const R = await p.evaluate(async (KINDS) => {
  const g = game; g.renderer.setAnimationLoop(null);
  g.world.height = () => 0; g.cams._avoidWalls = () => {}; // (من غير حيطان: بنقيس الكاميرا نفسها) // أرض مستوية ومفيش حيطان: بنقيس الكاميرا بس
  const out = {};
  for (const k of KINDS) {
    g.setVehicle(k); const P = g.player, ph = P.physics, cams = g.cams;
    ph.reset(0, 0, 0); P._savePrev(); cams.mode = 1; cams.snap = true;
    const FIX = 1 / 120, FDT = 1 / 50; let acc = 0;
    const frame = (inp) => {
      acc += FDT; let n = 0;
      while (acc >= FIX && n < 8) { P.beforeStep(); ph.step(FIX, { throttle: 0, brake: 0, steer: 0, handbrake: 0, actions: {}, ...inp }, () => []); acc -= FIX; n++; }
      P.syncVisuals(FDT, acc / FIX); cams.update(FDT, {});
    };
    const res = {};
    for (const kmh of [20, 50, 80]) {
      // نوصل للسرعة ونثبت عليها
      for (let i = 0; i < 2500 && ph.speed * 3.6 < kmh; i++) frame({ throttle: 1 });
      const rel = [];
      for (let i = 0; i < 100; i++) {
        frame({ throttle: ph.speed * 3.6 < kmh ? 0.6 : 0.1 });
        const r = P.rig.root, c = g.camera.position, yaw = r.rotation.y;
        const dx = c.x - r.position.x, dz = c.z - r.position.z;
        // في إطار العربية (قدام/جنب) + الارتفاع فوق جسم العربية المرسوم
        rel.push([dx * Math.cos(yaw) - dz * Math.sin(yaw), dx * Math.sin(yaw) + dz * Math.cos(yaw), c.y - P.rig.body.position.y]);
      }
      let jit = 0; for (let i = 2; i < rel.length; i++) for (let a = 0; a < 3; a++) jit = Math.max(jit, Math.abs(rel[i][a] - 2 * rel[i - 1][a] + rel[i - 2][a]));
      const d = rel.reduce((s, q) => s + Math.hypot(q[0], q[1]), 0) / rel.length;
      res[kmh] = { kmh: +(ph.speed * 3.6).toFixed(0), dist: +d.toFixed(2), jitterMm: +(jit * 1000).toFixed(2) };
    }
    out[k] = { kind: P.kind, len: +(ph.spec.halfLength * 2).toFixed(2), ...res };
  }
  return out;
}, KINDS);
await browser.close();
const checks = {};
for (const [k, r] of Object.entries(R)) {
  checks[`${k}:noZoomOut`] = Math.abs(r[80].dist - r[20].dist) < 0.25;
  checks[`${k}:noJitter`] = r[20].jitterMm < 6 && r[50].jitterMm < 6 && r[80].jitterMm < 6;
  checks[`${k}:close`] = r[50].dist < r.len * 0.8 + 3.0;
}
checks.noErrors = !errs.length;
console.log(JSON.stringify({ R, checks, errs }, null, 1));
const pass = Object.values(checks).every(Boolean);
console.log(pass ? 'PASS camera-stability' : 'FAIL camera-stability ' + Object.keys(checks).filter((k) => !checks[k]).join(','));
process.exit(pass ? 0 : 1);
