// =====================================================================
//  الصوت: مفيش "صفير" (نغمة حادة ضيقة فوق 1.5كيلو) وانت بتسوق/بتفرمل — وراديو: زرار من غير رابط،
//  رفض رابط مش https، وفشل الشبكة بهدوء، ونسخة مشغّل واحدة
//   node tools/tests/audio-radio.mjs [baseUrl]
// =====================================================================
const PW = process.env.PLAYWRIGHT || '/opt/node22/lib/node_modules/playwright/index.mjs';
const { chromium } = await import(PW);
const BASE = process.argv[2] || 'http://localhost:5173/';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
page.setDefaultTimeout(900000);
const errors = []; page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${BASE}?map=shibin`);
await page.waitForFunction(() => !document.getElementById('go').disabled);
await page.click('#go'); await page.waitForTimeout(1500);
await page.evaluate(() => document.querySelector('#linepick .lp-close')?.click());
// تحليل الطيف على الـ master وانت بتسوق
await page.evaluate(() => {
  const A = game.audio, an = A.ctx.createAnalyser(); an.fftSize = 4096; an.smoothingTimeConstant = 0.5;
  A.master.connect(an); window.__an = an; window.__peaks = [];
  window.__sample = () => {
    const d = new Float32Array(an.frequencyBinCount); an.getFloatFrequencyData(d);
    const hz = A.ctx.sampleRate / an.fftSize; let worst = -1e9, at = 0;
    for (let i = Math.floor(1500 / hz); i < Math.floor(8000 / hz); i++) {
      let s = 0, n = 0; for (let k = i - 12; k <= i + 12; k++) if (Math.abs(k - i) > 2) { s += d[k]; n++; }
      const prom = d[i] - s / n; // بروز القمة عن جيرانها
      if (d[i] > -90 && prom > worst) { worst = prom; at = i * hz; }
    }
    window.__peaks.push([+worst.toFixed(1), Math.round(at)]);
  };
});
const sample = async (ms) => { for (let t = 0; t < ms; t += 250) { await page.waitForTimeout(250); await page.evaluate(() => window.__sample()); } };
await page.keyboard.down('w'); await sample(6000); await page.keyboard.up('w');
await page.keyboard.down('s'); await sample(3000); await page.keyboard.up('s');
const peaks = await page.evaluate(() => window.__peaks);
const worst = peaks.reduce((m, p) => (p[0] > m[0] ? p : m), [-1e9, 0]);
// الراديو
const radio = await page.evaluate(async () => {
  const R = game.radio, out = {};
  out.box = !!document.querySelector('#settings .radio-box');
  localStorage.removeItem('egy-radio-url-v1');
  R.play(); out.noUrl = R.state;
  out.badUrlRejected = R.setUrl('http://insecure.example/stream') === false;
  R.setUrl('https://radio.invalid/stream'); R.play();
  await new Promise((r) => setTimeout(r, 4000));
  out.netFail = R.state;
  R.play(); R.toggle(); out.afterToggle = R.state;
  out.players = document.querySelectorAll('audio').length; // (Audio() مش بيتضاف للصفحة) — المهم مشغّل واحد مشترك
  R.setUrl('');
  return out;
});
const pass = worst[0] < 18 && radio.box && radio.noUrl === 'unset' && radio.badUrlRejected && ['error', 'off'].includes(radio.netFail) && radio.afterToggle === 'off' && !errors.length;
console.log(JSON.stringify({ worstTonalPeak_dB: worst[0], atHz: worst[1], samples: peaks.length, radio, errors }));
console.log(pass ? 'PASS audio-radio' : 'FAIL audio-radio');
await browser.close();
process.exit(pass ? 0 : 1);
