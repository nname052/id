// node tools/models/preview.mjs <glb> <out.png>  → صورة 4 زوايا + معلومات القطع (dev server على 5173)
const { chromium } = await import('/opt/node22/lib/node_modules/playwright/index.mjs');
const [f, out] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 1000, height: 700 } });
p.on('pageerror', (e) => console.log('ERR', e.message));
await p.goto('http://localhost:5173/tools/models/preview.html?f=/@fs' + f); await p.waitForFunction(() => document.title === 'ready', null, { timeout: 120000 });
console.log(JSON.stringify(await p.evaluate(() => window.INFO)));
await p.screenshot({ path: out }); await b.close();
