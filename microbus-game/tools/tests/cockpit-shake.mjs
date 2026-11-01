// منظور السواق: الكابينة (التابلوه/الدركسيون) لازم تبقى ثابتة قدام عينك — الرعشة = الكاميرا بتلف بالنسبة للكابينة.
// بنسوق 6 ث في اللعب الحقيقي (requestAnimationFrame) ونقيس كل فريم:
//   rel = زاوية الكاميرا بالنسبة لجسم العربية (الكابينة)، jitter = تغيّرها من فريم للتاني (درجات)
//   horizon = سرعة تغيّر ميل الأفق (لازم تفضل هادية)
//   node tools/tests/cockpit-shake.mjs [url] [kind]
const { chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs');
const BASE = process.argv[2] || 'http://localhost:5173/', KIND = process.argv[3] || 'microbus';
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 640, height: 360 } }); p.setDefaultTimeout(900000);
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(`${BASE}?map=shibin`); await p.waitForFunction(() => !document.getElementById('go').disabled);
await p.evaluate(() => document.getElementById('go').click()); await p.waitForTimeout(3000);
const r = await p.evaluate(async ([KIND, JIT]) => {
  const g = game; document.querySelector('#linepick .lp-close')?.click();
  if (g.player.kind !== KIND) await g.setVehicle(KIND);
  g.renderer.render = () => {}; if (g.postfx) g.postfx.render = () => {};
  g.cams.mode = 0; g.cams.snap = true;
  // مشوار حقيقي في المدينة (تقاطعات، أرصفة، مطبات): من مكان البداية لنقطة على بعد ~500م بالطريق
  const W = g.world, ph = g.player.physics;
  const { findRoute } = await import('/src/nav/RoadGraph.js');
  let route = null, seed = 12345; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647); // (مسار ثابت: الاختبار مايعتمدش على الحظ)
  for (let k = 0; k < 80 && !route; k++) {
    const e = W.graph.edges[Math.floor(rnd() * W.graph.edges.length)];
    if (!e || e.elevated || e.closed) continue;
    const q = e.pts[Math.floor(e.pts.length / 2)];
    const d = Math.hypot(q.x - ph.x, q.z - ph.z); if (d < 300 || d > 700) continue;
    const r = findRoute(ph.x, ph.z, q.x, q.z); const rp = r?.pts || r?.points || (Array.isArray(r) ? r : null); if (rp?.length > 4) route = rp.map((p) => ({ x: p.x ?? p[0], z: p.z ?? p[1] }));
  }
  let kp = 1; const curbs = []; const oc = ph.onCurb; ph.onCurb = (rise, v) => { curbs.push([+rise.toFixed(3), +v.toFixed(1)]); oc?.(rise, v); };
  const inp = g.input; const orig = inp.read?.bind(inp);
  // بنزين نص طول الوقت
  g.input.forceThrottle = 0.55;
  const THREE = await import('/node_modules/.vite/deps/three.js');
  const qc = new THREE.Quaternion(), qb = new THREE.Quaternion(), qr = new THREE.Quaternion();
  const rel = [], hor = [];
  // (لعب حقيقي بفريمات ثابتة 60/ث: الـ _frame نفسه بكل اللي فيه — الفيزيا، الاستيفاء، الكاميرا)
  let fi = 0; const DTS = JIT ? [1 / 60, 1 / 38, 1 / 90, 1 / 55, 1 / 72, 1 / 45] : [1 / 60]; g.clock.getDelta = () => DTS[fi++ % DTS.length]; g.renderer.setAnimationLoop(null);
  let shakeFrames = 0;
  for (let i = 0; i < 900; i++) {
    if (route) { // pure pursuit على المسار
      while (kp < route.length - 1 && Math.hypot(route[kp].x - ph.x, route[kp].z - ph.z) < 9) kp++;
      const tg = route[kp], [fx, fz] = ph.forward, wx = tg.x - ph.x, wz = tg.z - ph.z;
      const ang = Math.atan2(fx * wz - fz * wx, fx * wx + fz * wz);
      g.input.forceSteer = Math.max(-1, Math.min(1, -ang * 2.2)) || 0;
      g.input.forceThrottle = ph.speed < 10 ? 0.6 : 0.05;
    }
    g._frame();
    if (g.cams.shake > 0) shakeFrames++;
    const cam = g.camera, body = g.player.rig.eye.parent;
    cam.updateMatrixWorld(); cam.getWorldQuaternion(qc); body.getWorldQuaternion(qb);
    qr.copy(qb).invert().multiply(qc);
    const e = new THREE.Euler().setFromQuaternion(qr, 'YXZ');
    const lp = body.worldToLocal(cam.getWorldPosition(new THREE.Vector3()));
    if (i > 60) rel.push([e.x, e.z, lp.x, lp.y, lp.z]);
    const ec = new THREE.Euler().setFromQuaternion(qc, 'YXZ'); if (i > 60) hor.push(ec.z);
  }
  g.input.forceThrottle = 0; g.input.forceSteer = 0;
  const d = (A) => { let s = 0, m = 0; for (let i = 2; i < A.length; i++) { const v = Math.abs(A[i] - A[i - 1]) * 57.3; s += v; m = Math.max(m, v); } return [+(s / (A.length - 2)).toFixed(3), +m.toFixed(3)]; };
  return { route: route?.length || 0, done: kp, curbs: curbs.length, curbSample: curbs.slice(0, 6), shakeFrames, frames: rel.length, kmh: Math.round(g.player.physics.speed * 3.6), relPitchJitter: d(rel.map((q) => q[0])), relRollJitter: d(rel.map((q) => q[1])), horizonRate: d(hor), relPosJitterMm: d(rel.map((q) => q[3])).map((v) => +(v / 57.3 * 1000).toFixed(2)), relPosZJitterMm: d(rel.map((q) => q[4])).map((v) => +(v / 57.3 * 1000).toFixed(2)), relPitchRangeDeg: +((Math.max(...rel.map((q) => q[0])) - Math.min(...rel.map((q) => q[0]))) * 57.3).toFixed(2) };
}, [KIND, !!process.env.JITTER]);
await b.close();
console.log(JSON.stringify({ r, errs }));
// الكابينة ثابتة: مفيش لف بين العين والكابينة، والعين بتتحرك جوه الكابينة أقل من 3 مم في الفريم، والأفق هادي
const ok = r.frames > 300 && r.kmh > 15 && r.relPitchJitter[1] < 0.02 && r.relRollJitter[1] < 0.02 && r.relPosJitterMm[1] < 3 && r.relPosZJitterMm[1] < 3 && r.horizonRate[1] < 0.15 && !errs.length;
console.log(ok ? 'PASS cockpit-shake' : 'FAIL cockpit-shake'); process.exit(ok ? 0 : 1);
