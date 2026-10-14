// صوت موتور ديزل هاي إس (2.5 لتر، 4 سلندر) متولّد من نبضات احتراق حقيقية مش من موجات بسيطة:
// بنحسب "لفة" صوت كاملة لكل سرعة دوران (idle / متوسط / عالي) جوه Buffer — كل نبضة احتراق فيها
// خبطة واطية (العادم) + طقطقة ديزل (نويز مفلتر) + اختلافات صغيرة عشوائية بين السلندرات زي الموتور الحقيقي.
// وقت التشغيل: بنشغل اللفات مع بعض وبنعمل crossfade + تغيير pitch حسب الـ RPM، وطبقة "حِمل" بتعلى مع البنزين.

const CYL = 4;

function rand(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

/** يرسم لفة صوت لموتور شغال على rpm معين. load: 0 = فاضي، 1 = بنزين على الآخر */
function renderLoop(ctx, rpm, load, seed) {
  const sr = ctx.sampleRate;
  const fireHz = (rpm / 60) * (CYL / 2);         // نبضات احتراق في الثانية
  const cycles = 24;                              // عدد دورات الموتور (كل دورة = 4 نبضات)
  const pulses = cycles * CYL;
  const len = Math.round((pulses / fireHz) * sr);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  const R = rand(seed);
  // اختلاف ثابت لكل سلندر (موتور حقيقي مش متساوي)
  const cylAmp = [1, 0.86, 0.95, 0.8].map((a) => a * (0.93 + R() * 0.14));
  const cylTone = [1, 1.06, 0.97, 1.1];
  const period = sr / fireHz;
  // 1) نبضات العادم (low thump) + طقطقة الحقن
  for (let p = 0; p < pulses; p++) {
    const c = p % CYL;
    const jitter = (R() - 0.5) * period * 0.035;
    const t0 = Math.round(p * period + jitter);
    const amp = cylAmp[c] * (0.85 + R() * 0.3);
    const f = (55 + rpm * 0.018) * cylTone[c];      // رنين أنبوبة العادم
    const decay = 0.012 + 0.02 * (1 - Math.min(1, rpm / 3800));
    const nThump = Math.min(len, Math.round(period * 1.6));
    for (let i = 0; i < nThump; i++) {
      const t = i / sr;
      const env = Math.exp(-t / decay) * (1 - Math.exp(-t / 0.0007));
      const k = (t0 + i) % len;
      d[k] += amp * env * (Math.sin(2 * Math.PI * f * t) + 0.45 * Math.sin(2 * Math.PI * f * 2.03 * t + 0.6));
    }
    // طقطقة الديزل: نويز قصير عالي (أوضح على idle وتحت الحِمل)
    const knock = (0.32 + 0.4 * load) * (rpm < 1200 ? 1.3 : 1) * amp;
    const nK = Math.round(sr * 0.006);
    let lp = 0;
    for (let i = 0; i < nK; i++) {
      const t = i / sr;
      lp += ((R() * 2 - 1) - lp) * 0.55;               // نويز ملوّن شوية
      const k = (t0 + Math.round(period * 0.08) + i) % len;
      d[k] += knock * lp * Math.exp(-t / 0.0016);
    }
  }
  // 2) فلتر بسيط (كتلة الموتور + الشاسيه) وتطبيع
  let y1 = 0, y2 = 0, peak = 0;
  const a = 0.18 + Math.min(0.5, rpm / 9000);
  for (let i = 0; i < len; i++) { y1 += (d[i] - y1) * a; y2 += (y1 - y2) * 0.6; d[i] = y1 * 0.7 + y2 * 0.3; peak = Math.max(peak, Math.abs(d[i])); }
  // نعدّي على البداية/النهاية عشان اللوب يكون متصل
  for (let i = 0; i < len; i++) d[i] /= peak || 1;
  return { buf, rpm };
}

export class DieselEngine {
  constructor(ctx, out) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    // لون الصوت النهائي: شوية bass + قص الحدة
    const lowShelf = ctx.createBiquadFilter(); lowShelf.type = 'lowshelf'; lowShelf.frequency.value = 160; lowShelf.gain.value = 5;
    this.tone = ctx.createBiquadFilter(); this.tone.type = 'lowpass'; this.tone.frequency.value = 2400; this.tone.Q.value = 0.5;
    this.out.connect(lowShelf).connect(this.tone).connect(out);
    const RPMS = [780, 1400, 2200, 3200, 4200];
    this.layers = [];
    RPMS.forEach((rpm, i) => {
      for (const load of [0, 1]) {
        const { buf } = renderLoop(ctx, rpm, load, 1000 + i * 17 + load * 7);
        const src = ctx.createBufferSource();
        src.buffer = buf; src.loop = true;
        const g = ctx.createGain(); g.gain.value = 0;
        src.connect(g).connect(this.out);
        src.start(0, Math.random() * buf.duration);
        this.layers.push({ rpm, load, src, g });
      }
    });
    // صفير التيربو + شفط الهوا (بيعلوا مع الحِمل)
    this.turbo = ctx.createOscillator(); this.turbo.type = 'sine'; this.turbo.frequency.value = 2200;
    this.turboG = ctx.createGain(); this.turboG.gain.value = 0;
    this.turbo.connect(this.turboG).connect(out); this.turbo.start();
  }

  update(rpm, load, gain, t, inside = false) {
    const set = (p, v, tc = 0.04) => p.setTargetAtTime(v, t, tc);
    set(this.out.gain, gain, 0.06);
    // crossfade بين أقرب لفتين في الـ RPM، وبين فاضي/حِمل
    const rpms = [780, 1400, 2200, 3200, 4200];
    let i = 0; while (i < rpms.length - 2 && rpm > rpms[i + 1]) i++;
    const f = Math.max(0, Math.min(1, (rpm - rpms[i]) / (rpms[i + 1] - rpms[i])));
    const L = Math.max(0, Math.min(1, load));
    for (const ly of this.layers) {
      const idx = rpms.indexOf(ly.rpm);
      const wR = idx === i ? Math.cos(f * Math.PI / 2) : idx === i + 1 ? Math.sin(f * Math.PI / 2) : 0;
      const wL = ly.load ? Math.sin(L * Math.PI / 2) : Math.cos(L * Math.PI / 2);
      set(ly.g.gain, wR * wL * (ly.load ? 1.15 : 0.9));
      set(ly.src.playbackRate, rpm / ly.rpm, 0.03);
    }
    // جوه الكابينة (الموتور تحت الكرسي في الهاي إس): أوطى وأتقل. برا: أوضح وفيه طقطقة
    set(this.tone.frequency, inside ? 700 + rpm * 0.3 + L * 500 : 1500 + rpm * 0.5 + L * 1200, 0.08);
    set(this.turbo.frequency, 1400 + rpm * 0.9, 0.2);
    set(this.turboG.gain, gain * L * Math.max(0, rpm - 1700) / 2600 * 0.035, 0.25);
  }
}
