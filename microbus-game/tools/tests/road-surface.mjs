// =====================================================================
//  فحص سطح الطريق: (1) بنمشي على كل وصلات الشبكة اللي فيها ارتفاع (كباري/مطالع) كل 25سم ونقيس
//  أي قفزة مفاجئة في ارتفاع الأرض اللي الفيزيا شايفاها. (2) سواقة فيزيا حقيقية (autopilot) فوق
//  الكوبري العلوي في الاتجاهين وبنسجل أقصى ميل/قفزة/انقلاب.
//    node tools/tests/road-surface.mjs [baseUrl]
// =====================================================================
const PW = process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);
const BASE = process.argv[2] || 'http://localhost:5173/';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await browser.newPage({ viewport: { width: 640, height: 360 } });
p.setDefaultTimeout(1200000);
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(`${BASE}?map=shibin`);
await p.waitForFunction(() => !document.getElementById('go').disabled);
await p.evaluate(() => document.getElementById('go').click()); await p.waitForTimeout(1500);
const res = await p.evaluate(async () => {
  const g = game, W = g.world;
  g.renderer.setAnimationLoop(null);
  const settle = async (x, z) => { for (let k = 0; k < 300; k++) { W.updateVisibility({ x, z }, 560); W.update(0.05); if (!W.queue.length && k > 6) break; await new Promise((r) => setTimeout(r, 5)); } };
  const { edgePoint } = await import('/src/world/shibin/ShibinData.js');
  // ===== 1) الارتفاع على طول كل وصلة عالية (من غير اللي بتعدّي تحتها) =====
  const steps = [];
  const elevated = W.graph.edges.filter((e) => e.elevated);
  const q = {};
  for (const e of elevated) {
    await settle(e.pts[0].x, e.pts[0].z);
    let prev = null;
    for (let s = 0; s <= e.length; s += 0.25) {
      edgePoint(e, s, q);
      if (prev === null) prev = q.y;
      const h = W.height(q.x, q.z, prev ?? 0);
      if (prev !== null && Math.abs(h - prev) > 0.06) steps.push({ edge: e.id, name: e.name, s: +s.toFixed(1), from: +prev.toFixed(2), to: +h.toFixed(2), expected: +q.y.toFixed(2) });
      prev = h;
    }
  }
  // ===== 2) سواقة فيزيا فوق الكوبري العلوي =====
  const { findRoute } = await import('/src/nav/RoadGraph.js');
  const deck = elevated.filter((e) => e.name === 'كوبرى شبين الكوم العلوي');
  const drives = [];
  // كل وصلة كوبري: من 60م قبلها (على امتداد أول قطعة) لحد 40م بعدها، والاتجاه حسب الاتجاه الواحد
  const ramps = elevated.filter((e) => e.name === 'كوبرى شبين الكوم العلوي' || e.length > 40);
  for (const e of ramps.slice(0, 12)) {
    const dirs = e.oneway ? [1] : [1, -1];
    for (const dir of dirs) {
      const P = dir > 0 ? e.pts : [...e.pts].reverse();
      const a = P[0], a1 = P[1], b = P[P.length - 1], b0 = P[P.length - 2];
      const ux = (a1.x - a.x) / (Math.hypot(a1.x - a.x, a1.z - a.z) || 1), uz = (a1.z - a.z) / (Math.hypot(a1.x - a.x, a1.z - a.z) || 1);
      const vx = (b.x - b0.x) / (Math.hypot(b.x - b0.x, b.z - b0.z) || 1), vz = (b.z - b0.z) / (Math.hypot(b.x - b0.x, b.z - b0.z) || 1);
      // الوصلة بتبدأ فوق (جزء من نص الكوبري): نبدأ عليها نفسها؛ غير كده من الأرض قبلها بـ 60م
      const startHigh = a.y > 0.5;
      // الامتداد قبل/بعد بس لو النقطة فعلًا على طريق (مش جوه ترعة أو عمارة)
      const onRoad = (x, z) => { const r0 = W.nearestRoad(x, z, 30); return r0 && r0.d < r0.e.half - 0.5 && !r0.e.elevated; };
      const pre = startHigh ? [] : [[60], [30]].map(([d]) => ({ x: a.x - ux * d, z: a.z - uz * d })).filter((q3) => onRoad(q3.x, q3.z));
      const post = b.y > 0.5 ? [] : [[20], [40]].map(([d]) => ({ x: b.x + vx * d, z: b.z + vz * d })).filter((q3) => onRoad(q3.x, q3.z));
      const pts = [...pre, ...P, ...post];
      // الحارة اليمين
      const off = e.oneway ? 0 : Math.min(1.8, e.half * 0.5);
      const lane = pts.map((p0, i) => { const q1 = pts[Math.min(pts.length - 1, i + 1)], q0 = pts[Math.max(0, i - 1)]; const dx = q1.x - q0.x, dz = q1.z - q0.z, l = Math.hypot(dx, dz) || 1; return { x: p0.x - dz / l * off, z: p0.z + dx / l * off }; });
      const ph = g.player.physics, s0 = lane[0];
      await settle(s0.x, s0.z);
      W.refY = startHigh ? a.y : 0; ph.reset(s0.x, s0.z, Math.atan2(-ux, -uz)); g.player._savePrev(); g.debugSim(0.3, {});
      let maxPitch = 0, maxRoll = 0, maxVy = 0, flips = 0, maxY = 0, prevH = ph.heave, t = 0, stuck = 0, k = 1;
      const hits = [];
      const oi = ph.onImpact; ph.onImpact = (v, px, pz, other) => { if (v > 1.5) hits.push({ v: +v.toFixed(1), kind: other?.kind, at: [Math.round(px), Math.round(pz)], yMin: other?.yMin, yMax: other?.yMax, hz: other?.hz && +other.hz.toFixed(1), car: [+ph.x.toFixed(1), +ph.z.toFixed(1), +(ph.heave - ph.spec.cgHeight).toFixed(2)], refY: +W.refY.toFixed(2) }); };
      while (t < 60) {
        while (k < lane.length - 1 && Math.hypot(lane[k].x - ph.x, lane[k].z - ph.z) < 8) k++;
        const tg = lane[k], [fx, fz] = ph.forward;
        const wx = tg.x - ph.x, wz = tg.z - ph.z;
        const ang = Math.atan2(fx * wz - fz * wx, fx * wx + fz * wz);
        const steer = Math.max(-1, Math.min(1, -ang * 2.2));
        const v = ph.speed;
        g.debugSim(0.1, { throttle: v < 12 ? 0.75 : 0, brake: v > 14 ? 0.4 : 0, steer });
        W.updateVisibility({ x: ph.x, z: ph.z }, 560); W.update(0.1);
        t += 0.1;
        maxPitch = Math.max(maxPitch, Math.abs(ph.pitch)); maxRoll = Math.max(maxRoll, Math.abs(ph.roll));
        maxVy = Math.max(maxVy, Math.abs(ph.heave - prevH) / 0.1); prevH = ph.heave;
        maxY = Math.max(maxY, ph.heave - ph.spec.cgHeight);
        if (ph.flip.mode) flips++;
        stuck = v < 0.5 ? stuck + 0.1 : 0;
        if (k >= lane.length - 1 && Math.hypot(lane[k].x - ph.x, lane[k].z - ph.z) < 8) break;
        if (stuck > 5) break;
      }
      ph.onImpact = oi;
      const topH = Math.max(...P.map((q2) => q2.y));
      drives.push({ edge: e.id, name: e.name, dir, len: Math.round(e.length), topH: +topH.toFixed(1), done: k >= lane.length - 1, t: +t.toFixed(1), maxPitchDeg: +(maxPitch * 57.3).toFixed(1), maxRollDeg: +(maxRoll * 57.3).toFixed(1), maxVerticalSpeed: +maxVy.toFixed(2), maxY: +maxY.toFixed(2), flips, hits: hits.slice(0, 4) });
    }
  }
  return { elevatedEdges: elevated.length, steps: steps.length, stepList: steps.slice(0, 25), drives };
});
console.log(JSON.stringify(res, null, 1));
console.log('errors', errs.length);
await browser.close();
