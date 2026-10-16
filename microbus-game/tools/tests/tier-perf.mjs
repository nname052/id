// =====================================================================
//  مقارنة الأداء LOW / MED / HIGH (كمبيوتر + موبايل محاكى) على شبين — نفس المكان، نفس الكاميرا
//   node tools/tests/tier-perf.mjs [baseUrl]   → tools/tests/out/tier-perf.json
//  (software rendering: الـ FPS هنا مش رقم جهاز حقيقي — المقارنة بين المستويات هي المهمة)
// =====================================================================
import fs from 'fs';
import path from 'path';
const PW = process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);
const BASE = process.argv[2] || 'http://localhost:5173/';
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), 'out');
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
const CONFIGS = [
  { name: 'desktop-high', tier: 'high', mobile: false }, { name: 'desktop-med', tier: 'med', mobile: false }, { name: 'desktop-low', tier: 'low', mobile: false },
  { name: 'mobile-high', tier: 'high', mobile: true }, { name: 'mobile-med', tier: 'med', mobile: true }, { name: 'mobile-low', tier: 'low', mobile: true },
];
const res = [];
for (const C of CONFIGS) {
  const ctx = await browser.newContext(C.mobile ? { viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 720 } });
  const p = await ctx.newPage(); p.setDefaultTimeout(1200000);
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript((tier) => { try { localStorage.setItem('egy-microbus-settings-v1', JSON.stringify({ graphics: tier, fovV: 3, livV: 1 })); } catch { /* */ } }, C.tier);
  await p.goto(`${BASE}?map=shibin`);
  await p.waitForFunction(() => !document.getElementById('go').disabled);
  await p.evaluate(() => document.getElementById('go').click());
  await p.waitForTimeout(1500);
  await p.evaluate(() => document.querySelector('#linepick .lp-close')?.click());
  const r = await p.evaluate(async () => {
    const g = game, W = g.world, sp = W.spawnPose(), ph = g.player.physics;
    ph.reset(sp.x, sp.z, sp.yaw); g.player._savePrev(); g.cams.mode = 0;
    g.renderer.setAnimationLoop(null);
    // محاكاة 10 ثواني (المرور/المشاة/الـ streaming) — وقت الـ CPU للأنظمة دي لكل فريم
    const dt = 1 / 30, cpu = [];
    for (let i = 0; i < 300; i++) {
      const a = performance.now();
      if (i % 8 === 0) W.updateVisibility(g.camera.position, g.viewDist || 560);
      W.update(dt);
      g.traffic.update(dt, g.player, g.camera.position);
      g.crowd.update(dt, g.camera.position, ph, g.camera.getWorldDirection(new window.__THREE.Vector3()));
      g.player.syncVisuals(dt, 1); g.cams.update(dt);
      cpu.push(performance.now() - a);
      if (i % 30 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    cpu.sort((a, b) => a - b);
    // رسمة واحدة للمشهد الأساسي → عدد الـ draw calls والمثلثات
    g.renderer.render(g.scene, g.camera);
    const info = g.renderer.info, cv = g.renderer.domElement;
    window.gc?.();
    let lights = 0; g.scene.traverse((o) => { if ((o.isPointLight || o.isSpotLight) && o.visible) lights++; });
    return {
      tier: g.tier, canvas: `${cv.width}x${cv.height}`, pixelRatio: +g.renderer.getPixelRatio().toFixed(2), fpsCap: g.fpsCap, antialias: g.renderer.getContext().getContextAttributes().antialias,
      drawCalls: info.render.calls, triangles: info.render.triangles, pointSpotLights: lights, shadowType: g.renderer.shadowMap.type, shadowEvery: g.shadowEvery,
      geometries: info.memory.geometries, textures: info.memory.textures, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
      traffic: g.traffic.debugStats().active, parked: g.traffic.debugStats().parked, pedestrians: g.crowd.debugOnRoad().people, lamps: W.lamps?.visibleCount,
      tilesLoaded: W.stats.tilesLoaded, simCpuMsMedian: +cpu[cpu.length >> 1].toFixed(2), simCpuMsP95: +cpu[Math.floor(cpu.length * 0.95)].toFixed(2),
    };
  });
  res.push({ config: C.name, ...r, errors: errs.length });
  console.log(C.name, JSON.stringify(r), errs.slice(0, 2));
  await ctx.close();
}
fs.writeFileSync(path.join(OUT, 'tier-perf.json'), JSON.stringify(res, null, 1));
await browser.close();
