// =====================================================================
//  أصوات الطيران (من غير ملفات — WebAudio بيولّدها):
//  - الهليكوبتر: "طق طق" الريشة = ضوضاء بتتعدل بتردد مرور الريش (ريشتين × ~6.6 لفة/ث ≈ 13 هرتز) + أزيز التوربينة
//  - الطيارة: هدير المحركات (ضوضاء منخفضة) + صفير التوربينة (بيعلى مع الدفع) + هوا على الجسم مع السرعة
//  - صوت اللمس على الممر والتحطم
// =====================================================================
export class FlightAudio {
  constructor(sys) { this.sys = sys; this.on = false; }

  start(kind) {
    const S = this.sys; if (!S?.started || !S.ctx) return;
    this.stop();
    const ctx = S.ctx, t = ctx.currentTime;
    const n = ctx.createBufferSource(); n.buffer = S.noiseBuf; n.loop = true;
    const out = ctx.createGain(); out.gain.value = 0; out.connect(S.master);
    const N = { kind, n, out, nodes: [n] };
    // الهدير / الريشة
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = kind === 'heli' ? 420 : 700; lp.Q.value = 0.7;
    const mod = ctx.createGain(); mod.gain.value = kind === 'heli' ? 0.4 : 1;
    n.connect(lp).connect(mod).connect(out);
    N.lp = lp; N.mod = mod;
    if (kind === 'heli') {
      // تعديل السعة بتردد مرور الريش (LFO)
      const lfo = ctx.createOscillator(); lfo.type = 'sawtooth'; lfo.frequency.value = 0.1;
      const lg = ctx.createGain(); lg.gain.value = 0.6; lfo.connect(lg).connect(mod.gain); lfo.start(t);
      N.lfo = lfo; N.nodes.push(lfo);
    }
    // التوربينة (صفير)
    const w = ctx.createOscillator(); w.type = 'triangle'; w.frequency.value = 200;
    const wg = ctx.createGain(); wg.gain.value = 0; w.connect(wg).connect(out); w.start(t);
    N.w = w; N.wg = wg; N.nodes.push(w);
    // الهوا
    const n2 = ctx.createBufferSource(); n2.buffer = S.noiseBuf; n2.loop = true; n2.playbackRate.value = 0.7;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.6;
    const ag = ctx.createGain(); ag.gain.value = 0; n2.connect(bp).connect(ag).connect(S.master);
    N.ag = ag; N.nodes.push(n2);
    n.start(t); n2.start(t);
    this.N = N; this.on = true; this._gnd = true;
  }

  stop() {
    if (!this.N) return;
    const S = this.sys, t = S.ctx.currentTime;
    this.N.out.gain.setTargetAtTime(0, t, 0.1); this.N.ag.gain.setTargetAtTime(0, t, 0.1);
    const nodes = this.N.nodes; setTimeout(() => { for (const x of nodes) try { x.stop(); } catch { /* */ } }, 600);
    this.N = null; this.on = false;
  }

  update(dt, F, kind, camera, pos) {
    const N = this.N; if (!N) return;
    const S = this.sys, t = S.ctx.currentTime, set = (p, v, tc = 0.08) => p.setTargetAtTime(v, t, tc);
    const d = camera.position.distanceTo(pos), att = Math.min(1, (kind === 'plane' ? 40 : 14) / Math.max(8, d));
    const vol = (S.vol?.engine ?? 0.8) / 0.8 * (S.muted ? 0 : 1);
    const V = F.B.vel.length();
    if (kind === 'heli') {
      const rpm = F.rpm;
      set(N.lfo.frequency, Math.max(0.1, rpm * 13.2 * (1 + 0.03 * (F.coll - 0.5))));
      set(N.out.gain, vol * att * (0.12 + 0.55 * rpm * (0.6 + 0.6 * F.coll)));
      set(N.lp.frequency, 260 + 520 * rpm * (0.5 + F.coll));
      set(N.w.frequency, 180 + 1450 * rpm); set(N.wg.gain, 0.05 * rpm);
    } else {
      const p = F.throttle;
      set(N.out.gain, vol * att * (0.18 + 0.7 * p));
      set(N.lp.frequency, 380 + 1300 * p);
      set(N.w.frequency, 420 + 2200 * p + V * 2); set(N.wg.gain, 0.025 + 0.05 * p);
    }
    set(N.ag.gain, vol * Math.min(0.35, (V / 120) ** 2 * 0.35));
    // صوت لمس العجل/الزحافات للأرض
    if (F.onGround && !this._gnd && (F.touchSink || 0) > 0.6) this.sys.thump?.(Math.min(1, F.touchSink / 3));
    this._gnd = F.onGround;
  }

  crash() { this.sys.thump?.(1); this.sys.crash?.(1); }
}
