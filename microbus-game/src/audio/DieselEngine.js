// صوت موتور ديزل هاي إس (2.5 لتر، 4 سلندر) متولّد من نبضات احتراق حقيقية مش من موجات بسيطة:
// بنحسب "لفة" صوت كاملة لكل سرعة دوران (idle / متوسط / عالي) جوه Buffer — كل نبضة احتراق فيها
// خبطة واطية (العادم) + طقطقة ديزل (نويز مفلتر) + اختلافات صغيرة عشوائية بين السلندرات زي الموتور الحقيقي.
// وقت التشغيل: بنشغل اللفات مع بعض وبنعمل crossfade + تغيير pitch حسب الـ RPM، وطبقة "حِمل" بتعلى مع البنزين.


function rand(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

/** يرسم لفة صوت لموتور شغال على rpm معين. load: 0 = فاضي، 1 = بنزين على الآخر */
function renderLoop(ctx, rpm, load, seed, P) {
  const CYL = P.cyl;
  const sr = ctx.sampleRate;
  const fireHz = (rpm / 60) * (CYL / 2);         // نبضات احتراق في الثانية
  const cycles = P.cyl === 1 ? 64 : 24;                              // عدد دورات الموتور (كل دورة = 4 نبضات)
  const pulses = cycles * CYL;
  const len = Math.round((pulses / fireHz) * sr);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  const R = rand(seed);
  // اختلاف ثابت لكل سلندر (موتور حقيقي مش متساوي)
  const cylAmp = [1, 0.86, 0.95, 0.8].map((a) => a * (0.93 + R() * 0.14));
  const cylTone = [1, 1.06, 0.97, 1.1];
  if (P.cyl === 1) { cylAmp[0] = 1; cylTone[0] = 1; }
  const period = sr / fireHz;
  // 1) نبضات العادم (low thump) + طقطقة الحقن
  for (let p = 0; p < pulses; p++) {
    const c = p % CYL;
    const jitter = (R() - 0.5) * period * 0.035;
    const t0 = Math.round(p * period + jitter);
    const amp = cylAmp[c] * (0.85 + R() * 0.3);
    const f = (P.thump + rpm * P.thumpRpm) * cylTone[c];      // رنين أنبوبة العادم
    const decay = 0.012 + 0.02 * (1 - Math.min(1, rpm / 3800));
    const nThump = Math.min(len, Math.round(period * 1.6));
    for (let i = 0; i < nThump; i++) {
      const t = i / sr;
      const env = Math.exp(-t / decay) * (1 - Math.exp(-t / 0.0007));
      const k = (t0 + i) % len;
      d[k] += amp * env * (Math.sin(2 * Math.PI * f * t) + 0.45 * Math.sin(2 * Math.PI * f * 2.03 * t + 0.6));
    }
    // طقطقة الديزل: نويز قصير عالي (أوضح على idle وتحت الحِمل)
    const knock = P.knock * (0.32 + 0.4 * load) * (rpm < 1200 ? 1.3 : 1) * amp;
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

// أنواع الموتور: ديزل الهاي إس، بنزين التاكسي (من غير طقطقة)، والتوكتوك (سلندر واحد بيزن)
export const ENGINE_TYPES = {
  microbus: { cyl: 4, rpms: [780, 1400, 2200, 3200, 4200], thump: 52, thumpRpm: 0.018, knock: 1.35, tone: 1, turbo: 1, rattle: 1, rough: 1 },
  taxi: { cyl: 4, rpms: [800, 1800, 3000, 4500, 6200], thump: 70, thumpRpm: 0.022, knock: 0.12, tone: 1.5, turbo: 0 },
  tuktuk: { cyl: 1, rpms: [1450, 3000, 4600, 6200, 7800], thump: 95, thumpRpm: 0.03, knock: 0.55, tone: 2.2, turbo: 0, rattle: 0.7, rough: 0.6 },
};

export class DieselEngine {
  constructor(ctx, out, kind = 'microbus') {
    const P = (this.P = ENGINE_TYPES[kind] || ENGINE_TYPES.microbus);
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    // لون الصوت النهائي: شوية bass + قص الحدة
    const lowShelf = ctx.createBiquadFilter(); lowShelf.type = 'lowshelf'; lowShelf.frequency.value = 160; lowShelf.gain.value = 5;
    this.tone = ctx.createBiquadFilter(); this.tone.type = 'lowpass'; this.tone.frequency.value = 2400; this.tone.Q.value = 0.5;
    this.out.connect(lowShelf).connect(this.tone).connect(out);
    this.lowShelf = lowShelf;
    // ميكروباص مصري قديم: الصاج والباب الجرار والشبابيك بيتكتكوا مع رجّة الموتور (أعلى حاجة وهو واقف)
    if (P.rattle) {
      const n = ctx.sampleRate * 2, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
      let k = 0;
      for (let i = 0; i < n; i++) { // تكّات قصيرة متفرقة (مش نويز ناعم)
        if (Math.random() < 0.0016) k = 0.6 + Math.random() * 0.4;
        d[i] = (Math.random() * 2 - 1) * k; k *= 0.985;
      }
      this.rattleSrc = ctx.createBufferSource(); this.rattleSrc.buffer = b; this.rattleSrc.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 1.4;
      const bp2 = ctx.createBiquadFilter(); bp2.type = 'peaking'; bp2.frequency.value = 3400; bp2.gain.value = 6;
      this.rattleMod = ctx.createGain(); this.rattleMod.gain.value = 0.5;
      this.rattleG = ctx.createGain(); this.rattleG.gain.value = 0;
      // بتنبض مع الاحتراق
      this.rattleLfo = ctx.createOscillator(); this.rattleLfo.type = 'square'; this.rattleLfo.frequency.value = 26;
      const depth = ctx.createGain(); depth.gain.value = 0.45;
      this.rattleLfo.connect(depth).connect(this.rattleMod.gain);
      this.rattleSrc.connect(bp).connect(bp2).connect(this.rattleMod).connect(this.rattleG).connect(out);
      this.rattleSrc.start(); this.rattleLfo.start();
    }
    const RPMS = P.rpms;
    this.layers = [];
    RPMS.forEach((rpm, i) => {
      for (const load of [0, 1]) {
        const { buf } = renderLoop(ctx, rpm, load, 1000 + i * 17 + load * 7, P);
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

  update(rpm, load, gain, t, inside = false, bump = 0) {
    const set = (p, v, tc = 0.04) => p.setTargetAtTime(v, t, tc);
    // الـ idle مش ثابت في موتور قديم: بيتهز شوية
    if (this.P.rough && rpm < 1200) rpm += (Math.sin(t * 2.9) * 14 + Math.sin(t * 7.7) * 8 + Math.sin(t * 0.83) * 10) * this.P.rough * (1200 - rpm) / 420;
    set(this.out.gain, gain, 0.06);
    // crossfade بين أقرب لفتين في الـ RPM، وبين فاضي/حِمل
    const rpms = this.P.rpms;
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
    const tk = this.P.tone;
    set(this.tone.frequency, (inside ? 700 + rpm * 0.3 + L * 500 : 1500 + rpm * 0.5 + L * 1200) * tk, 0.08);
    set(this.turbo.frequency, 1400 + rpm * 0.9, 0.2);
    // العادم بيزوم أكتر لما تدوس
    set(this.lowShelf.gain, 4 + L * 5, 0.15);
    if (this.rattleG) {
      const idle = Math.max(0, 1 - (rpm - 750) / 1300);
      set(this.rattleG.gain, this.P.rattle * gain * (0.05 + idle * 0.13 + bump * 0.35) * (inside ? 1.25 : 0.55), 0.08);
      set(this.rattleLfo.frequency, (rpm / 60) * 2, 0.05);
    }
    set(this.turboG.gain, this.P.turbo * gain * L * Math.max(0, rpm - 1700) / 2600 * 0.035, 0.25);
  }

  dispose() {
    for (const ly of this.layers) { try { ly.src.stop(); } catch { /* */ } ly.src.disconnect(); }
    try { this.turbo.stop(); } catch { /* */ }
    if (this.rattleSrc) { try { this.rattleSrc.stop(); this.rattleLfo.stop(); } catch { /* */ } this.rattleG.disconnect(); }
    this.out.disconnect(); this.turboG.disconnect();
  }
}
