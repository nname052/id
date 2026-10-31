// =====================================================================
//  عربيات المرور والمركونة لازقة في الأرض: أوطى نقطة في كل عربية باينة على بعد ≤ 25سم من الأرض تحتها
//  (كان العجل في موديلين بيلف حوالين مركز غلط → العربية تبان طايرة أو نصها في الأرض).
//   node tools/tests/vehicle-grounding.mjs [baseUrl] [map ...]
// =====================================================================
const { chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs');
const BASE = process.argv[2] || 'http://localhost:5173/';
const MAPS = process.argv.slice(3).length ? process.argv.slice(3) : ['shibin', 'alexandria', 'cairo'];
let allBad = 0;
for (const map of MAPS) {
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 400, height: 300 } }); p.setDefaultTimeout(900000);
await p.goto(`${BASE}?map=${map}`); await p.waitForFunction(() => !document.getElementById('go').disabled);
await p.evaluate(() => document.getElementById('go').click()); await p.waitForTimeout(2000);
const r = await p.evaluate(async () => {
  const g = game; for (let i = 0; i < 6; i++) g.debugSim(1, { throttle: 0.4 });
  g.traffic.lodNear = 25; g.traffic.update(0.05, g.player, g.camera.position); // (نجبر البعيدة تبقى LOD عشان تتفحص هي كمان)
  const T = g.traffic, out = [], _v = new (g.camera.position.constructor)();
  const box = (o) => { let mn = Infinity, mx = -Infinity; o.traverse((m) => { if (!m.isMesh || !m.visible) return; m.geometry.computeBoundingBox(); const bb = m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld); mn = Math.min(mn, bb.min.y); mx = Math.max(mx, bb.max.y); }); return { min: mn, max: mx }; };
  const list = [...(T.cars || []).map((c) => ({ c, kind: 'traffic' })), ...(T.parked || []).map((c) => ({ c, kind: 'parked' }))];
  for (const { c, kind } of list) {
    // النسخة الخفيفة (LOD) اللي بتترسم للعربيات البعيدة لو هي اللي باينة
    const root = c.lod?.visible ? c.lod : c.rig?.root; if (!root || !root.visible || !root.parent) continue;
    root.updateMatrixWorld(true); const bx = box(root);
    if (!isFinite(bx.min)) continue;
    // الفجوة = أوطى نقطة في العربية فوق الأرض اللي تحتها هي بالظبط (مش تحت نص العربية): على منحدر كوبري طرف العربية
    // الواطي فوق أرض أوطى — القياس من النص كان بيطلّع -0.3/-0.5م لعربية لازقة في السطح (KNOWN_ISSUES 20)
    let gap = Infinity;
    root.traverse((m) => { if (!m.isMesh || !m.visible) return; const P = m.geometry.attributes.position; for (let i = 0; i < P.count; i += 5) { _v.fromBufferAttribute(P, i).applyMatrix4(m.matrixWorld); gap = Math.min(gap, _v.y - g.world.height(_v.x, _v.z, root.position.y)); } });
    out.push({ kind: kind + (root === c.lod ? '-lod' : ''), type: c.type, real: c.rig?.real, gap: +gap.toFixed(2), h: +(bx.max - bx.min).toFixed(2), y: +root.position.y.toFixed(2) });
  }
  const bad = out.filter((o) => Math.abs(o.gap) > 0.25);
  return { n: out.length, lod: out.filter((o) => o.kind.endsWith('-lod')).length, bad: bad.slice(0, 20) };
});
console.log(map, JSON.stringify(r));
allBad += r.bad.length + (r.n < 10 ? 1 : 0);
await b.close();
}
console.log(allBad ? 'FAIL vehicle-grounding' : 'PASS vehicle-grounding');
process.exit(allBad ? 1 : 0);
