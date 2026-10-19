// =====================================================================
//  جولة صور: شاشة البداية (الخريطة الافتراضية)، شارع عادي في شبين (من ورا العربية ومن الكابينة)،
//  الكوبري العلوي (من فوق ومن الكابينة وهو طالع)، والسواقة بالليل (كشافات شغالة)
//  → tools/tests/out/tour-*.png  (للفحص بالعين — مفيش PASS رقمي غير "مفيش أخطاء")
//   node tools/tests/visual-tour.mjs [baseUrl]
// =====================================================================
import fs from 'node:fs';
import path from 'node:path';
const PW = process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);
const BASE = process.argv[2] || 'http://localhost:5173/';
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), 'out');
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 960, height: 444 } });
page.setDefaultTimeout(900000);
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.goto(BASE); // من غير ?map: الافتراضي
await page.waitForFunction(() => !document.getElementById('go').disabled);
fs.writeFileSync(path.join(OUT, 'tour-start-screen.png'), await page.screenshot());
await page.evaluate(() => document.getElementById('go').click());
await page.waitForTimeout(1500);
const shots = await page.evaluate(async () => {
  document.querySelector('#linepick .lp-close')?.click();
  const g = game, W = g.world, ph = g.player.physics; g.renderer.setAnimationLoop(null); g.renderer.setPixelRatio(1);
  const out = {};
  const settle = async (x, z) => { W.updateVisibility({ x, y: 2, z }, 400); for (let k = 0; k < 300 && W.queue.length; k++) { W.update(0.03); await new Promise((r) => setTimeout(r, 0)); } };
  const place = async (x, z, yaw, simS = 1.5) => {
    ph.reset(x, z, yaw); g.player._savePrev(); await settle(x, z);
    for (let k = 0; k < simS * 30; k++) { g.debugSim(1 / 30, { throttle: 0.25 }); g.traffic.update(1 / 30, g.player, g.camera.position); g.crowd.update(1 / 30, g.camera.position, ph, { x: -Math.sin(ph.yaw), z: -Math.cos(ph.yaw) }); }
    g.player.syncVisuals(1 / 30, 1); await settle(ph.x, ph.z);
  };
  const shot = (name, mode) => {
    g.cams.mode = mode; g.cams.snap = true; g.cams.update(1 / 30);
    g.env.update?.(g.player.rig.root.position);
    g.renderer.render(g.scene, g.camera);
    if (mode === 0 && g.mirrorInsets.update(g.camera, true)) g.mirrorInsets.render(g.renderer);
    out[name] = g.renderer.domElement.toDataURL('image/jpeg', 0.85);
  };
  // شارع عادي: البداية
  const sp = W.spawnPose();
  await place(sp.x, sp.z, sp.yaw, 2);
  shot('street-chase', 1); shot('street-cockpit', 0);
  // الكوبري العلوي: أول المطلع (من الشبكة: أول وصلة مرفوعة)
  const deck = W.graph.edges.find((e) => e.elevated && !e.closed && e.length > 60);
  if (deck) {
    const a = deck.pts[0], b = deck.pts[Math.min(deck.pts.length - 1, 3)];
    const yaw = Math.atan2(-(b.x - a.x), -(b.z - a.z));
    await place(a.x, a.z, yaw, 2.5);
    shot('bridge-chase', 1); shot('bridge-cockpit', 0);
  }
  // الليل: الكشافات شغالة
  g.env.setPreset('night'); g._onTimeChange?.(g.env.preset); g.player.setHeadlights(true);
  await place(sp.x, sp.z, sp.yaw, 1);
  shot('night-cockpit', 0); shot('night-chase', 1);
  return out;
});
for (const [k, v] of Object.entries(shots)) fs.writeFileSync(path.join(OUT, `tour-${k}.jpg`), Buffer.from(v.split(',')[1], 'base64'));
await browser.close();
console.log(JSON.stringify({ shots: Object.keys(shots), errors }));
console.log(errors.length ? 'FAIL visual-tour' : 'PASS visual-tour');
process.exit(errors.length ? 1 : 0);
