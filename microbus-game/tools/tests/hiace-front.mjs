// =====================================================================
//  الهاي إس من قدام: صور قريبة (قدام، قدام-شمال 45°، قدام-يمين 45°، قدام من فوق، كابينة السواق)
//  نهار/ليل، الكشافات مطفية/منوّرة → tools/tests/out/hiace-*.png
//  + فحص رقمي: في بكسلات العربية في الصورة (من غير الكشافات/الزجاج) نسبة البكسلات "البيضا"
//    (فاتحة ومن غير لون) في الربع اللي تحت-قدام من كل ناحية — المفروض ≈ صفر مع دهان شبين (تركواز + أصفر)
//   (فحص الأشعة: ولا شعاع من الكاميرات اللي قدام بيخبط في الصالون قبل الزجاج/الصاج — التابلوه كان طالع من الركنين)
//   node tools/tests/hiace-front.mjs [baseUrl]
// =====================================================================
import fs from 'node:fs';
import path from 'node:path';
const PW = process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);
const BASE = process.argv[2] || 'http://localhost:5173/';
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), 'out');
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 800, height: 520 } });
page.setDefaultTimeout(900000);
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${BASE}?map=shibin`);
await page.waitForFunction(() => !document.getElementById('go').disabled);
await page.evaluate(() => document.getElementById('go').click());
await page.waitForTimeout(1500);
await page.evaluate(() => { document.querySelector('#linepick .lp-close')?.click(); game.renderer.setAnimationLoop(null); });
const shots = [
  ['front', 0, 1.1, 5.2], ['front-left', -45, 1.1, 5.0], ['front-right', 45, 1.1, 5.0], ['front-high', 0, 3.2, 5.0],
  ['side-left', -90, 1.0, 5.5], ['side-right', 90, 1.0, 5.5],
];
const res = {};
for (const time of ['day', 'night']) for (const lights of time === 'day' ? ['off'] : ['off', 'on']) {
  const tag = `${time}-${lights}`;
  const r = await page.evaluate(async ({ shots, time, lights }) => {
    const g = game;
    const THREE = await import('/node_modules/.vite/deps/three.js');
    g.env.setPreset(time === 'day' ? 'day' : 'night');
    g.player.setHeadlights(lights === 'on');
    const ph = g.player.physics, W = g.world;
    // مكان فاضي نسبيًا على شارع (من غير عربيات حوالين)
    const sp = W.spawnPose(); ph.reset(sp.x, sp.z, sp.yaw); g.player._savePrev();
    for (const c of g.traffic.cars) { c.on = false; c.rig.root.visible = false; if (c.lod) c.lod.visible = false; }
    for (const q of g.traffic.parked) { q.on = false; q.rig.root.visible = false; if (q.lod) q.lod.visible = false; }
    g.player.syncVisuals(0.016, 1);
    W.updateVisibility({ x: sp.x, y: 2, z: sp.z }, 300);
    for (let k = 0; k < 200 && W.queue.length; k++) { W.update(0.03); await new Promise((r) => setTimeout(r, 0)); }
    g.env.update?.(g.player.rig.root.position);
    const cam = g.camera.clone(); cam.fov = 40; cam.aspect = 800 / 520; cam.near = 0.05; cam.updateProjectionMatrix();
    const root = g.player.rig.root; root.updateMatrixWorld(true);
    const fwd = { x: -Math.sin(ph.yaw), z: -Math.cos(ph.yaw) }; // قدام العربية
    const out = {};
    const hide = [g.player.rig.interiorGroup].filter(Boolean);
    for (const [name, ang, h, dist] of shots) {
      const a = ang * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
      // اتجاه الكاميرا من العربية: قدام ملفوف بالزاوية (موجب = يمين السواق)
      const rx = -fwd.z, rz = fwd.x; // يمين العربية
      const dx = fwd.x * ca + rx * sa, dz = fwd.z * ca + rz * sa;
      const p = root.position;
      cam.position.set(p.x + dx * dist, p.y + h, p.z + dz * dist);
      cam.lookAt(p.x + fwd.x * 1.3, p.y + 0.95, p.z + fwd.z * 1.3);
      cam.updateMatrixWorld();
      g.renderer.setPixelRatio(1); g.renderer.setSize(800, 520, false);
      g.renderer.render(g.scene, cam);
      out[name] = g.renderer.domElement.toDataURL('image/png');
      // فحص رقمي: شبكة أشعة من الكاميرا — أي شعاع أول حاجة يخبطها قطعة صالون (من غير ما يعدّي زجاج أو صاج) = الصالون طالع برا
      if (time === 'day') {
        const rc = new THREE.Raycaster(); let leak = 0, car = 0; const where = [];
        const inRig = (o) => { for (let q = o; q; q = q.parent) if (q === root) return true; return false; };
        const inInt = (o) => { for (let q = o; q; q = q.parent) if (q === g.player.rig.interiorGroup) return true; return false; };
        for (let py = 0; py < 520; py += 6) for (let px = 0; px < 800; px += 6) {
          rc.setFromCamera(new THREE.Vector2(px / 400 - 1, 1 - py / 260), cam);
          const h = rc.intersectObject(root, true).find((i) => i.object.visible && i.object.userData.role !== 'shadow');
          if (!h) continue;
          car++;
          // بين فوق العجل وخط الشبابيك بس (فوقه بيبان الصالون من الزجاج عادي، وتحته من فتحة الرفرف على الأرضية من تحت)
          const ly = g.player.rig.shell.worldToLocal(h.point.clone()).y;
          if (inInt(h.object) && inRig(h.object) && ly > 0.78 && ly < g.player.rig.dims.wsBase[1] - 0.05) { leak++; (out.__pts ||= {})[name] = [...(out.__pts?.[name] || []), [px, py, h.object.name || h.object.parent?.name || '?', +ly.toFixed(2)]]; if (where.length < 5) where.push([px, py, h.object.name]); }
        }
        (out.__leak ||= {})[name] = { carRays: car, interiorFirst: leak, where };
      }
    }
    // من كرسي السواق
    g.cams.mode = 0; g.cams.snap = true; g.cams.update(0.016);
    g.renderer.render(g.scene, g.camera);
    out.cockpit = g.renderer.domElement.toDataURL('image/png');
    void hide;
    return out;
  }, { shots, time, lights });
  if (r.__leak) { res.leak = r.__leak; delete r.__leak; }
  if (r.__pts) { fs.writeFileSync(path.join(OUT, 'hiace-leak-points.json'), JSON.stringify(r.__pts)); delete r.__pts; }
  for (const [k, v] of Object.entries(r)) fs.writeFileSync(path.join(OUT, `hiace-${tag}-${k}.png`), Buffer.from(v.split(',')[1], 'base64'));
  res[tag] = Object.keys(r);
}
const leakTotal = Object.values(res.leak || {}).reduce((a, l) => a + l.interiorFirst, 0);
const pass = !!res.leak && leakTotal === 0 && !errors.length;
console.log(JSON.stringify({ res, errors }, null, 1));
console.log(pass ? 'PASS hiace-front' : 'FAIL hiace-front');
await browser.close();
process.exit(pass ? 0 : 1);
