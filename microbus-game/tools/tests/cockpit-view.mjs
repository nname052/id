// =====================================================================
//  منظر كرسي السواق (الميكروباص) على مقاسات شاشات حقيقية: موبايل بالعرض (844×390 و 780×360) وكمبيوتر (1280×720)
//  → tools/tests/out/cockpit-*.png
//  القياس: نسبة الشاشة اللي عليها الصالون (تابلوه/عواميد/سقف) مقابل اللي برا، فين الأفق، وهل الطريق
//  قدام العربية باين (أول نقطة أسفلت باينة على بعد كام متر من العين)، والعدادات باينة
//  + ثبات الأفق: ميل الكاميرا وهي ماشية على مطب/لفة أقل من ميل جسم العربية
//   node tools/tests/cockpit-view.mjs [baseUrl]
// =====================================================================
import fs from 'node:fs';
import path from 'node:path';
const PW = process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);
const BASE = process.argv[2] || 'http://localhost:5173/';
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), 'out');
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const results = {};
const errors = [];
for (const [name, w, h, touch] of [['mobile-844x390', 844, 390, true], ['mobile-780x360', 780, 360, true], ['desktop-1280x720', 1280, 720, false]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch });
  const page = await ctx.newPage();
  page.setDefaultTimeout(900000);
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  await page.goto(`${BASE}?map=shibin`);
  await page.waitForFunction(() => !document.getElementById('go').disabled);
  await page.evaluate(() => document.getElementById('go').click());
  await page.waitForTimeout(1500);
  const r = await page.evaluate(async () => {
    document.querySelector('#linepick .lp-close')?.click();
    const g = game; g.renderer.setAnimationLoop(null);
    const THREE = await import('/node_modules/.vite/deps/three.js');
    const ph = g.player.physics, W = g.world, sp = W.spawnPose();
    ph.reset(sp.x, sp.z, sp.yaw); g.player._savePrev();
    g.renderer.setPixelRatio(1);
    for (let k = 0; k < 20; k++) { g.debugSim(1 / 30, {}); W.update(1 / 30); }
    W.updateVisibility({ x: sp.x, y: 2, z: sp.z }, 300);
    for (let k = 0; k < 200 && W.queue.length; k++) { W.update(0.03); await new Promise((q) => setTimeout(q, 0)); }
    g.player.syncVisuals(0.016, 1); g.cams.mode = 0; g.cams.snap = true; g.cams.update(0.016);
    g.renderer.render(g.scene, g.camera);
    if (g.mirrorInsets.update(g.camera, true)) g.mirrorInsets.render(g.renderer);
    const img = g.renderer.domElement.toDataURL('image/png');
    // نسبة الصالون من الشاشة (شبكة أشعة)
    const cam = g.camera, root = g.player.rig.root, rc = new THREE.Raycaster();
    const inRig = (o) => { for (let q = o; q; q = q.parent) if (q === root) return true; return false; };
    let n = 0, cab = 0, glassRoad = 0, nearRoad = Infinity;
    const eye = cam.position.clone();
    for (let y = -0.97; y <= 0.97; y += 0.07) for (let x = -0.97; x <= 0.97; x += 0.07) {
      rc.setFromCamera(new THREE.Vector2(x, y), cam);
      const hits = rc.intersectObjects(g.scene.children, true).filter((i) => i.object.visible && !/windshield|glass/.test(i.object.userData.role || '') && i.object.material?.opacity !== 0);
      n++;
      const h = hits[0];
      if (h && inRig(h.object)) { cab++; continue; }
      // اللي بيوصل للأرض: أقرب نقطة أرض باينة قدام العربية
      const t = (W.height(h?.point.x ?? 0, h?.point.z ?? 0, 0) || 0);
      if (h && Math.abs(h.point.y - t) < 0.3) { glassRoad++; const dd = Math.hypot(h.point.x - eye.x, h.point.z - eye.z); if (dd < nearRoad) nearRoad = dd; }
    }
    // الأفق (نقطة بعيدة قدام على ارتفاع العين) على الشاشة
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion); fwd.y = 0; fwd.normalize();
    const hz = eye.clone().addScaledVector(fwd, 500).project(cam).y;
    // العدادات باينة؟ (مركز الرسمة بتاعة العدادات جوه الشاشة ومش ورا الدركسيون)
    let gauges = null;
    g.player.rig.root.traverse((o) => { if (!gauges && o.isMesh && o.material?.map && /gauge|cluster|ins/i.test(o.name || o.material.name || '')) gauges = o; });
    // ثبات الأفق: ميل جسم العربية مقابل ميل الكاميرا وهي بتلف بسرعة (ميلان المساعدين)
    ph.reset(sp.x, sp.z, sp.yaw); g.player._savePrev();
    let maxBodyRoll = 0, maxCamRoll = 0;
    const e = new THREE.Euler();
    for (let k = 0; k < 150; k++) {
      g.debugSim(1 / 30, { throttle: k < 70 ? 1 : 0.4, steer: k > 60 ? 0.8 : 0 });
      g.player.syncVisuals(1 / 30, 1); g.cams.update(1 / 30);
      maxBodyRoll = Math.max(maxBodyRoll, Math.abs(ph.roll - (g.player.groundRoll || 0)));
      // ميل الكاميرا حوالين اتجاه النظر (بالنسبة للأرض)
      e.setFromQuaternion(g.camera.quaternion, 'YXZ');
      maxCamRoll = Math.max(maxCamRoll, Math.abs(e.z - (g.player.groundRoll || 0)));
    }
    return { img, aspect: +cam.aspect.toFixed(2), vfov: +cam.fov.toFixed(1), hfov: g.settings.get('fovH'), cabinPct: Math.round((cab / n) * 100), roadPct: Math.round((glassRoad / n) * 100),
      nearestRoadVisibleM: +nearRoad.toFixed(1), horizonY: +hz.toFixed(2), eyeY: +(eye.y - (W.height(eye.x, eye.z, 0) || 0)).toFixed(2), gaugesFound: !!gauges,
      maxBodyRollDeg: +(maxBodyRoll * 57.3).toFixed(2), maxCamRollDeg: +(maxCamRoll * 57.3).toFixed(2) };
  });
  fs.writeFileSync(path.join(OUT, `cockpit-${name}.png`), Buffer.from(r.img.split(',')[1], 'base64'));
  delete r.img;
  results[name] = r;
  await ctx.close();
}
await browser.close();
// مقاييس الراحة — قبل التعديل: الصالون كان 55% (موبايل 2.16:1) / 62% (كمبيوتر 16:9)، الأفق 0.36/0.29، الكاميرا بتميل مع الجسم كله.
// دلوقتي لازم: الصالون ≤ 52% على الموبايل و ≤ 56% على 16:9 (العمود والباب الشمال باينين طبيعي في الهاي إس)، الطريق باين قريب (أقل من 9م قدام العين)،
// الأفق في النص الفوقاني (مش لازق في الحرف)، والكاميرا بتميل أقل من نص ميل الجسم
const ok = (r) => r.cabinPct <= (r.aspect >= 2 ? 52 : 56) && r.nearestRoadVisibleM < 9 && r.horizonY > -0.1 && r.horizonY < 0.55 && r.maxCamRollDeg <= Math.max(0.3, r.maxBodyRollDeg * 0.5);
const pass = Object.values(results).every(ok) && !errors.length;
console.log(JSON.stringify({ results, errors }, null, 1));
console.log(pass ? 'PASS cockpit-view' : 'FAIL cockpit-view');
process.exit(pass ? 0 : 1);
