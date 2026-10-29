// =====================================================================
//  المية: البحر (إسكندرية) بيتحرك ومش صورة ثابتة، وشريط الشط (لون ضحل + رغوة) موجود وبيترسم وبيتغير مع الوقت،
//  وماحدش بيغطيه (الفتحة/الأرض)، ومفيش شريط شط على الترع (شبين).   node tools/tests/water.mjs [baseUrl]
// =====================================================================
const PW = process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);
const BASE = process.argv[2] || 'http://localhost:5173/';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errs = [];
const run = async (map) => {
  const p = await browser.newPage({ viewport: { width: 600, height: 400 } }); p.setDefaultTimeout(900000);
  p.on('pageerror', (e) => errs.push(`${map}: ${e.message}`));
  await p.goto(`${BASE}?map=${map}`); await p.waitForFunction(() => !document.getElementById('go').disabled);
  await p.evaluate(() => document.getElementById('go').click()); await p.waitForTimeout(1500);
  const r = await p.evaluate(async () => {
    const g = game, W = g.world; g.renderer.setAnimationLoop(null);
    let S = null, n = 0;
    for (const T of W.tiles.values()) T.group.traverse((o) => { if (o.name === 'water-shore') { n++; if (!S || o.geometry.attributes.position.count > S.geometry.attributes.position.count) S = o; } });
    const out = { style: W.waterStyle, shoreMeshes: n };
    if (!S) return out;
    const a = S.geometry.attributes.position, k = Math.floor(a.count / 4) * 2, X = (a.getX(k) + a.getX(k + 1)) / 2, Z = (a.getZ(k) + a.getZ(k + 1)) / 2;
    const c = g.camera; g.cams.mode = 99; c.position.set(X, 30, Z + 0.1); c.lookAt(X, -0.5, Z); c.updateProjectionMatrix();
    const shot = () => { g.renderer.render(g.scene, c); const gl = g.renderer.getContext(); const w = 160, px = new Uint8Array(4 * w * w); gl.readPixels(g.renderer.domElement.width / 2 - w / 2, g.renderer.domElement.height / 2 - w / 2, w, w, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
    const diff = (A, B) => { let d = 0; for (let i = 0; i < A.length; i += 4) d += Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]); return +(d / (A.length / 4)).toFixed(2); };
    const t0 = shot(); S.visible = false; const noShore = shot(); S.visible = true;
    W._waterU.uWT.value += 2.5; const t1 = shot();
    // رغوة: بكسلات بقت أفتح بكتير (والأحمر كمان — يعني أبيض مش لون المية) من غير الشريط
    const white = (A) => { let m = 0; for (let i = 0; i < A.length; i += 4) if (A[i] - noShore[i] > 45 && A[i] > 120) m++; return m; };
    Object.assign(out, { shoreChangesImage: diff(t0, noShore), movesOverTime: diff(t0, t1), foamPx: white(t0) });
    return out;
  });
  await p.close();
  return r;
};
const alex = await run('alex');
const shibin = await run('shibin');
await browser.close();
const checks = {
  seaShore: alex.style === 'sea' && alex.shoreMeshes > 0,
  shoreVisible: alex.shoreChangesImage > 3,
  animated: alex.movesOverTime > 2,
  foam: alex.foamPx > 20,
  noShoreOnCanal: shibin.shoreMeshes === 0,
  noErrors: !errs.length,
};
console.log(JSON.stringify({ alex, shibin, checks, errs }, null, 1));
const pass = Object.values(checks).every(Boolean);
console.log(pass ? 'PASS water' : 'FAIL water ' + Object.keys(checks).filter((k) => !checks[k]).join(','));
process.exit(pass ? 0 : 1);
