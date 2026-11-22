// العربية مابتدخلش أي مبنى: بنخبط مباني كتير (مولّدة + حقيقية من OSM) بسرعات مختلفة من ناحية الشارع،
// وبنشوف مركز العربية أو أي ركن منها خلص جوه الفوتبرنت ولا لأ.
//   node tools/tests/building-solid.mjs [url]    (MAP=shibin|cairo|... ، KIND=microbus|car|truck|bus)
const { chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs');
const BASE = process.argv[2] || 'http://localhost:5173/';
const MAP = process.env.MAP || 'shibin', KIND = process.env.KIND || 'microbus', N = +(process.env.N || 30);
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 640, height: 360 } }); p.setDefaultTimeout(1800000);
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto(`${BASE}?map=${MAP}`); await p.waitForFunction(() => !document.getElementById('go').disabled);
await p.evaluate(() => document.getElementById('go').click()); await p.waitForTimeout(2500);
const r = await p.evaluate(async ([KIND, N]) => {
  const g = game, W = g.world; document.querySelector('#linepick .lp-close')?.click();
  g.renderer.setAnimationLoop(null); g.renderer.render = () => {};
  if (g.player.kind !== KIND) await g.setVehicle(KIND);
  g.traffic.colliders = () => {}; g.traffic.setDensity?.(0); // (المباني بس — من غير مرور)
  const ph = g.player.physics;
  // كل المباني المتحملة: مولّدة (مستطيل) + حقيقية (مضلع)
  const polys = (W._bldFoot || []).filter((q) => q.P.length >= 3);
  const pip = (P, x, z) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, zi] = P[i], [xj, zj] = P[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
  const out = { gen: polys.filter((q) => q.kind === 'gen').length, real: polys.filter((q) => q.kind === 'real').length, tries: 0, inside: 0, cornersInside: 0, examples: [], speeds: {} };
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const cand = polys.filter((q) => { const cx = q.P.reduce((s, v) => s + v[0], 0) / q.P.length, cz = q.P.reduce((s, v) => s + v[1], 0) / q.P.length; const rd = W.nearestRoad(cx, cz, 40); return rd && rd.d < 30 && !rd.e.elevated; });
  for (let k = 0; k < N && cand.length; k++) {
    const q = cand[Math.floor(rnd() * cand.length)];
    const cx = q.P.reduce((s, v) => s + v[0], 0) / q.P.length, cz = q.P.reduce((s, v) => s + v[1], 0) / q.P.length;
    const rd = W.nearestRoad(cx, cz, 40);
    let dx = cx - rd.x, dz = cz - rd.z; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
    const kmh = [30, 50, 70, 90][k % 4];
    // من الشارع ناحية المبنى، والعربية مركزها قبل المبنى بمسافة كفاية
    const back = Math.min(4, rd.e.half * 0.8), sx = rd.x - dx * back, sz = rd.z - dz * back; // (جوه الأسفلت: الشارع الضيق نص عرضه أقل من 4م)
    // (نقطة البداية على الأسفلت: لو جوه مبنى = مبنى على الطريق — دي مشكلة تانية بتتعدّ لوحدها)
    if (polys.some((o) => Math.abs(o.P[0][0] - sx) < 120 && Math.abs(o.P[0][1] - sz) < 120 && pip(o.P, sx, sz))) { out.startOnBuilding = (out.startOnBuilding || 0) + 1; (out.startAt ||= []).push([Math.round(sx), Math.round(sz)]); continue; }
    W.refY = 0; ph.reset(sx, sz, Math.atan2(-dx, -dz)); g.player._savePrev();
    ph.vx = dx * kmh / 3.6; ph.vz = dz * kmh / 3.6;
    for (let i = 0; i < 90; i++) { g.debugSim(1 / 30, { throttle: 1 }); }
    out.tries++;
    // جوه؟ المركز وأركان صندوق العربية
    // (أركان صندوق التصادم نفسه — getBox: النقل الصندوق بتاعه مزحزح لقدام boxOffset)
    const B = ph.getBox(), [fx, fz] = ph.forward, hl = B.hz, hw = B.hx;
    const corners = [[hl, hw], [hl, -hw], [-hl, hw], [-hl, -hw]].map(([a, c]) => [B.cx + fx * a + fz * c, B.cz + fz * a - fx * c]);
    // عمق الدخول: أبعد ركن جوه أي مبنى، بُعده عن أقرب حيطة (متر)
    const segD = (P, x, z) => { let m = 1e9; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [ax, az] = P[j], [bx, bz] = P[i], ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez || 1e-9, t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2)); m = Math.min(m, Math.hypot(x - ax - ex * t, z - az - ez * t)); } return m; };
    const near = polys.filter((o) => Math.abs(o.P[0][0] - ph.x) < 60 && Math.abs(o.P[0][1] - ph.z) < 60);
    let depth = 0; for (const [x, z] of [[ph.x, ph.z], ...corners]) for (const o of near) if (pip(o.P, x, z)) depth = Math.max(depth, segD(o.P, x, z));
    out.maxDepth = Math.max(out.maxDepth || 0, +depth.toFixed(2)); if (depth > 0.25) out.deep = (out.deep || 0) + 1;
    const inC = pip(q.P, ph.x, ph.z), inK = corners.filter(([x, z]) => pip(q.P, x, z)).length;
    // أي مبنى تاني (مش بس المقصود)
    const anyIn = polys.some((o) => pip(o.P, ph.x, ph.z));
    if (inC || anyIn) { out.inside++; if (out.examples.length < 8) out.examples.push({ kind: q.kind, kmh, at: [Math.round(ph.x), Math.round(ph.z)], inTarget: inC }); }
    if (inK >= 2) out.cornersInside++;
    (out.speeds[kmh] ||= [0, 0]); out.speeds[kmh][0]++; if (inC || anyIn) out.speeds[kmh][1]++;
  }
  return out;
}, [KIND, N]);
await b.close();
console.log(JSON.stringify({ MAP, KIND, ...r, errs }));
// (لمسة ركن بالسنتيمترات = الصدام لازق في الحيطة، مش دخول: الحد 25 سم)
const ok = r.tries >= Math.min(N, 10) && r.inside === 0 && !(r.deep > 0) && !r.startOnBuilding && !errs.length;
console.log(ok ? 'PASS building-solid' : 'FAIL building-solid'); process.exit(ok ? 0 : 1);
