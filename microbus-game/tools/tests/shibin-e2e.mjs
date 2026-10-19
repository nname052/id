// =====================================================================
//  اختبارات خريطة شبين الحقيقية (Playwright + Chromium):
//    node tools/tests/shibin-e2e.mjs [baseUrl]      (السيرفر شغال: npx vite --port 5173)
//  بيطبع نتيجة كل اختبار + أرقام الأداء، وبيكتب tools/tests/out/shibin-e2e.json
//  PLAYWRIGHT=/path/to/playwright/index.mjs لو مش في المكان الافتراضي
// =====================================================================
import fs from 'fs';
import path from 'path';

const PW = process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);
const BASE = process.argv[2] || 'http://localhost:5173/';
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), 'out');
fs.mkdirSync(OUT, { recursive: true });
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc'];
const results = [];
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const run = (k) => !ONLY.length || ONLY.includes(k);
const T = (n, name, pass, detail) => { results.push({ n, name, pass: !!pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${n}. ${name} — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`); };

const browser = await chromium.launch({ args: ARGS });
const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
const page = await ctx.newPage();
page.setDefaultTimeout(1200000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

async function boot(map) {
  const t0 = Date.now();
  await page.goto(`${BASE}?map=${map}`);
  await page.waitForFunction(() => !document.getElementById('go').disabled || /مشكلة/.test(document.getElementById('status').textContent));
  return (Date.now() - t0) / 1000;
}

// ===== 1) تحميل شبين =====
const loadS = await boot('shibin');
const st1 = await page.evaluate(() => ({ map: game.mapId, tiles: game.world?.stats.tilesLoaded, status: document.getElementById('status').textContent, load: game.loadInfo }));
T(1, 'تحميل شبين من غير crash', st1.map === 'shibin' && st1.tiles > 0 && !errors.length, { seconds: loadS, ...st1, errors: errors.length });
await page.click('#go');
await page.waitForTimeout(1500);

// ===== 2,3,4,16) سواقة طويلة عبر المربعات + تقاطعات + حدود المربعات + الذاكرة =====
let drive = null;
if (run('drive')) {
drive = await page.evaluate(async () => {
  const g = game, W = g.world;
  g.renderer.setAnimationLoop(null);
  const { findRoute } = await import('/src/nav/RoadGraph.js');
  const sp = W.spawnPose();
  const L = Object.fromEntries(W.landmarkPoints.map((l) => [l.id, l]));
  const legs = [[sp, L.menoufia_university], [L.menoufia_university, L.station_shibin_new], [L.station_shibin_new, sp]];
  const mem = () => ({ geo: g.renderer.info.memory.geometries, tex: g.renderer.info.memory.textures, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, tiles: W.tiles.size });
  const m0 = mem();
  let maxUpd = 0, maxQueue = 0, dist = 0, steps = 0, loads = new Set(), junctions = new Set(), maxRender = 0, frames = 0;
  const jn = W.graph.nodes.filter((n) => n.edges.length >= 3);
  const ph = g.player.physics, dt = 1 / 30, v = 16;
  let mid = null;
  for (const [a, b] of legs) {
    const r = findRoute(a.x ?? a.rx, a.z ?? a.rz, b.rx ?? b.x, b.rz ?? b.z);
    if (!r) return { error: 'no route' };
    let visT = 0;
    for (let s = 0; s < r.length; s += v * dt) {
      let i = 0; while (i < r.pts.length - 2 && r.cum[i + 1] < s) i++;
      const p0 = r.pts[i], p1 = r.pts[i + 1], t = (s - r.cum[i]) / ((r.cum[i + 1] - r.cum[i]) || 1);
      const x = p0.x + (p1.x - p0.x) * t, z = p0.z + (p1.z - p0.z) * t, yaw = Math.atan2(-(p1.x - p0.x), -(p1.z - p0.z));
      W.refY = (p0.y || 0) + ((p1.y || 0) - (p0.y || 0)) * t;
      ph.reset(x, z, yaw);
      visT -= dt;
      if (visT <= 0) { visT = 0.25; W.updateVisibility({ x, z }, 560); for (const T of W.tiles.values()) loads.add(T.name); }
      const t0 = performance.now(); W.update(dt); const u = performance.now() - t0;
      maxUpd = Math.max(maxUpd, u); maxQueue = Math.max(maxQueue, W.queue.length);
      g.traffic.update(dt, g.player, { x, z });
      for (const n of jn) if (Math.abs(n.x - x) < 4 && Math.abs(n.z - z) < 4) junctions.add(n.id);
      if (steps % 45 === 0) { g.player.syncVisuals(dt, 1); g.cams.update(dt); const r0 = performance.now(); g.renderer.render(g.scene, g.camera); maxRender = Math.max(maxRender, performance.now() - r0); frames++; }
      steps++; dist += v * dt;
      await (steps % 30 === 0 ? new Promise((r) => setTimeout(r, 0)) : null);
    }
    if (!mid) mid = mem();
  }
  // نرجع للبداية ونسيب الـ streaming يستقر
  ph.reset(sp.x, sp.z, sp.yaw);
  for (let k = 0; k < 200; k++) { W.updateVisibility({ x: sp.x, z: sp.z }, 560); W.update(dt); if (!W.queue.length && k > 10) break; await new Promise((r) => setTimeout(r, 10)); }
  const m1 = mem();
  return { km: +(dist / 1000).toFixed(2), steps, tilesVisited: loads.size, junctions: junctions.size, maxWorldUpdateMs: +maxUpd.toFixed(1), buildMsMax: +W.stats.buildMsMax.toFixed(1), buildMaxJob: W.stats.buildMaxJob, bldParts: W.stats.bldParts, maxQueue, maxRenderMs: +maxRender.toFixed(0), m0, mid, m1 };
});
T(2, 'سواقة طويلة عبر مربعات كتير', drive.km > 2 && drive.tilesVisited > 15, { km: drive.km, tilesVisited: drive.tilesVisited });
T(3, 'المرور على تقاطعات كتير', drive.junctions >= 20, { junctions: drive.junctions });
T(4, 'حدود المربعات من غير تهنيج', drive.buildMsMax < 40 && drive.maxWorldUpdateMs < 50, { buildJobMaxMs: drive.buildMsMax, slowestJob: drive.buildMaxJob, bldParts: drive.bldParts, worldUpdateMaxMs: drive.maxWorldUpdateMs, note: 'CPU software rendering (swiftshader) — real devices are faster' });
const leak = drive.m1 && drive.m0 ? drive.m1.geo - drive.m0.geo : null;
T('16-info', 'الذاكرة بعد سواقة طويلة (معلومة بس: المربعات اللي في نطاق الـ hysteresis بتفضل متحملة)', true, { start: drive.m0, farthest: drive.mid, back: drive.m1 });

}
// ===== 5) التصادم (مبنى) =====
let col = null;
if (run('col')) {
col = await page.evaluate(async () => {
  const g = game, W = g.world, ph = g.player.physics;
  const sp = W.spawnPose();
  // أقرب عمارة لنقطة على شارع: نوقف العربية قصادها ونسوق عليها
  const out = []; W.queryColliders(sp.x, sp.z, out);
  for (let r = 12; r < 120 && !out.some((c) => c.kind === 'building'); r += 12) { out.length = 0; for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r]]) W.queryColliders(sp.x + dx, sp.z + dz, out); }
  const b = out.filter((c) => c.kind === 'building').sort((a, c) => Math.hypot(a.cx - sp.x, a.cz - sp.z) - Math.hypot(c.cx - sp.x, c.cz - sp.z))[0];
  if (!b) return { error: 'no building' };
  // الواجهة: z المحلي للعمارة ناحية الشارع
  const fx = Math.sin(b.angle), fz = Math.cos(b.angle);
  const sx = b.cx + fx * (b.hz + 7), sz = b.cz + fz * (b.hz + 7);
  W.refY = 0;
  ph.reset(sx, sz, Math.atan2(fx, fz));
  g.player._savePrev();
  let hits = 0; const oi = ph.onImpact; ph.onImpact = (...a) => { hits++; oi?.(...a); };
  g.debugSim(3.5, { throttle: 1 });
  ph.onImpact = oi;
  // جوه العمارة؟
  const rx = ph.x - b.cx, rz = ph.z - b.cz, ca = Math.cos(b.angle), sa = Math.sin(b.angle);
  const lx = rx * ca - rz * sa, lz = rx * sa + rz * ca;
  return { hits, inside: Math.abs(lx) < b.hx - 0.3 && Math.abs(lz) < b.hz - 0.3, speed: +ph.speed.toFixed(2), distToFace: +(Math.hypot(ph.x - sx, ph.z - sz)).toFixed(1) };
});
T(5, 'التصادم مع العمارات', col.hits > 0 && !col.inside, col);

}
// ===== 6–9) تبديل العربيات + كل عربية بتسوق + شغلها =====
let veh = null;
if (run('veh')) {
veh = await page.evaluate(async () => {
  const g = game, W = g.world, out = {};
  const sp = W.spawnPose();
  for (const kind of ['taxi', 'tuktuk', 'microbus']) {
    g.setVehicle(kind);
    const ph = g.player.physics;
    W.refY = 0;
    ph.reset(sp.x, sp.z, sp.yaw); g.player._savePrev();
    const x0 = ph.x, z0 = ph.z;
    const r = g.debugSim(3, { throttle: 1 });
    const ground = W.height(ph.x, ph.z, 0);
    const P = g.passengers;
    for (let k = 0; k < 40; k++) P.update(0.1, ph);
    out[kind] = { kind: g.player.kind, moved: +Math.hypot(ph.x - x0, ph.z - z0).toFixed(1), kmh: r.kmh, flipped: !!ph.flip.mode, rideH: +(ph.heave - ph.spec.cgHeight - ground).toFixed(2),
      job: P.mode, stops: P.stops.length, lineStops: P.lineStops.length, line: P.line?.name || null, nav: P.navTarget(ph)?.name || null };
  }
  return out;
});
T(6, 'تبديل العربيات على شبين', veh.taxi.kind === 'taxi' && veh.tuktuk.kind === 'tuktuk' && veh.microbus.kind === 'microbus', Object.fromEntries(Object.entries(veh).map(([k, v]) => [k, v.kind])));
for (const [n, k] of [[7, 'taxi'], [8, 'microbus'], [9, 'tuktuk']]) {
  const v = veh[k];
  const jobOk = k === 'microbus' ? v.lineStops >= 2 : v.stops >= 1;
  T(n, `${k === 'taxi' ? 'التاكسي' : k === 'microbus' ? 'الميكروباص' : 'التوكتوك'}: سواقة + شغل`, v.moved > 5 && !v.flipped && Math.abs(v.rideH) < 0.4 && jobOk, v);
}

}
// ===== 10) الـ GPS =====
let gps = null;
if (run('gps')) {
gps = await page.evaluate(async () => {
  const g = game, W = g.world;
  const { findRoute, projectToGraph } = await import('/src/nav/RoadGraph.js');
  const nodes = W.graph.nodes.filter((n) => !n.outside && n.edges.length);
  let ok = 0, fail = 0, wrongWay = 0, ratioMax = 0, n = 0;
  let seed = 5; const R = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < 60; k++) {
    const a = nodes[Math.floor(R() * nodes.length)], b = nodes[Math.floor(R() * nodes.length)];
    if (Math.hypot(a.x - b.x, a.z - b.z) < 300) continue;
    n++;
    const r = findRoute(a.x, a.z, b.x, b.z);
    if (!r) { fail++; continue; }
    ok++;
    ratioMax = Math.max(ratioMax, r.length / Math.hypot(a.x - b.x, a.z - b.z));
    // الاتجاه الواحد: كل قطعة على وصلة one-way لازم تبقى في اتجاهها
    for (let i = 0; i < r.pts.length - 1; i += 3) {
      const p = r.pts[i], q = r.pts[i + 1], mx = (p.x + q.x) / 2, mz = (p.z + q.z) / 2;
      const pr = projectToGraph(mx, mz, 10);
      if (!pr || !pr.e.oneway || pr.d > 0.5) continue;
      const dx = q.x - p.x, dz = q.z - p.z, l = Math.hypot(dx, dz);
      if (l > 0.5 && (dx * pr.dx + dz * pr.dz) / l < -0.5) wrongWay++;
    }
  }
  // GPS بتاع اللعبة نفسه لمعلم حقيقي
  const ph = g.player.physics, U = W.landmarkPoints.find((l) => l.id === 'menoufia_university');
  g.nav.setTarget({ x: U.rx, z: U.rz, name: U.name });
  g.nav._t = 0; g.nav.update(0.3, ph);
  const info = g.nav.info;
  const names = [...new Set((g.nav.route?.steps || []).map((s) => s.name).filter(Boolean))].slice(0, 6);
  return { pairs: n, ok, fail, wrongWay, detourMax: +ratioMax.toFixed(2), toUniversity: info ? Math.round(info.remain) : null, turnNames: names };
});
T(10, 'الـ GPS على شبكة الطرق الحقيقية', gps.fail <= 1 && gps.wrongWay === 0 && gps.toUniversity > 0, gps);

}
// ===== 11) المرور =====
let traf = null;
if (run('traffic')) {
traf = await page.evaluate(async () => {
  const g = game, W = g.world, tr = g.traffic, ph = g.player.physics;
  const sp = W.spawnPose(); ph.reset(sp.x + 500, sp.z + 500, 0); // اللاعب بعيد شوية عشان المرور يتحرك براحته
  const { edgePoint } = await import('/src/world/shibin/ShibinData.js');
  let overlapsMax = 0, onClosed = 0, offRoad = 0, movingSum = 0, samples = 0, activeMin = 1e9;
  const q = {};
  for (let k = 0; k < 2400; k++) {
    tr.update(1 / 30, g.player, { x: ph.x, z: ph.z });
    if (k % 30 === 0) {
      const s = tr.debugStats(); overlapsMax = Math.max(overlapsMax, s.overlaps); movingSum += s.moving; samples++; activeMin = Math.min(activeMin, s.active);
      for (const c of tr.cars) {
        if (!c.on || c.off) continue;
        if (c.e.closed) onClosed++;
        if (!c.turn) { edgePoint(c.e, c.dir > 0 ? c.s : c.e.length - c.s, q); if (Math.hypot(c.x - c.kox - q.x, c.z - c.koz - q.z) > c.e.half + 0.6) offRoad++; }
      }
    }
    if (k % 120 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  return { simSeconds: 80, overlapsMax, onClosedEdges: onClosed, offRoadSamples: offRoad, avgMoving: +(movingSum / samples).toFixed(1), activeMin };
});
T(11, 'المرور ماشي على الشبكة (من غير تداخل/قفل/خروج)', traf.overlapsMax === 0 && traf.onClosedEdges === 0 && traf.offRoadSamples === 0 && traf.avgMoving > 3, traf);

}
// ===== 17,18,19 من ملف الفحص المستقل (tools/osm/validate_region.py) =====
const val = JSON.parse(fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '../../public/data/shibin/metadata/validation.json'), 'utf8'));
T(17, 'مفيش عمارات على الطرق/المية/السكة', !val.buildings.on_road && !val.buildings.on_water && !val.buildings.on_rail, val.buildings);
T(18, 'مفيش طرق اتقطعت بسبب التحويل', val.conversion.max_point_error_m < 0.2 && !val.conversion.osm_ways_missing, { ...val.conversion, network: { components: val.network.components, routing: `${val.network.routing_ok}/${val.network.routing_samples}` } });
T(19, 'مفيش معالم متألفة', !val.landmarks.invalid && !val.names.mismatched, { confirmed: val.landmarks.confirmed, names_mismatched: val.names.mismatched, needs_verification: val.landmarks.needs_verification.length });

// ===== 16b) التسريب في الحالة المستقرة: نروح بعيد ونرجع 3 مرات — العدد لازم يثبت =====
if (run('leak')) {
  const lk = await page.evaluate(async () => {
    const g = game, W = g.world, sp = W.spawnPose(), far = { x: sp.x + 1600, z: sp.z - 1400 };
    const settle = async (p) => { for (let k = 0; k < 400; k++) { W.updateVisibility(p, 560); W.update(0.03); if (!W.queue.length && k > 12) break; await new Promise((r) => setTimeout(r, 5)); } g.renderer.render(g.scene, g.camera); };
    const snap = () => (window.gc?.(), { geo: g.renderer.info.memory.geometries, tex: g.renderer.info.memory.textures, tiles: W.tiles.size, colCells: W.colGrid.size, deckCells: W.deckGrid.size, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null });
    const out = [];
    for (let c = 0; c < 3; c++) { await settle(far); await settle(sp); out.push(snap()); }
    return out;
  });
  const [a, , c] = lk;
  T(16, 'مفيش تسريب ذاكرة (3 لفات بعيد ورجوع: الأرقام ثابتة)', c.geo - a.geo <= 4 && (c.heapMB == null || c.heapMB - a.heapMB <= 8) && c.tiles === a.tiles && c.colCells === a.colCells && c.deckCells === a.deckCells, lk);
}

// ===== أرقام الأداء (على الكمبيوتر الحالي — software rendering) =====
let perf = null;
if (run('perf')) {
perf = await page.evaluate(async () => {
  const g = game, W = g.world;
  const sp = W.spawnPose(); g.player.physics.reset(sp.x, sp.z, sp.yaw); g.player._savePrev();
  g.cams.mode = 0; g.renderer.setAnimationLoop(() => g._frame());
  await new Promise((r) => setTimeout(r, 2500));
  const t = []; let last = performance.now();
  await new Promise((res) => { let n = 0; const f = () => { const now = performance.now(); t.push(now - last); last = now; if (++n < 90) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
  t.sort((a, b) => a - b);
  const info = g.renderer.info;
  let texBytes = 0; const seen = new Set();
  g.scene.traverse((o) => { const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []; for (const m of ms) for (const k of ['map', 'normalMap', 'roughnessMap', 'emissiveMap', 'alphaMap']) { const tx = m[k]; if (tx && !seen.has(tx) && tx.image?.width) { seen.add(tx); texBytes += tx.image.width * tx.image.height * 4 * 1.33; } } for (const k of ['uFacP', 'uFacB', 'uShop']) { const tx = ms[0]?.userData?.U?.[k]?.value; if (tx && !seen.has(tx)) { seen.add(tx); texBytes += tx.image.width * tx.image.height * 4 * 1.33; } } });
  return {
    fps: +(1000 / (t.reduce((a, b) => a + b, 0) / t.length)).toFixed(1), frameMsMedian: +t[t.length >> 1].toFixed(1), frameMsP95: +t[Math.floor(t.length * 0.95)].toFixed(1),
    drawCalls: info.render.calls, triangles: info.render.triangles, tilesLoaded: W.stats.tilesLoaded, buildingsActive: W.stats.buildings,
    traffic: g.traffic.debugStats().active, pedestrians: g.crowd.debugOnRoad().people, geometries: info.memory.geometries, textures: info.memory.textures,
    textureMB: +(texBytes / 1048576).toFixed(1), heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, loadMs: g.loadInfo,
  };
});
const ped = await page.evaluate(() => game.crowd.debugOnRoad());
T('12a', 'المشاة على الأرصفة بس', ped.onRoad === 0 && ped.people > 10, ped);
await page.screenshot({ path: path.join(OUT, 'shibin-desktop.jpg'), quality: 80 });

}
// ===== 12) شاشة الموبايل =====
if (run('mobile')) {
{
  // الصفحة الأولى (كمبيوتر) بتوقف رسمها: الصفحتين بيتقسموا على نفس كارت الشاشة السوفتوير (ثانية+ للفريم)،
  // وده مش سيناريو حقيقي (لعبتين بيترسموا في نفس الوقت) وبيوقّف تحميل صفحة الموبايل
  await page.evaluate(() => game.renderer.setAnimationLoop(null)).catch(() => {});
  const m = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const mp = await m.newPage(); mp.setDefaultTimeout(1200000);
  const merr = []; mp.on('pageerror', (e) => merr.push(e.message));
  await mp.goto(`${BASE}?map=shibin`);
  await mp.waitForFunction(() => !document.getElementById('go').disabled);
  await mp.evaluate(() => document.getElementById('go').click());
  await mp.waitForTimeout(4000);
  const ui = await mp.evaluate(() => ({ touch: !!document.querySelector('.touch') || document.body.classList.contains('touch'), minimap: !document.getElementById('minimap')?.classList.contains('hidden'), attr: !!document.getElementById('osm-ingame'), w: innerWidth, overflowX: document.documentElement.scrollWidth > innerWidth }));
  await mp.screenshot({ path: path.join(OUT, 'shibin-mobile.jpg'), quality: 80 });
  T(12, 'شاشة الموبايل', ui.touch && ui.minimap && ui.attr && !ui.overflowX && !merr.length, { ...ui, errors: merr.length });
  await m.close();
}

}
// ===== 13) Reload =====
if (run('switch')) {
await page.reload();
await page.waitForFunction(() => !document.getElementById('go').disabled);
const r13 = await page.evaluate(() => ({ map: game.mapId, tiles: game.world?.stats.tilesLoaded }));
T(13, 'Reload', r13.map === 'shibin' && r13.tiles > 0, r13);

// ===== 14) الرجوع للخريطة القديمة (من القايمة) =====
await page.goto(BASE);
await page.waitForFunction(() => !!document.querySelector('#maps [data-m="current"]'));
await Promise.all([page.waitForNavigation(), page.evaluate(() => document.querySelector('#maps [data-m="current"]').click())]).catch(() => {});
await page.waitForFunction(() => !document.getElementById('go').disabled, null, { timeout: 1200000 });
const r14 = await page.evaluate(() => ({ map: game.mapId, world: !!game.world, oldRoute: !!game.route?.queryColliders && !game.world, race: !!game.race }));
T(14, 'الرجوع للخريطة القديمة', r14.map === 'current' && !r14.world && r14.race, r14);

// ===== 15) والرجوع لشبين تاني =====
await Promise.all([page.waitForNavigation(), page.evaluate(() => document.querySelector('#maps [data-m="shibin"]').click())]).catch(() => {});
await page.waitForFunction(() => !document.getElementById('go').disabled, null, { timeout: 1200000 });
const r15 = await page.evaluate(() => ({ map: game.mapId, tiles: game.world?.stats.tilesLoaded }));
T(15, 'الرجوع لشبين تاني', r15.map === 'shibin' && r15.tiles > 0, r15);

}
T('err', 'مفيش أخطاء JavaScript طول الاختبار', !errors.length, errors.slice(0, 5));
console.log('\nPERF', JSON.stringify(perf));
console.log('DRIVE', JSON.stringify(drive));
fs.writeFileSync(path.join(OUT, 'shibin-e2e.json'), JSON.stringify({ when: new Date().toISOString(), results, perf, drive, gps, traf, veh, col }, null, 1));
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
