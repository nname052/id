// =====================================================================
//  سلامة العجل: الكاوتش والجنط والطاسة لازم يفضلوا حتة واحدة في كل الحالات:
//  طريق مستوي → دركسيون → فرامل → طلوع رصيف → عجلة واحدة على الرصيف → كوبري → خبطة → ريوس من على الرصيف
//  بنقيس المسافة بين مراكز أجزاء كل عجلة (في إحداثيات العالم) + لقطات قريبة.
//    node tools/tests/wheel-integrity.mjs [kind] [baseUrl]
// =====================================================================
import fs from 'fs';
import path from 'path';
const PW = process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);
const KIND = process.argv[2] || 'taxi', BASE = process.argv[3] || 'http://localhost:5173/';
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), 'out'); fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await browser.newPage({ viewport: { width: 560, height: 360 } });
p.setDefaultTimeout(1200000);
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(`${BASE}?map=shibin`);
await p.waitForFunction(() => !document.getElementById('go').disabled);
await p.evaluate((k) => { document.querySelector(`#pick [data-v="${k}"]`).click(); document.getElementById('go').click(); }, KIND);
await p.waitForTimeout(1500);
const res = await p.evaluate(async () => {
  const g = game, W = g.world, THREE = window.__THREE;
  g.renderer.setAnimationLoop(null);
  const ph = g.player.physics, rig = g.player.rig;
  const settle = async (x, z) => { for (let k = 0; k < 300; k++) { W.updateVisibility({ x, z }, 560); W.update(0.05); if (!W.queue.length && k > 6) break; await new Promise((r) => setTimeout(r, 5)); } };
  // أجزاء كل عجلة الظاهرة: أقصى بُعد بين مراكزها (لازم ~0) وبُعد مركزها عن محور العجلة
  // (1) كل جزء عجل ظاهر لازم يبقى تحت نفس الـ spin بتاع عجلته (لو جزء متعلق في الجسم يبان "منفصل" مع المساعدين)
  // (2) الكاوتش والجنط متمركزين على نفس المحور (fit دايرة) طول الاختبار
  const WHEEL_RE = /^(tyre|tire|b_rim|rim_map|wheel|llanta|metal_rin|rim)$/i; // أسامي خامات العجل بالظبط (مش trim/دركسيون)
  const underSpin = (o) => { for (let q = o; q; q = q.parent) if (rig.wheels.some((w) => w.spin === q)) return true; return false; };
  const visibleDeep = (o) => { for (let q = o; q; q = q.parent) if (!q.visible) return false; return true; };
  const detached = () => { let n = 0; rig.root.traverse((o) => { if (o.isMesh && WHEEL_RE.test(o.material?.name || o.name || '') && visibleDeep(o) && !underSpin(o)) { n++; window.__det = (o.material?.name || '') + '|' + o.name + '|' + o.parent?.name; } }); return n; };
  const v = new THREE.Vector3();
  const fit = (pts) => {
    let a11 = 0, a12 = 0, a13 = 0, a22 = 0, a23 = 0, a33 = 0, b1 = 0, b2 = 0, b3 = 0;
    for (const [y, z] of pts) { const q = -(y * y + z * z); a11 += y * y; a12 += y * z; a13 += y; a22 += z * z; a23 += z; a33 += 1; b1 += y * q; b2 += z * q; b3 += q; }
    const M = [[a11, a12, a13, b1], [a12, a22, a23, b2], [a13, a23, a33, b3]];
    for (let i = 0; i < 3; i++) { let pv = i; for (let r = i + 1; r < 3; r++) if (Math.abs(M[r][i]) > Math.abs(M[pv][i])) pv = r; [M[i], M[pv]] = [M[pv], M[i]]; for (let r = 0; r < 3; r++) if (r !== i) { const f = M[r][i] / M[i][i]; for (let c = i; c < 4; c++) M[r][c] -= f * M[i][c]; } }
    return [-(M[0][3] / M[0][0]) / 2, -(M[1][3] / M[1][1]) / 2];
  };
  const check = () => {
    let worst = 0;
    for (const w of rig.wheels) {
      if (!w.spin) continue;
      w.group.updateMatrixWorld(true);
      const inv = w.group.matrixWorld.clone().invert();
      const parts = [];
      w.spin.traverse((o) => {
        if (!o.isMesh || !visibleDeep(o) || !/tyre|tire|llanta|wheel|^-$|rim|rin/i.test(o.material?.name || '-')) return;
        const P = o.geometry.attributes.position, pts = []; let rmax = 0;
        for (let i = 0; i < P.count; i += 2) { v.fromBufferAttribute(P, i).applyMatrix4(o.matrixWorld).applyMatrix4(inv); pts.push([v.y, v.z]); }
        const c0 = fit(pts); for (const [y, z] of pts) rmax = Math.max(rmax, Math.hypot(y - c0[0], z - c0[1]));
        const outer = pts.filter(([y, z]) => Math.hypot(y - c0[0], z - c0[1]) > rmax * 0.9);
        parts.push({ c: fit(outer), r: rmax, nm: o.material?.name });
      });
      // الكاوتش = أكبر دايرة، والجنط = اللي بعده (الأجزاء الدايرية بس)
      parts.sort((a, b) => b.r - a.r);
      if (parts.length >= 2) { const d = Math.hypot(parts[0].c[0] - parts[1].c[0], parts[0].c[1] - parts[1].c[1]); if (d > worst) { worst = d; window.__pair = parts.map((q) => `${q.nm}:${(q.r * 1000).toFixed(0)}:${q.c.map((x) => (x * 1000).toFixed(1))}`); } }
    }
    return { worst, axisOff: detached() };
  };
  const shots = [];
  const shot = () => {
    const w = rig.wheels.find((x) => x.id === 'FL') || rig.wheels[0];
    const c = new THREE.Vector3(); w.group.getWorldPosition(c);
    const [fx, fz] = ph.forward, rx = -fz, rz = fx;
    const cam = new THREE.PerspectiveCamera(40, 560 / 360, 0.02, 200);
    cam.position.set(c.x - rx * 1.6 + fx * 0.6, c.y + 0.35, c.z - rz * 1.6 + fz * 0.6); cam.lookAt(c); cam.updateMatrixWorld();
    g.renderer.render(g.scene, cam); shots.push(g.renderer.domElement.toDataURL('image/jpeg', 0.8));
  };
  const log = [];
  const run = (name, secs, inp, snap) => {
    let worst = 0, axisOff = 0;
    for (let t = 0; t < secs; t += 0.05) { g.debugSim(0.05, inp); g.player.syncVisuals(0.05, 1); const r = check(); worst = Math.max(worst, r.worst); axisOff = Math.max(axisOff, r.axisOff); }
    if (snap) shot();
    log.push({ phase: name, tyreRimOffsetMm: +(worst * 1000).toFixed(1), detachedParts: axisOff, kmh: +(ph.speed * 3.6).toFixed(1), flipped: !!ph.flip.mode });
  };
  // مكان: شارع فيه رصيف جنب البداية
  const sp = W.spawnPose();
  await settle(sp.x, sp.z);
  ph.reset(sp.x, sp.z, sp.yaw); g.player._savePrev();
  run('flat', 2, { throttle: 0.6 }, true);
  run('steering', 1.5, { throttle: 0.4, steer: 0.8 }, false);
  run('braking', 1.5, { brake: 1 }, false);
  // طلوع الرصيف: نلف ناحية اليمين ونطلع ببطء
  ph.reset(sp.x, sp.z, sp.yaw); g.player._savePrev();
  run('toward-curb', 1.2, { throttle: 0.35, steer: -0.9 }, false);
  run('curb-climb', 2.5, { throttle: 0.45, steer: -0.3 }, true);
  run('reverse-off-curb', 2.5, { throttle: 0, brake: 0.6, steer: 0.2 }, false);
  run('reverse-off-curb2', 2.5, { brake: 0.8 }, true);
  // عجلة واحدة على الرصيف: موازي للرصيف قريب منه
  ph.reset(sp.x, sp.z, sp.yaw); g.player._savePrev();
  run('one-wheel-approach', 1.0, { throttle: 0.3, steer: -0.5 }, false);
  run('one-wheel', 2.0, { throttle: 0.3, steer: 0.35 }, true);
  // الكوبري العلوي
  const deck = W.graph.edges.find((e) => e.name === 'كوبرى شبين الكوم العلوي' && e.oneway && e.pts[0].y < 0.3) || W.graph.edges.find((e) => e.elevated);
  const a = deck.pts[0], a1 = deck.pts[2];
  await settle(a.x, a.z);
  W.refY = a.y; ph.reset(a.x, a.z, Math.atan2(-(a1.x - a.x), -(a1.z - a.z))); g.player._savePrev();
  run('bridge-ramp', 5, { throttle: 0.6 }, true);
  // خبطة: نسوق على أقرب عمارة
  const out = []; W.queryColliders(ph.x, ph.z, out);
  const bl = []; for (let r = 10; r < 150 && !bl.length; r += 10) { out.length = 0; for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r]]) W.queryColliders(sp.x + dx, sp.z + dz, out); bl.push(...out.filter((c) => c.kind === 'building')); }
  const B = bl[0];
  await settle(B.cx, B.cz);
  const fx = Math.sin(B.angle), fz = Math.cos(B.angle);
  W.refY = 0; ph.reset(B.cx + fx * (B.hz + 9), B.cz + fz * (B.hz + 9), Math.atan2(fx, fz)); g.player._savePrev();
  run('collision', 3, { throttle: 1 }, true);
  run('after-collision-reverse', 2, { brake: 1 }, false);
  return { log, shots, dbg: { pair: window.__pair, det: window.__det } };
});
res.shots.forEach((d, i) => fs.writeFileSync(path.join(OUT, `wheel_${KIND}_${i}.jpg`), Buffer.from(d.split(',')[1], 'base64')));
const worst = Math.max(...res.log.map((l) => l.tyreRimOffsetMm)), det = Math.max(...res.log.map((l) => l.detachedParts));
console.log(JSON.stringify(res.log, null, 0)); console.log(JSON.stringify(res.dbg));
console.log(`${KIND}: tyre/rim max offset ${worst} mm, detached wheel parts ${det}`, worst < 10 && det === 0 ? 'PASS' : 'FAIL', 'errors', errs.length);
await browser.close();
