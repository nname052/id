// =====================================================================
//  قياس الأداء الحقيقي (التحميل + سواقة دقيقة باللوب الحقيقي بتاع اللعبة):
//   - وقت كل مرحلة تحميل (من نص الحالة)، وقت "جاهز"، وقت أول فريم بعد "يلا بينا"
//   - سواقة 60 ث على طريق حقيقي طويل (المربعات بتتحمل والمرور شغال): FPS، 1% low،
//     الفريمات اللي فوق 50/100 مللي، أطول فريم، long tasks، أطول شغلانة بناء، الذاكرة
//   node tools/tests/perf-bench.mjs [baseUrl] [desktop|mobile] [cold|warm]
//   (موبايل = محاكاة على الكمبيوتر: لمس + شاشة موبايل + المعالج أبطأ 4 مرات — مش تليفون حقيقي)
// =====================================================================
const PW = process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);
const BASE = process.argv[2] || 'http://localhost:4173/';
const PROFILE = process.argv[3] || 'desktop';
const MODE = process.argv[4] || 'cold';
const DRIVE_S = +(process.env.DRIVE_S || 60);
const mobile = PROFILE === 'mobile';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
// (الرسم هنا بالمعالج — SwiftShader — فالشاشة صغيرة عشان القياس يبين تهنيج الكود مش بطء الرسم بالسوفتوير)
const [VW, VH] = (process.env.VIEW || (mobile ? '640x296' : '640x360')).split('x').map(Number);
const ctx = await browser.newContext(mobile
  ? { viewport: { width: VW, height: VH }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36' }
  : { viewport: { width: VW, height: VH } });
const page = await ctx.newPage();
page.setDefaultTimeout(900000);
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
const cdp = await ctx.newCDPSession(page);
if (mobile) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
// NODRAW=1 (الافتراضي): أوامر رسم البكسلات نفسها بتتلغي — كل الباقي حقيقي (three.js، رفع البيانات، تجهيز الشيدرز،
// البناء، الفيزيا، المرور، الـ GC). كده بنقيس تكلفة الكود؛ تكلفة البكسلات على كارت الشاشة لازم تتقاس على جهاز حقيقي
if (process.env.NODRAW !== '0') await page.addInitScript(() => {
  for (const C of [WebGLRenderingContext, WebGL2RenderingContext]) for (const f of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements', 'blitFramebuffer']) if (C.prototype[f]) C.prototype[f] = function () {};
});
await page.addInitScript(() => {
  const T = (window.__stages = []);
  const t0 = performance.timeOrigin;
  new MutationObserver(() => {
    const s = document.getElementById('status'); if (s) T.push([Math.round(performance.now()), s.textContent]);
    const go = document.getElementById('go'); if (go && !go.disabled && !window.__goT) window.__goT = Math.round(performance.now());
  }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['disabled'] });
  window.__long = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true }); } catch { /* */ }
  void t0;
});
if (MODE === 'warm') { // نفس المتصفح: تحميل أول عشان الكاش، وبعدين القياس
  await page.goto(BASE);
  await page.waitForFunction(() => !document.getElementById('go')?.disabled, null, { timeout: 900000 });
}
const tNav = Date.now();
await page.goto(BASE);
await page.waitForFunction(() => !document.getElementById('go')?.disabled, null, { timeout: 900000, polling: 50 });
const load = await page.evaluate(() => ({
  map: game.mapId, readyMs: Math.round(performance.now()), stages: window.__stages.filter((s, i, a) => i === 0 || s[1] !== a[i - 1][1]),
  transferKB: Math.round(performance.getEntriesByType('resource').reduce((s, e) => s + (e.transferSize || 0), 0) / 1024) + Math.round((performance.getEntriesByType('navigation')[0]?.transferSize || 0) / 1024),
  resources: performance.getEntriesByType('resource').length,
  goEnabledMs: window.__goT, topLong: [...window.__long].sort((a, b) => b[1] - a[1]).slice(0, 8),
  longBeforeReady: window.__long.length, longSumBeforeReady: window.__long.reduce((s, l) => s + l[1], 0),
}));
load.wallReadyMs = Date.now() - tNav;
// "يلا بينا" → أول فريم مرسوم بالكاميرا بتاعة السواقة
const first = await page.evaluate(async () => {
  const t = performance.now();
  document.querySelector('#linepick .lp-close')?.click();
  document.getElementById('go').click();
  const f0 = game.renderer.info.render.frame;
  while (game.renderer.info.render.frame < f0 + 2 || !game.started) await new Promise((r) => requestAnimationFrame(r));
  document.querySelector('#linepick .lp-close')?.click();
  return { goToFirstFrameMs: Math.round(performance.now() - t) };
});
await page.waitForTimeout(1500);
await page.evaluate(() => document.querySelector('#linepick .lp-close')?.click());
// سواقة بالسرعة على طريق حقيقي (اللوب الحقيقي شغال: رسم + مربعات + مرور + مشاة)
const drive = await page.evaluate(async (DRIVE_S) => {
  const g = game, W = g.world, ph = g.player.physics;
  const fr = g.findRoute;
  const L = Object.fromEntries(W.landmarkPoints.map((l) => [l.id, l]));
  const sp = W.spawnPose();
  const legs = [[sp, L.menoufia_university], [L.menoufia_university, L.station_shibin_new], [L.station_shibin_new, sp]];
  const pts = []; let cum = [0];
  for (const [a, b] of legs) {
    const rt = fr(a.rx ?? a.x, a.rz ?? a.z, b.rx ?? b.x, b.rz ?? b.z);
    for (const p of rt.pts) { if (pts.length) cum.push(cum[cum.length - 1] + Math.hypot(p.x - pts[pts.length - 1].x, p.z - pts[pts.length - 1].z)); pts.push(p); }
  }
  const total = cum[cum.length - 1];
  const at = (s) => { s %= total; let i = 0; while (i < pts.length - 2 && cum[i + 1] < s) i++; const p0 = pts[i], p1 = pts[i + 1], t = (s - cum[i]) / ((cum[i + 1] - cum[i]) || 1); const l = Math.hypot(p1.x - p0.x, p1.z - p0.z) || 1; return { x: p0.x + (p1.x - p0.x) * t, z: p0.z + (p1.z - p0.z) * t, fx: (p1.x - p0.x) / l, fz: (p1.z - p0.z) / l }; };
  const v = 14; // م/ث ≈ 50 كم/س

  const frames = [], cpu = [];
  const orig = g._frame.bind(g);
  let s = 0, last = performance.now(), tStart = last;
  g._frame = () => {
    const now = performance.now(); const dt = (now - last) / 1000; last = now;
    s += v * Math.min(dt, 0.1);
    const q = at(s);
    ph.reset(q.x, q.z, Math.atan2(-q.fx, -q.fz)); ph.vx = q.fx * v; ph.vz = q.fz * v;
    const c0 = performance.now(); orig(); cpu.push(performance.now() - c0);
    frames.push(dt * 1000);
  };
  window.gc?.();
  const heap0 = performance.memory?.usedJSHeapSize;
  const long0 = window.__long.length;
  W.stats.buildMsMax = 0;
  await new Promise((r) => setTimeout(r, DRIVE_S * 1000));
  g._frame = orig;
  const heap1 = performance.memory?.usedJSHeapSize;
  const ft = frames.slice(5).sort((a, b) => a - b), n = ft.length;
  const avg = ft.reduce((a, b) => a + b, 0) / n;
  const p = (q) => ft[Math.min(n - 1, Math.floor(n * q))];
  const low1 = ft.slice(Math.floor(n * 0.99)); const low1fps = 1000 / (low1.reduce((a, b) => a + b, 0) / low1.length);
  const cs = cpu.slice(5).sort((a, b) => a - b);
  const longs = window.__long.slice(long0);
  return {
    seconds: Math.round((performance.now() - tStart) / 1000), meters: Math.round(s), frames: n,
    avgFps: +(1000 / avg).toFixed(1), low1Fps: +low1fps.toFixed(1), frameP50: +p(0.5).toFixed(1), frameP95: +p(0.95).toFixed(1), frameMax: Math.round(ft[n - 1]),
    over50ms: ft.filter((x) => x > 50).length, over100ms: ft.filter((x) => x > 100).length, over250ms: ft.filter((x) => x > 250).length,
    cpuP50: +cs[Math.floor(cs.length * 0.5)].toFixed(1), cpuP95: +cs[Math.floor(cs.length * 0.95)].toFixed(1), cpuMax: Math.round(cs[cs.length - 1]),
    longTasks: longs.length, longMax: Math.max(0, ...longs.map((l) => l[1])), longSum: longs.reduce((a, l) => a + l[1], 0),
    buildJobMaxMs: Math.round(W.stats.buildMsMax), tiles: W.stats.tilesLoaded,
    heapStartMB: heap0 && Math.round(heap0 / 1048576), heapEndMB: heap1 && Math.round(heap1 / 1048576),
    drawCalls: g.renderer.info.render.calls, triangles: g.renderer.info.render.triangles, quality: g._q?.level, pixelRatio: g.renderer.getPixelRatio(), fpsCap: g.fpsCap || 0,
  };
}, DRIVE_S);
const out = { drawCalls: process.env.NODRAW === '0' ? 'real (SwiftShader)' : 'skipped (CPU/JS cost only)', profile: PROFILE + (mobile ? ` (emulated: touch, ${VW}x${VH}, CPU x4 slower, SwiftShader software GPU)` : ` (${VW}x${VH}, SwiftShader software GPU)`), mode: MODE, load, first, drive, errors };
console.log(JSON.stringify(out, null, 1));
await browser.close();
