// =====================================================================
//  المطبات: (1) موجودة في البيانات وفي ارتفاع الأرض (مش رسمة)، (2) سواقة فيزيا حقيقية على مطب حقيقي من OSM
//  بسرعة واطية وعالية: المساعدين بيشتغلوا، الهزة أكبر مع السرعة، العربية ماتتقلبش/تطيرش، ونفس المسافة من غير
//  المطب = هادية. (3) العربيات التانية بتهدّي قبله.   node tools/tests/speed-bumps.mjs [baseUrl] [map]
// =====================================================================
const PW = process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);
const BASE = process.argv[2] || 'http://localhost:5173/';
const MAP = process.argv[3] || 'giza';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await browser.newPage({ viewport: { width: 640, height: 360 } });
p.setDefaultTimeout(1200000);
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(`${BASE}?map=${MAP}`);
await p.waitForFunction(() => !document.getElementById('go').disabled);
await p.evaluate(() => document.getElementById('go').click()); await p.waitForTimeout(1500);
await p.evaluate(() => document.querySelector('#linepick .lp-close')?.click());
const res = await p.evaluate(async () => {
  const g = game, W = g.world, B = W.bumps;
  g.renderer.setAnimationLoop(null);
  const out = { total: B?.list.length || 0, osm: B?.list.filter((b) => b.src === 0).length || 0, onEdges: B?.list.filter((b) => b.edge).length || 0, mesh: !!B?.mesh?.parent };
  const settle = async (x, z) => { for (let k = 0; k < 300; k++) { W.updateVisibility({ x, z }, 560); W.update(0.05); if (!W.queue.length && k > 6) break; await new Promise((r) => setTimeout(r, 5)); } };
  // مطب حقيقي عادي على شارع مستقيم كفاية
  const cand = B.list.filter((b) => b.src === 0 && b.kind === 0 && b.edge && !b.edge.elevated && b.edge.length > 80 && !/motorway|trunk/.test(b.edge.cls));
  const { edgePoint } = await import('/src/world/shibin/ShibinData.js');
  let pick = null;
  for (const b of cand) {
    const sb = b.edge.bumps.find((s) => Math.abs(edgePoint(b.edge, s).x - b.x) < 1 && Math.abs(edgePoint(b.edge, s).z - b.z) < 1);
    if (sb === undefined || sb < 45 || b.edge.length - sb < 25) continue;
    // الجزء قبله مستقيم (± 12°)
    const a = edgePoint(b.edge, sb - 40), c = edgePoint(b.edge, sb);
    if (Math.abs(a.dx * c.dx + a.dz * c.dz) < 0.97) continue;
    pick = { b, sb }; break;
  }
  if (!pick) return { ...out, error: 'no straight OSM bump' };
  const { b, sb } = pick, e = b.edge;
  await settle(b.x, b.z);
  out.peak = +W.height(b.x, b.z, 0).toFixed(3);
  out.where = { x: b.x, z: b.z, street: e.name || null, cls: e.cls };
  const drive = async (kmh, withBump) => {
    const save = W.bumps; if (!withBump) W.bumps = null;
    const ph = g.player.physics, s0 = edgePoint(e, sb - 40);
    W.refY = 0; ph.reset(s0.x, s0.z, Math.atan2(-s0.dx, -s0.dz)); g.player._savePrev();
    for (let k = 0; k < 60; k++) g.debugSim(1 / 60, { handbrake: 1 });
    const v = kmh / 3.6; ph.vx = -Math.sin(ph.yaw) * v; ph.vz = -Math.cos(ph.yaw) * v;
    let maxPV = 0, maxHV = 0, maxComp = 0, maxPitch = 0, flips = 0, maxY = 0, t = 0, camMax = 0;
    const cy0 = [];
    while (t < 30) {
      // دركسيون على خط الشارع
      const [fx, fz] = ph.forward;
      const ahead = { x: ph.x + fx * 8, z: ph.z + fz * 8 }, n2 = W.nearestRoad(ahead.x, ahead.z, 20);
      const wx = (n2?.x ?? ahead.x) - ph.x, wz = (n2?.z ?? ahead.z) - ph.z, ang = Math.atan2(fx * wz - fz * wx, fx * wx + fz * wz);
      const sp = ph.forwardSpeed;
      g.debugSim(1 / 60, { throttle: sp < v - 0.3 ? 0.6 : 0, brake: sp > v + 0.8 ? 0.3 : 0, steer: Math.max(-1, Math.min(1, -ang * 2)) });
      t += 1 / 60;
      maxPV = Math.max(maxPV, Math.abs(ph.pitchVel || 0)); maxHV = Math.max(maxHV, Math.abs(ph.heaveVel || 0));
      for (const w of ph.wheels) maxComp = Math.max(maxComp, w.compressionVel);
      maxPitch = Math.max(maxPitch, Math.abs(ph.pitch)); maxY = Math.max(maxY, ph.heave - ph.spec.cgHeight);
      if (ph.flip.mode) flips++;
      g.cams.mode = 0; g.cams.update(1 / 60); cy0.push(g.camera.position.y);
      const along = (ph.x - b.x) * b.dx + (ph.z - b.z) * b.dz;
      if (Math.abs(along) > 12 && (ph.x - s0.x) * s0.dx + (ph.z - s0.z) * s0.dz > 52) break;
    }
    let jerk = 0; for (let i = 2; i < cy0.length; i++) jerk = Math.max(jerk, Math.abs(cy0[i] - 2 * cy0[i - 1] + cy0[i - 2]));
    W.bumps = save;
    return { kmh, withBump, maxPitchVel: +maxPV.toFixed(3), maxHeaveVel: +maxHV.toFixed(3), maxWheelCompVel: +maxComp.toFixed(3), maxPitchDeg: +(maxPitch * 57.3).toFixed(2), maxBodyY: +maxY.toFixed(2), flips, camJerk: +(jerk * 1000).toFixed(2) };
  };
  out.flat30 = await drive(30, false);
  out.slow10 = await drive(10, true);
  out.fast30 = await drive(30, true);
  out.fast45 = await drive(45, true);
  return out;
});
await browser.close();
const R = res;
const checks = R.error ? { found: false } : {
  data: R.total > 0 && R.osm > 0 && R.onEdges > R.total * 0.8 && R.mesh,
  inHeight: R.peak > 0.07 && R.peak < 0.12,
  feltAt10: R.slow10.maxWheelCompVel > R.flat30.maxWheelCompVel + 0.1,
  harderWhenFast: R.fast30.maxPitchVel > R.slow10.maxPitchVel && R.fast30.maxWheelCompVel > R.slow10.maxWheelCompVel,
  flatQuiet: R.flat30.maxPitchVel < R.fast30.maxPitchVel * 0.5,
  noFlip: R.fast45.flips === 0 && R.fast45.maxBodyY < 0.6,
  cameraMoves: R.fast30.camJerk > R.flat30.camJerk,
  noErrors: !errs.length,
};
console.log(JSON.stringify({ R, checks, errs }, null, 1));
const pass = Object.values(checks).every(Boolean);
console.log(pass ? 'PASS speed-bumps' : 'FAIL speed-bumps ' + Object.keys(checks).filter((k) => !checks[k]).join(','));
process.exit(pass ? 0 : 1);
