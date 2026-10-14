// الصوت: كله متولّد بالكود (Web Audio API) كـ Placeholder قانوني 100%:
// موتور ديزل (Idle + RPM)، كاوتش بيصرخ، فرامل، كلاكس، دوشة شارع، عربيات حواليك (3D Spatial Audio).
// لو حطيت ملفات صوت حقيقية في assets/audio هتتستخدم بدلها (شوف ASSETS.md).

export class AudioSystem {
  constructor(assets) {
    this.assets = assets;
    this.ctx = null;
    this.muted = false;
    this.started = false;
  }

  async start() {
    if (this.started) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    if (ctx.state === 'suspended') await ctx.resume();
    this.started = true;

    this.master = ctx.createGain();
    this.master.gain.value = 0.62 * (this.vol?.master ?? 0.8) / 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    // باص الأصوات الخارجية (بيتكتم شوية لما تكون جوه الميكروباص)
    this.outside = ctx.createBiquadFilter();
    this.outside.type = 'lowpass'; this.outside.frequency.value = 18000;
    this.outside.connect(this.master);

    this.noiseBuf = this._noiseBuffer(2);
    this.brownBuf = this._brownBuffer(4);

    await this._loadFiles();
    this._buildEngine();
    this._buildTires();
    this._buildAmbience();
    this._buildTraffic();
    this.hornGain = null;
    // صدى النفق
    this.echo = ctx.createDelay(1); this.echo.delayTime.value = 0.09;
    this.echoFb = this._gain(0.0); this.echoWet = this._gain(0.0);
    this.echo.connect(this.echoFb).connect(this.echo);
    this.echo.connect(this.echoWet).connect(this.master);
    this.engine.out.connect(this.echo);
    // حصى/تراب لما تطلع على الشولدر
    const gn = this._loop(this.noiseBuf);
    this.gravelG = this._gain(0);
    gn.connect(this._filter('bandpass', 2400, 0.8)).connect(this.gravelG).connect(this.master);
    this._buildExtras();
    this.engineStart();
  }

  // ===== أصوات إضافية: ونس الركاب، صفير الريوس، احتكاك الصاج في الانقلاب =====
  _buildExtras() {
    const x = (this.extra = {});
    // كلام الركاب: نويز في نطاق الصوت البشري بيتعدّل ببطء (همهمة)
    const n = this._loop(this.brownBuf);
    const f1 = this._filter('bandpass', 520, 2.2), f2 = this._filter('bandpass', 1300, 3);
    x.chatter = this._gain(0);
    const mod = this._gain(0.5);
    x.chatLfo = this._osc('sine', 2.3);
    const lfoAmt = this._gain(0.5);
    x.chatLfo.connect(lfoAmt).connect(mod.gain);
    n.connect(f1).connect(mod); n.connect(f2).connect(mod);
    mod.connect(x.chatter).connect(this.master);
    // صفير جير الريوس
    x.rev = this._osc('sine', 600);
    x.revG = this._gain(0);
    x.rev.connect(x.revG).connect(this.master);
    // صاج بيتزحلق على الأسفلت
    const n2 = this._loop(this.noiseBuf);
    x.scrapeG = this._gain(0);
    n2.connect(this._filter('bandpass', 3200, 1.5)).connect(x.scrapeG).connect(this.master);
    x.scrapeTone = this._osc('sawtooth', 180);
    const st = this._gain(0.08);
    x.scrapeTone.connect(this._filter('bandpass', 900, 6)).connect(st).connect(x.scrapeG);
  }

  /** مارش + دوران الموتور أول ما تبدأ */
  engineStart() {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = this._osc('sawtooth', 9);
    o.frequency.setValueAtTime(9, t); o.frequency.linearRampToValueAtTime(14, t + 0.9);
    const lp = this._filter('lowpass', 500, 2);
    const g = this._gain(0); g.gain.linearRampToValueAtTime(0.3, t + 0.05); g.gain.setValueAtTime(0.3, t + 0.85); g.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
    o.connect(lp).connect(g).connect(this.master); o.stop(t + 1.2);
    // الموتور بيعلى بالراحة بعد المارش
    if (this.engine?.out) { this.engine.out.gain.cancelScheduledValues(t); this.engine.out.gain.setValueAtTime(0, t); this._engineHold = t + 0.85; }
  }

  /** زجاج/فانوس بيتكسر */
  glass() {
    if (!this.started || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (let i = 0; i < 6; i++) {
      const tt = t + i * 0.03 + Math.random() * 0.03;
      const o = this._osc('sine', 2500 + Math.random() * 3500);
      const g = this._gain(0); g.gain.setValueAtTime(0.0001, tt); g.gain.linearRampToValueAtTime(0.12, tt + 0.005); g.gain.exponentialRampToValueAtTime(0.001, tt + 0.12 + Math.random() * 0.15);
      o.connect(g).connect(this.master); o.stop(tt + 0.35);
    }
    const n = ctx.createBufferSource(); n.buffer = this.noiseBuf; n.start(t, Math.random());
    const ng = this._gain(0.25); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    n.connect(this._filter('highpass', 3500, 0.7)).connect(ng).connect(this.master); n.stop(t + 0.35);
  }

  async _loadFiles() {
    this.buffers = {};
    const files = this.assets?.audio || {};
    await Promise.all(Object.entries(files).map(async ([k, url]) => {
      try {
        const r = await fetch(url);
        this.buffers[k] = await this.ctx.decodeAudioData(await r.arrayBuffer());
      } catch (e) { console.warn('audio', k, e.message); }
    }));
  }

  _noiseBuffer(sec) {
    const b = this.ctx.createBuffer(1, this.ctx.sampleRate * sec, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  _brownBuffer(sec) {
    const b = this.ctx.createBuffer(1, this.ctx.sampleRate * sec, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
    return b;
  }
  _loop(buf) { const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(0, Math.random() * buf.duration); return s; }
  _osc(type, f) { const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = f; o.start(); return o; }
  _gain(v = 0) { const g = this.ctx.createGain(); g.gain.value = v; return g; }
  _filter(type, f, q = 1) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }

  _buildEngine() {
    const ctx = this.ctx;
    const e = (this.engine = {});
    e.out = this._gain(0.0);
    e.out.connect(this.master);
    if (this.buffers.engineLoop) {
      e.file = this._loop(this.buffers.engineLoop);
      e.file.connect(e.out);
      return;
    }
    // تشويه خفيف للخشونة
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.tanh(x * 2.2); }
    shaper.curve = curve;
    e.lp = this._filter('lowpass', 400, 2);
    shaper.connect(e.lp).connect(e.out);
    e.saw = this._osc('sawtooth', 26);
    e.sq = this._osc('square', 13);
    e.sub = this._osc('sine', 13);
    const gs = this._gain(0.5), gq = this._gain(0.25), gb = this._gain(0.6);
    e.saw.connect(gs).connect(shaper);
    e.sq.connect(gq).connect(shaper);
    e.sub.connect(gb).connect(e.out);
    // تكتكة الديزل: نويز متعدّل بنبضات الاشتعال
    const n = this._loop(this.noiseBuf);
    const bp = this._filter('bandpass', 1900, 0.9);
    e.clatter = this._gain(0);
    const mod = this._gain(0);
    e.pulse = this._osc('square', 26);
    const pulseAmt = this._gain(0.5);
    e.pulse.connect(pulseAmt).connect(mod.gain);
    n.connect(bp).connect(mod).connect(e.clatter).connect(e.out);
    // تيربو/صفير خفيف
    e.whine = this._osc('sine', 900);
    e.whineG = this._gain(0);
    e.whine.connect(e.whineG).connect(e.out);
  }

  _buildTires() {
    const t = (this.tires = {});
    const n = this._loop(this.noiseBuf);
    t.squealG = this._gain(0);
    const bp = this._filter('bandpass', 1100, 7);
    n.connect(bp).connect(t.squealG).connect(this.master);
    t.tone = this._osc('triangle', 1050);
    t.toneG = this._gain(0);
    t.tone.connect(t.toneG).connect(t.squealG);
    // صوت الطريق (تدحرج الكاوتش)
    const n2 = this._loop(this.brownBuf);
    t.roadG = this._gain(0);
    n2.connect(this._filter('lowpass', 380, 0.7)).connect(t.roadG).connect(this.master);
    // هوا
    const n3 = this._loop(this.noiseBuf);
    t.windG = this._gain(0);
    n3.connect(this._filter('bandpass', 700, 0.5)).connect(t.windG).connect(this.master);
    // صفارة فرامل
    t.brake = this._osc('sine', 2700);
    t.brakeG = this._gain(0);
    t.brake.connect(t.brakeG).connect(this.master);
  }

  _buildAmbience() {
    const a = (this.amb = {});
    a.g = this._gain(0.5);
    a.g.connect(this.outside);
    if (this.buffers.ambience) {
      this._loop(this.buffers.ambience).connect(a.g);
    } else {
      const n = this._loop(this.brownBuf);
      n.connect(this._filter('lowpass', 500, 0.5)).connect(this._gain(0.35)).connect(a.g);
      const n2 = this._loop(this.noiseBuf);
      n2.connect(this._filter('bandpass', 1400, 0.4)).connect(this._gain(0.025)).connect(a.g);
    }
    this.nextDistantHonk = 2;
  }

  _buildTraffic() {
    // 3 أصوات موتور لأقرب 3 عربيات (Spatial)
    this.voices = [];
    for (let i = 0; i < 3; i++) {
      const p = this.ctx.createPanner();
      p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 4; p.rolloffFactor = 1.4;
      const g = this._gain(0);
      const o = this._osc('sawtooth', 30);
      const lp = this._filter('lowpass', 260, 1.5);
      o.connect(lp).connect(g).connect(p).connect(this.outside);
      this.voices.push({ p, g, o, lp });
    }
  }

  /** كلاكس عربية AI (Spatial) */
  honk(x, y, z, pitch = 1, distant = false) {
    if (!this.started || this.muted) return;
    const ctx = this.ctx;
    const p = ctx.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = distant ? 2 : 6; p.rolloffFactor = 1.2;
    p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z;
    const g = this._gain(0);
    const f1 = 380 * pitch * (0.9 + Math.random() * 0.25);
    const o1 = this._osc('sawtooth', f1), o2 = this._osc('square', f1 * 1.26);
    const lp = this._filter('lowpass', 2400, 1);
    o1.connect(lp); o2.connect(lp);
    lp.connect(g).connect(p).connect(this.outside);
    const t = ctx.currentTime;
    const beeps = 1 + Math.floor(Math.random() * 3);
    const vol = distant ? 0.05 : 0.22;
    let tt = t;
    for (let i = 0; i < beeps; i++) {
      const len = i === beeps - 1 && Math.random() < 0.4 ? 0.7 : 0.14 + Math.random() * 0.1;
      g.gain.setValueAtTime(0, tt);
      g.gain.linearRampToValueAtTime(vol, tt + 0.015);
      g.gain.setValueAtTime(vol, tt + len);
      g.gain.linearRampToValueAtTime(0, tt + len + 0.03);
      tt += len + 0.1;
    }
    o1.stop(tt + 0.1); o2.stop(tt + 0.1);
    o2.onended = () => { p.disconnect(); };
  }

  /** كلاكس الميكروباص بتاعك */
  _playerHorn(on) {
    const ctx = this.ctx;
    if (on && !this.hornGain) {
      this.hornGain = this._gain(0);
      if (this.buffers.horn) {
        const s = ctx.createBufferSource(); s.buffer = this.buffers.horn; s.loop = true; s.start();
        s.connect(this.hornGain); this.hornSrc = [s];
      } else {
        const o1 = this._osc('sawtooth', 415), o2 = this._osc('sawtooth', 523), o3 = this._osc('square', 622);
        const lp = this._filter('lowpass', 3000, 1.2);
        const g3 = this._gain(0.35);
        o1.connect(lp); o2.connect(lp); o3.connect(g3).connect(lp);
        lp.connect(this.hornGain);
        this.hornSrc = [o1, o2, o3];
      }
      this.hornGain.connect(this.master);
      this.hornGain.gain.setTargetAtTime(0.28, ctx.currentTime, 0.01);
    } else if (!on && this.hornGain) {
      const g = this.hornGain, srcs = this.hornSrc;
      g.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
      srcs.forEach((s) => s.stop(ctx.currentTime + 0.15));
      setTimeout(() => g.disconnect(), 300);
      this.hornGain = null;
    }
  }

  impact(strength) {
    if (!this.started || this.muted || strength < 0.6) return;
    const ctx = this.ctx;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const g = this._gain(0);
    const lp = this._filter('lowpass', 300 + strength * 120, 1);
    s.connect(lp).connect(g).connect(this.master);
    const t = ctx.currentTime, v = Math.min(1, strength / 6);
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35 + v * 0.3);
    s.start(t, Math.random()); s.stop(t + 0.8);
    // صوت صاج
    const o = this._osc('square', 90 + Math.random() * 40);
    const og = this._gain(v * 0.25);
    o.connect(this._filter('bandpass', 500, 3)).connect(og).connect(this.master);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.25); o.stop(t + 0.3);
  }

  thump(strength) {
    if (!this.started || this.muted || strength < 0.15) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = this._osc('sine', 55);
    const g = this._gain(Math.min(0.5, strength * 0.6));
    o.connect(g).connect(this.master);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18); o.stop(t + 0.2);
  }

  /** خبطة العجلة في حرف الرصيف: "دُب" واطي + طقة كاوتش/جنط */
  curb(strength) {
    if (!this.started || this.muted || strength < 0.1) return;
    const ctx = this.ctx, t = ctx.currentTime, k = Math.min(1, strength);
    const o = this._osc('sine', 48 + k * 20);
    o.frequency.exponentialRampToValueAtTime(32, t + 0.2);
    const g = this._gain(0.25 + k * 0.45);
    o.connect(g).connect(this.master);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.26); o.stop(t + 0.3);
    const n = ctx.createBufferSource(); n.buffer = this.noiseBuf; n.start(t, Math.random());
    const ng = this._gain(0.12 + k * 0.35);
    n.connect(this._filter('bandpass', 700 + k * 600, 1.2)).connect(ng).connect(this.master);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.09 + k * 0.08); n.stop(t + 0.25);
  }

  /** الباب الجرار: زحلقة + خبطة في الآخر */
  door(opening) {
    if (!this.started || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime, dur = 0.75;
    const n = ctx.createBufferSource(); n.buffer = this.noiseBuf; n.start(t, Math.random());
    const f = this._filter('bandpass', opening ? 900 : 1200, 2.5);
    f.frequency.linearRampToValueAtTime(opening ? 1400 : 700, t + dur);
    const g = this._gain(0.0); g.gain.linearRampToValueAtTime(0.16, t + 0.08); g.gain.linearRampToValueAtTime(0.1, t + dur - 0.1); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    n.connect(f).connect(g).connect(this.master); n.stop(t + dur + 0.05);
    // الخبطة (أقوى في القفل)
    const o = this._osc('sine', opening ? 140 : 95);
    const og = this._gain(0); og.gain.setValueAtTime(0.0001, t + dur - 0.02); og.gain.linearRampToValueAtTime(opening ? 0.18 : 0.42, t + dur); og.gain.exponentialRampToValueAtTime(0.001, t + dur + 0.2);
    o.connect(og).connect(this.master); o.stop(t + dur + 0.25);
  }

  /** مستوى الصوت العام وصوت الموتور (0..1). 0.8 = المستوى الأصلي */
  setVolumes(master, engine) {
    this.vol = { master, engine };
    if (this.master && !this.muted) this.master.gain.setTargetAtTime(0.62 * master / 0.8, this.ctx.currentTime, 0.05);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.62 * (this.vol?.master ?? 0.8) / 0.8, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  update(dt, { player, camera, traffic, inside, horn, passengers }) {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const ph = player.physics;
    const set = (param, v, tc = 0.05) => param.setTargetAtTime(v, t, tc);

    // المستمع = الكاميرا
    const L = ctx.listener;
    const fwd = camera.getWorldDirection(this._tmp || (this._tmp = camera.position.clone()));
    if (L.positionX) {
      L.positionX.value = camera.position.x; L.positionY.value = camera.position.y; L.positionZ.value = camera.position.z;
      L.forwardX.value = fwd.x; L.forwardY.value = fwd.y; L.forwardZ.value = fwd.z;
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else {
      L.setPosition(camera.position.x, camera.position.y, camera.position.z);
      L.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0);
    }

    // الموتور
    const e = this.engine;
    const rpm = ph.rpm, thr = ph.throttle;
    const camDist = camera.position.distanceTo(player.rig.root.position);
    const distAtt = inside ? 1 : Math.min(1, 6 / Math.max(3, camDist));
    if (!(this._engineHold && t < this._engineHold)) set(e.out.gain, (inside ? 0.5 : 0.42) * distAtt * (0.75 + thr * 0.35) * (this.vol?.engine ?? 0.8) / 0.8);
    if (e.file) {
      set(e.file.playbackRate, 0.6 + rpm / 2200);
    } else {
      const fire = (rpm / 60) * 2;
      set(e.saw.frequency, fire); set(e.pulse.frequency, fire);
      set(e.sq.frequency, fire / 2); set(e.sub.frequency, fire / 2);
      set(e.lp.frequency, 180 + rpm * 0.12 + thr * 650 + (inside ? 0 : 300));
      set(e.clatter.gain, 0.05 + thr * 0.14 + (inside ? 0 : 0.05));
      set(e.whine.frequency, 600 + rpm * 0.5);
      set(e.whineG.gain, thr * Math.max(0, rpm - 1800) / 2500 * 0.025);
    }

    // الكاوتش والطريق والهوا
    const tr = this.tires;
    let skid = 0;
    for (const w of ph.wheels) skid = Math.max(skid, w.skid);
    if (ph.speed < 1.5) skid *= ph.speed / 1.5;
    set(tr.squealG.gain, skid * 0.32 * distAtt, 0.04);
    set(tr.toneG.gain, skid * 0.3, 0.04);
    set(tr.tone.frequency, 950 + Math.sin(t * 13) * 60 + ph.speed * 8);
    const surf = player.surface || 'city';
    const roughK = surf === 'agri' || surf === 'village' ? 1.5 : surf === 'dirt' ? 1.8 : surf === 'bridge' ? 1.15 : 1;
    set(tr.roadG.gain, Math.min(0.5, ph.speed / 30) * 0.45 * roughK * distAtt);
    set(this.gravelG.gain, surf === 'dirt' ? Math.min(0.12, ph.speed / 80) * distAtt : 0, 0.1);
    const tunnel = surf === 'tunnel';
    set(this.echoFb.gain, tunnel ? 0.42 : 0, 0.2);
    set(this.echoWet.gain, tunnel ? 0.5 : 0, 0.2);
    set(tr.windG.gain, Math.min(0.12, (ph.speed * ph.speed) / 4000) * (inside ? 0.6 : 1));
    const squeal = ph.brake > 0.3 && ph.speed > 0.5 && ph.speed < 4 ? 0.025 : 0;
    set(tr.brakeG.gain, squeal * distAtt, 0.08);

    // ونس الركاب / ريوس / احتكاك صاج
    const x = this.extra;
    if (x) {
      const pax = passengers || 0;
      set(x.chatter.gain, Math.min(0.09, pax * 0.008) * (inside ? 1 : 0.25), 0.4);
      set(x.chatLfo.frequency, 1.6 + Math.sin(t * 0.37) * 0.8 + Math.sin(t * 1.3) * 0.4, 0.3);
      const rv = ph.gearMode === 'R' ? Math.min(1, Math.abs(ph.forwardSpeed) / 4) : 0;
      set(x.revG.gain, rv * 0.03 * distAtt, 0.08);
      set(x.rev.frequency, 380 + Math.abs(ph.forwardSpeed) * 260, 0.05);
      const scrape = ph.flip?.mode && Math.abs(Math.atan2(Math.sin(ph.flip.theta), Math.cos(ph.flip.theta))) > 0.9 ? Math.min(1, ph.speed / 6) : 0;
      set(x.scrapeG.gain, scrape * 0.22 * distAtt, 0.05);
      set(x.scrapeTone.frequency, 140 + ph.speed * 25, 0.05);
    }

    // جوه/بره
    set(this.outside.frequency, inside ? 2200 : 18000, 0.1);
    this._playerHorn(!!horn && !this.muted);

    // صوت المرور
    if (traffic) {
      const near = traffic.nearest(camera.position.x, camera.position.z, 3);
      this.voices.forEach((v, i) => {
        const c = near[i];
        if (!c) { set(v.g.gain, 0); return; }
        v.p.positionX.value = c.x; v.p.positionY.value = 0.8; v.p.positionZ.value = c.z;
        set(v.o.frequency, 26 + c.v * 3.2 + Math.max(0, c.acc) * 8);
        set(v.lp.frequency, 200 + c.v * 15);
        set(v.g.gain, 0.12 + Math.max(0, c.acc) * 0.05);
      });
    }
    // كلاكسات بعيدة (روح الشارع المصري)
    this.nextDistantHonk -= dt;
    if (this.nextDistantHonk <= 0) {
      this.nextDistantHonk = 2.5 + Math.random() * 7;
      const a = Math.random() * Math.PI * 2, r = 40 + Math.random() * 80;
      this.honk(camera.position.x + Math.cos(a) * r, 2, camera.position.z + Math.sin(a) * r, 0.8 + Math.random() * 0.5, true);
    }
  }
}
