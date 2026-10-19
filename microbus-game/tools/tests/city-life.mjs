// =====================================================================
//  حياة المدينة (شبين): سواقة على طريق حقيقي طويل + المرور والمركون والمشاة شغالين:
//   - ظهور/اختفاء عربية قدام الكاميرا جوه مدى الرؤية (pop-in) = لازم صفر
//   - مفيش عربيتين جوه بعض، ولا عربية ماشية جوه مركونة، والمركون على أسفلت
//   node tools/tests/city-life.mjs [baseUrl]
// =====================================================================
const PW = process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);
const BASE = process.argv[2] || 'http://localhost:5173/';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
page.setDefaultTimeout(1800000);
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${BASE}?map=shibin`);
await page.waitForFunction(() => !document.getElementById('go').disabled);
await page.click('#go'); await page.waitForTimeout(1500);
const r = await page.evaluate(async () => {
  const g = game, W = g.world, tr = g.traffic, cr = g.crowd, ph = g.player.physics;
  g.renderer.setAnimationLoop(null);
  const { findRoute } = await import('/src/nav/RoadGraph.js');
  const L = Object.fromEntries(W.landmarkPoints.map((l) => [l.id, l]));
  const sp = W.spawnPose();
  const legs = [[sp, L.menoufia_university], [L.menoufia_university, L.station_shibin_new]];
  const dt = 1 / 30, v = 11, VD = tr.viewDist;
  let pedOnRoad = 0, crossSeen = 0, groupsSeen = 0, carThroughPed = 0, dwells = 0, pullers = new Set(), pedPop = 0, popIn = 0, vanish = 0, overlapsMax = 0, parkedHit = 0, parkedBad = 0, parkedMax = 0, activeSum = 0, n = 0, pedSum = 0, steps = 0;
  const wasVis = new Map(), pop = [];
  for (const [a, b] of legs) {
    const rt = findRoute(a.rx ?? a.x, a.rz ?? a.z, b.rx ?? b.x, b.rz ?? b.z); // (المرحلة التانية تبدأ من نفس نقطة الطريق اللي الأولى خلصت عندها: مفيش نطّة كاميرا)
    for (let s = 0; s < rt.length; s += v * dt) {
      let i = 0; while (i < rt.pts.length - 2 && rt.cum[i + 1] < s) i++;
      const p0 = rt.pts[i], p1 = rt.pts[i + 1], t = (s - rt.cum[i]) / ((rt.cum[i + 1] - rt.cum[i]) || 1);
      const x = p0.x + (p1.x - p0.x) * t, z = p0.z + (p1.z - p0.z) * t;
      const l = Math.hypot(p1.x - p0.x, p1.z - p0.z) || 1, fx = (p1.x - p0.x) / l, fz = (p1.z - p0.z) / l;
      W.refY = (p0.y || 0) + ((p1.y || 0) - (p0.y || 0)) * t;
      ph.reset(x, z, Math.atan2(-fx, -fz));
      if (steps % 8 === 0) W.updateVisibility({ x, z }, 560);
      W.update(dt);
      const cam = { x: x - fx * 7, z: z - fz * 7 };
      tr.update(dt, g.player, cam);
      cr.update(dt, cam, ph, { x: fx, z: fz });
      for (const c of [...tr.cars, ...tr.parked]) {
        const vis = c.on && !c.off && (c.rig.root.visible || !!c.lod?.visible);
        const was = wasVis.get(c) || false;
        if (vis !== was && steps > 2) {
          const dx = c.x - cam.x, dz = c.z - cam.z, d = Math.hypot(dx, dz), inCone = (dx * fx + dz * fz) / (d || 1) > 0.6;
          if (inCone && d < VD - 15) { if (vis) { popIn++; if (pop.length < 6) pop.push({ kind: c.col?.kind ? "parked" : "car", d: Math.round(d), step: steps, wasOn: c._wasOn, cone: +((dx * fx + dz * fz) / d).toFixed(2) }); } else vanish++; }
        }
        wasVis.set(c, vis); c._wasOn = c.on;
      }
      for (const p of cr.people) {
        const dx = p.x - cam.x, dz = p.z - cam.z, d = Math.hypot(dx, dz), vis = p.on && d < 80, was = wasVis.get(p) || false;
        if (vis !== was && steps > 2 && was === false && (dx * fx + dz * fz) / (d || 1) > 0.6 && d < 70) pedPop++;
        wasVis.set(p, vis);
      }
      if (globalThis.__H !== false) {
        for (const c of tr.cars) { if (!c.on || c.off) continue; (c._h ||= []).push({ st: steps, e: c.e?.id, s: +c.s.toFixed(1), v: +c.v.toFixed(1), turn: c.turn ? +c.turnU.toFixed(2) : -1, nx: c.next?.e?.id, lane: +(c.lane || 0).toFixed(1), x: +c.x.toFixed(1), z: +c.z.toFixed(1) }); if (c._h.length > 40) c._h.shift(); }
        for (const q of cr.crossers || []) { (q._h ||= []).push({ st: steps, t: +q.cross.t.toFixed(2), w: +q.cross.wait.toFixed(1), x: +q.x.toFixed(1), z: +q.z.toFixed(1), bl: !!q.cross.blocked, bk: !!q.cross.back }); if (q._h.length > 30) q._h.shift(); }
        if (!globalThis.__ovH) { const on = tr.cars.filter((c) => c.on && !c.off); for (let i = 0; i < on.length && !globalThis.__ovH; i++) for (let j = i + 1; j < on.length; j++) { const a = on[i], b = on[j]; if (Math.hypot(a.x - b.x, a.z - b.z) < 1.6 && Math.abs(a.y - b.y) < 1) { globalThis.__ovH = { a: a.type, b: b.type, ha: a._h.slice(-25), hb: b._h.slice(-25) }; break; } } }
      }
      for (const c of tr.cars) { if (c.dwell > 0 && !c._dw) { dwells++; pullers.add(c.type); } c._dw = c.dwell > 0; }
      if (steps % 15 === 0) {
        const st = tr.debugStats(); if (st.overlaps) globalThis.__ov = tr.lastOverlap; overlapsMax = Math.max(overlapsMax, st.overlaps); parkedHit += st.parkedHit; parkedMax = Math.max(parkedMax, st.parked);
        activeSum += st.active; n++; const pr = cr.debugOnRoad(); pedSum += pr.people; pedOnRoad += pr.onRoad; (globalThis.__acc = (globalThis.__acc || 0) + pr.accident); (globalThis.__shopOff = (globalThis.__shopOff || 0) + pr.shopOff); crossSeen += pr.crossing; groupsSeen = Math.max(groupsSeen, pr.groups);
        for (const q of cr.crossers || []) for (const c of tr.cars) if (c.on && !c.off && Math.hypot(c.x - q.x, c.z - q.z) < 1.4) { carThroughPed++; globalThis.__ctp ||= { hc: (c._h || []).slice(-20), hp: (q._h || []).slice(-20), car: c.type, v: +c.v.toFixed(1), turn: !!c.turn, virt: !!c.virtual, stopsNear: tr._stops.length, ped: { t: +q.cross.t.toFixed(2), wait: +q.cross.wait.toFixed(1), blocked: !!q.cross.blocked, back: !!q.cross.back, blockT: +(q.cross.blockT || 0).toFixed(1), speed: q.speed, scared: q.scared } }; }
        for (const q of tr.parked) if (q.on && Math.abs(W.height(q.x, q.z, 0)) > 0.05) parkedBad++;
      }
      steps++;
      if (steps % 60 === 0) await new Promise((r) => setTimeout(r, 0));
    }
  }
  return { ovH: globalThis.__ovH || null, ctp: globalThis.__ctp || null, lastOverlap: globalThis.__ov || null, accidentSamples: globalThis.__acc || 0, shopOffSamples: globalThis.__shopOff || 0, pedOnRoad, crossSeen, groupsSeen, carThroughPed, aiStopsServed: dwells, aiStopTypes: [...pullers], pedPopIn: pedPop, simSeconds: Math.round(steps * dt), popIn, vanish, pop, overlapsMax, parkedHit, parkedOffAsphalt: parkedBad, parkedMax, avgTraffic: +(activeSum / n).toFixed(1), avgPeds: Math.round(pedSum / n) };
});
const pass = r.pedOnRoad === 0 && r.carThroughPed === 0 && r.crossSeen > 0 && r.groupsSeen > 0 && r.aiStopsServed > 0 && r.pedPopIn === 0 && r.popIn === 0 && r.vanish === 0 && r.overlapsMax === 0 && r.parkedHit === 0 && r.parkedOffAsphalt === 0 && !errors.length;
console.log(JSON.stringify({ ...r, errors }, null, 1));
const brief = ['pedOnRoad', 'carThroughPed', 'crossSeen', 'groupsSeen', 'aiStopsServed', 'pedPopIn', 'popIn', 'vanish', 'overlapsMax', 'parkedHit', 'parkedOffAsphalt'].map((k) => `${k}=${r[k]}`).join(' ') + (errors.length ? ` errors=${errors.length}` : '');
console.log(brief);
console.log(pass ? 'PASS city-life' : 'FAIL city-life');
await browser.close();
process.exit(pass ? 0 : 1);
