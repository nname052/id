// =====================================================================
//  ميزانية الأداء/السخونة (منطق، مش FPS جهاز حقيقي):
//   - سقف الفريمات: كام فريم بيترسم فعلًا من شاشة 120 هرتز (30/60/تلقائي-كمبيوتر)
//   - الصفحة مستخبية → الرسم والصوت واقفين، ولما ترجع يكملوا
//   - موفّر البطارية: 30 فريم، دقة أقل، مرايات أرخص، أنوار حقيقية صفر
//   - draw calls لعربية مرور (كاملة vs LOD) ولرسمة مراية جانبية (قبل/بعد إخفاء الصالون)
//   node tools/tests/perf-budget.mjs [baseUrl]
// =====================================================================
const PW = process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);
const BASE = process.argv[2] || 'http://localhost:5173/';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
page.setDefaultTimeout(900000);
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${BASE}?map=shibin`);
await page.waitForFunction(() => !document.getElementById('go').disabled);
await page.evaluate(() => document.getElementById('go').click()); await page.waitForTimeout(1500);
await page.evaluate(() => document.querySelector('#linepick .lp-close')?.click());
const r = await page.evaluate(async () => {
  const g = game, out = {};
  g.renderer.setAnimationLoop(null);
  // 1) سقف الفريمات على شاشة 120 هرتز (ثانيتين)
  const realFrame = g._frame; let frames = 0; g._frame = () => { frames++; };
  const run = (cap) => { g.settings.set('fpsCap', cap); g._tickT = undefined; g._tickAcc = 0; frames = 0; for (let i = 0; i < 240; i++) g._tick(i * (1000 / 120)); return frames / 2; };
  out.fpsCap = { '30': run('30'), // (45 اتشال من الإعدادات في v10 — بيعمل تقطيع)
    '60': run('60'), autoDesktop: run('auto'), max: run('max') };
  g.settings.set('fpsCap', 'auto');
  g._frame = realFrame;
  // 2) الخلفية
  const desc = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden');
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  document.dispatchEvent(new Event('visibilitychange'));
  const hiddenState = { paused: g.paused, audio: g.audio?.ctx?.state };
  await new Promise((r) => setTimeout(r, 300));
  hiddenState.audioAfter = g.audio?.ctx?.state;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  document.dispatchEvent(new Event('visibilitychange'));
  out.background = { ...hiddenState, resumed: !g.paused };
  if (desc) delete document.hidden;
  g.renderer.setAnimationLoop(null);
  // 3) موفّر البطارية
  g.settings.set('graphics', 'saver');
  out.saver = { fpsCap: g.fpsCap, pixelRatio: +g.renderer.getPixelRatio().toFixed(2), mirrorSkip: (g.player.mirrorSkip || 0) + (g.player.mirrorQualitySkip || 0), mirrorFar: g.player.mirrorFar, mirrorRT: g.player.mirrorCams[0] ? [g.player.mirrorCams[0].rt.width, g.player.mirrorCams[0].rt.height] : null, shadowEvery: g.shadowEvery, shadowExtent: g.env.sun.shadow.camera.right };
  g.lampTimer = 0; g._frame(); out.saver.realLampLightsOn = g.lampLights.filter((l) => l.intensity > 0).length;
  g.settings.set('graphics', 'auto');
  // 4) draw calls: عربية مرور كاملة vs LOD، لكل نوع
  const R = g.renderer, THREE = window.__THREE;
  const callsOf = (objs) => { const sc = new THREE.Scene(); const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 1000); cam.position.set(0, 4, 12); cam.lookAt(0, 0, 0); const keep = objs.map((o) => [o, o.parent, o.position.clone(), o.visible]); for (const [o] of keep) { sc.add(o); o.position.set(0, 0, 0); o.visible = true; o.traverse((q) => { if (q.isMesh) q.frustumCulled = false; }); } R.setRenderTarget(null); R.render(sc, cam); const n = R.info.render.calls; for (const [o, p, pos, v] of keep) { p ? p.add(o) : sc.remove(o); o.position.copy(pos); o.visible = v; } return n; };
  out.trafficCalls = {};
  for (const c of g.traffic.cars) {
    if (out.trafficCalls[c.type]) continue;
    const wh = (c.rig.wheels || []).map((w) => [w.group, w.group.visible]); for (const [w] of wh) w.visible = true;
    out.trafficCalls[c.type] = { full: callsOf([c.rig.root]), lod: g.traffic.ensureLod(c) ? callsOf([c.lod]) : null };
    for (const [w, v] of wh) w.visible = v;
  }
  // 5) رسمة مراية جانبية للميكروباص (من جوه)
  g.setVehicle('microbus'); g.cams.mode = 0; g.cams.update(0.016);
  const P = g.player, mc = P.mirrorCams.find((m) => m.m.side !== 0);
  const measure = (hideInterior) => { const ig = P.rig.interiorGroup, was = ig?.visible; if (!hideInterior && ig) ig.visible = true; const save = P.rig.interiorGroup; if (!hideInterior) P.rig.interiorGroup = null; P._skipN = 0; P.mirrorSkip = 0; P.mirrorQualitySkip = 0; P._order = [P.mirrorCams.indexOf(mc)]; P._mirrorFrame = 0; P._renderOneMirror(R, g.scene, g.camera.position, 0); const n = R.info.render.calls; P.rig.interiorGroup = save; if (ig) ig.visible = was; P._order = null; return n; };
  out.sideMirrorCalls = { withInterior: measure(false), optimized: measure(true) };
  return out;
});
const pass = r.fpsCap['30'] <= 31 && r.fpsCap['30'] >= 29 && Math.abs(r.fpsCap['60'] - 60) <= 1 && Math.abs(r.fpsCap.autoDesktop - 60) <= 1
  && r.background.paused && r.background.resumed && r.saver.fpsCap === 30 && r.saver.realLampLightsOn === 0
  && Object.values(r.trafficCalls).every((t) => t.lod >= 1 && t.lod <= 3 && t.lod < t.full) && r.sideMirrorCalls.optimized < r.sideMirrorCalls.withInterior && !errors.length;
console.log(JSON.stringify({ ...r, errors }, null, 1));
console.log(pass ? 'PASS perf-budget' : 'FAIL perf-budget');
await browser.close();
process.exit(pass ? 0 : 1);
