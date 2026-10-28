// =====================================================================
//  حادثة ماشي + الإسعاف:
//   - خبطة خفيفة (≈15 كم/س): بيقع ويفضل واقع (مش بيقوم لوحده) والإسعاف بتيجي له؛ من غير بقعة
//   - خبطة جامدة (≈45 كم/س): بيقع ويفضل نايم، بقعة صغيرة، الإسعاف بتيجي على الطريق، المسعفين بينزلوا،
//     بيشيلوه على نقالة، والعربية بتمشي على مستشفى من البيانات؛ المرور بيقف قبل المصاب؛ الشرطة اتبلغت
//   - الناس اللي حواليه (2 على الأقل) بيجروا عليه ويقفوا جنبه لحد ما الإسعاف تيجي
//   node tools/tests/accident-ems.mjs [baseUrl]
// =====================================================================
const PW = process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);
const BASE = process.argv[2] || 'http://localhost:5173/';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.setDefaultTimeout(900000);
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${BASE}?map=shibin`);
await page.waitForFunction(() => !document.getElementById('go').disabled);
await page.evaluate(() => document.getElementById('go').click()); await page.waitForTimeout(2000);
await page.evaluate(() => document.querySelector('#linepick .lp-close')?.click());
const r = await page.evaluate(async () => {
  const g = game, W = g.world, Cr = g.crowd, E = g.emergency; g.renderer.setAnimationLoop(null);
  const out = {};
  const tick = (n, f) => { for (let i = 0; i < n; i++) { const cam = g.camera.position; Cr.update(1 / 30, cam, g.player.physics, g.camera.getWorldDirection(new window.__THREE.Vector3())); E.update(1 / 30, cam); f?.(i); } };
  // نجيب ماشي على الرصيف قريب من الكاميرا ونحط العربية وراه جاية عليه
  const hitWith = async (kmh) => {
    tick(30);
    const p = Cr.people.find((q) => q.on && !q.hit && !q.cross && !q.ret && !q.help);
    const ph = g.player.physics;
    const yaw = p.heading + Math.PI; // جاية من قدامه
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    ph.reset(p.x - fx * (ph.spec.halfLength + 0.6), p.z - fz * (ph.spec.halfLength + 0.6), yaw); g.player._savePrev();
    g.camera.position.set(p.x + 8, 4, p.z + 8);
    ph.vx = fx * kmh / 3.6; ph.vz = fz * kmh / 3.6; ph.forwardSpeed = kmh / 3.6; ph.forward[0] = fx; ph.forward[1] = fz;
    let hit = null; const prevOn = Cr.onHit;
    Cr.onHit = (q, severe, v) => { hit = { severe, v: +v.toFixed(1), q }; prevOn?.(q, severe, v); };
    // الماشي واقف مكانه (عشان الاختبار يبقى مضمون — في اللعب بيحاول يبعد)
    p.standing = true; p.scared = 0; p.speed = 0;
    for (let i = 0; i < 20 && !hit; i++) { ph.x += fx * kmh / 3.6 / 30; ph.z += fz * kmh / 3.6 / 30; tick(1); }
    Cr.onHit = prevOn;
    // العربية وقفت بعد الخبطة (في الاختبار مفيش فيزيا شغالة تفرملها)
    ph.vx = 0; ph.vz = 0; ph.forwardSpeed = 0;
    return { p: hit?.q || p, hit };
  };
  // 1) خفيفة
  const A = await hitWith(15);
  out.minor = { hit: !!A.hit, severe: A.hit?.severe };
  let maxFall = 0, maxY = 0; tick(30 * 12, () => { if (A.p.hit) { maxFall = Math.max(maxFall, A.p.hit.fall); maxY = Math.max(maxY, A.p.hit.y); } });
  out.minor.fell = maxFall > 0.95; out.minor.stillDown = !!A.p.hit && A.p.hit.fall > 0.95; out.minor.noStain = !A.p.hit?.stain; out.minor.dispatched = E.dispatched;
  E.jobs.length = 0; Cr.removeVictim(A.p);
  // 2) جامدة
  g.incidents.state = 'idle'; g.incidents._cool = 0;
  const B = await hitWith(45);
  out.severe = { hit: !!B.hit, severe: B.hit?.severe, police: g.incidents.state };
  tick(30 * 3);
  out.severe.helpers = Cr.people.filter((q) => q.on && q.help?.v === B.p).length;
  tick(30 * 4);
  out.severe.helpersArrived = Cr.people.filter((q) => q.on && q.help?.v === B.p && Math.hypot(q.x - B.p.x, q.z - B.p.z) < 2).length;
  out.severe.lying = !!B.p.hit && B.p.hit.fall > 0.95; out.severe.stain = !!B.p.hit?.stain;
  out.severe.trafficStops = g.traffic.extraStops().some((z) => Math.hypot(z.x - B.p.x, z.z - B.p.z) < 1);
  // الإسعاف: لحد ما تمشي على المستشفى (لحد 3 دقايق)
  const states = new Set(); let medicsSeen = 0, stretcher = false, minD = 1e9, fwdOk = 0, fwdBad = 0;
  const g0 = g.player.physics; g0.reset(B.p.x + 25, B.p.z + 25, 0); // اللاعب بعيد شوية
  for (let i = 0; i < 30 * 180; i++) {
    tick(1);
    const st = E.debugStats().state; states.add(st);
    if (Cr.extras.length >= 2) medicsSeen++;
    if (E._rig?.stretcher.visible) stretcher = true;
    if (E._rig?.root.visible && st === 'drive') minD = Math.min(minD, Math.hypot(E._rig.root.position.x - B.p.x, E._rig.root.position.z - B.p.z));
    if (E._rig?.root.visible && (st === 'drive' || st === 'leave')) { const J = E.jobs[0], rr = E._rig; const ry = rr.root.rotation.y; const fx = -Math.sin(ry), fz = -Math.cos(ry); const px = rr._px, pz = rr._pz; if (px !== undefined) { const mx = rr.root.position.x - px, mz = rr.root.position.z - pz; if (Math.hypot(mx, mz) > 0.01) { if (mx * fx + mz * fz > 0) fwdOk++; else fwdBad++; } } rr._px = rr.root.position.x; rr._pz = rr.root.position.z; void J; }
    if (st === 'leave') break;
  }
  out.ems = { states: [...states], medicsSeen: medicsSeen > 30, stretcher, arrivedWithin: +minD.toFixed(1), hospital: E.debugStats().hospital || E.jobs[0]?.hospital, victimRemoved: !B.p.hit && !Cr.victims.includes(B.p), facingForward: fwdOk > 20 && fwdBad <= fwdOk * 0.02, fwd: [fwdOk, fwdBad] };
  return out;
});
await browser.close();
const pass = r.minor.hit && r.minor.severe === false && r.minor.fell && r.minor.stillDown && r.minor.noStain && r.minor.dispatched >= 1 &&
  r.severe.hit && r.severe.severe && r.severe.helpersArrived >= 2 && r.severe.lying && r.severe.stain && r.severe.trafficStops && r.severe.police !== 'idle' &&
  r.ems.states.includes('drive') && r.ems.states.includes('medics') && r.ems.states.includes('leave') && r.ems.medicsSeen && r.ems.stretcher && r.ems.arrivedWithin < 9 && r.ems.victimRemoved && r.ems.facingForward && !errors.length;
console.log(JSON.stringify({ ...r, errors }, null, 1));
console.log(pass ? 'PASS accident-ems' : 'FAIL accident-ems');
process.exit(pass ? 0 : 1);
