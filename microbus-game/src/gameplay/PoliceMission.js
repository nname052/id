// =====================================================================
//  مهمات الشرطة (لما تسوق البوكس): بلاغ عن عربية خبطت وهربت قريب منك → مشهد قصير (بيتخطّى) →
//  مطاردة بالسارينة والكشاف: الهربان بيسرّع (×1.6) وإنت لازم تفضل جنبه (أقل من 10م) ثانيتين ونص عشان يقف.
//  لو بعد عنك أكتر من مدى المرور (~280م) أو عدّت دقيقتين = هرب. المكافأة على قد سرعتك.
// =====================================================================
import { nearestPlace, DropMarker } from './Destinations.js';
const FLEE_MUL = 1.6, CATCH_R = 10, CATCH_T = 2.5, TIME = 120, REWARD = 150, WAIT = [8, 16], LOAD_T = 3, STATION_T = 240;

export class PoliceMission {
  constructor({ traffic, audio, hud, wallet, cine, world, scene }) {
    Object.assign(this, { traffic, audio, hud, wallet, cine, world });
    this.marker = scene ? new DropMarker(scene, 0x2f7bff) : null; // (مكان تسليم المتهم عند القسم: حلقة زرقا)
    this.state = 'off'; this.off = null; this.caught = 0; this.escaped = 0; this.dispatched = 0;
  }

  get chasing() { return this.state === 'chase'; }

  update(dt, ph, player) {
    const on = player?.kind === 'police';
    if (!on) { if (this.state !== 'off') { this._release(); this.marker?.hide(); this.station = null; this.state = 'off'; } return; }
    this._lights(dt, player.rig.policeBar, !!player.sirenOn);
    if (this.state === 'off') { this.state = 'wait'; this._next = 5; this.hud?.toast('🚓 إنت في البوكس — استنى البلاغ', 2.6); return; }
    if (this.state === 'wait') { this._next -= dt; if (this._next <= 0) this._dispatch(ph); return; }
    this.marker?.update(dt);
    // المتهم بيركب البوكس (اقف جنبه)، وبعدين على أقرب قسم
    if (this.state === 'arrest') {
      if (Math.abs(ph.speed) > 1.5) { this._lt = 0; this.hud?.toast('✋ اقف لحد ما المتهم يركب البوكس', 1.6); }
      this._lt += dt;
      if (this._lt >= LOAD_T) {
        this.station = nearestPlace(this.world, 'police', ph.x, ph.z, 80);
        this.state = 'toStation'; this.t = 0;
        this.marker?.show(this.station, this.world?.height?.(this.station.x, this.station.z) ?? 0);
        this.hud?.toast(`🚓 المتهم في البوكس — على ${this.station.name} (${Math.round(Math.hypot(this.station.x - ph.x, this.station.z - ph.z))}م)، اقف في الدايرة الزرقا`, 3.4);
      }
      return;
    }
    if (this.state === 'toStation') {
      this.t += dt;
      const S = this.station; this.dist = Math.hypot(S.x - ph.x, S.z - ph.z);
      if (this.dist < 14 && Math.abs(ph.speed) < 1) {
        const pay = REWARD + this._bonus + Math.max(0, Math.round((STATION_T - this.t) * 0.4));
        this.wallet?.add(pay, 'police', `سلّمت متهم في ${S.name}`);
        this.hud?.toast(`👮 سلّمت المتهم في ${S.name}! +${pay} ج`, 3.2);
        this.caught++; this.marker?.hide(); this.station = null;
        this.state = 'wait'; this._next = WAIT[0] + Math.random() * (WAIT[1] - WAIT[0]);
      }
      return;
    }
    if (this.state !== 'chase') return;
    const o = this.off;
    if (!o || !o.on || o.off) return this._end('lost');
    this.t += dt;
    const d = Math.hypot(o.x - ph.x, o.z - ph.z);
    this.dist = d;
    this.close = d < CATCH_R ? this.close + dt : Math.max(0, this.close - dt * 0.5);
    if (this.close >= CATCH_T) return this._caught(o);
    if (this.t > TIME) this._end('time');
  }

  _dispatch(ph) {
    const T = this.traffic;
    const cand = (T?.cars || []).filter((c) => c.on && !c.off && !c.virtual && !c.line && c.type !== 'tuktuk' && c.type !== 'moto' && c.v > 3 && !c.bumped && !c.fleeing
      && (c.x - ph.x) ** 2 + (c.z - ph.z) ** 2 > 60 * 60 && (c.x - ph.x) ** 2 + (c.z - ph.z) ** 2 < 180 * 180);
    if (!cand.length) { this._next = 3; return; }
    const o = cand[Math.floor(Math.random() * cand.length)];
    this.off = o; this.t = 0; this.close = 0; this.dist = Math.hypot(o.x - ph.x, o.z - ph.z);
    o._vMul0 = o._vMul0 ?? o.vMul; o.vMul = o._vMul0 * FLEE_MUL; o.fleeing = true;
    this.state = 'chase'; this.dispatched++;
    
    this.cine?.play({ target: () => (o.on ? { x: o.x, z: o.z, yaw: o.yaw } : null), title: '🚨 بلاغ: عربية خبطت وهربت', sub: 'الحقها وفضل جنبها لحد ما تقف — قدامك دقيقتين' });
  }

  _caught(o) {
    o.bumped = 14; o.v = 0;
    this._release();
    // المكافأة بعد التسليم في القسم (على سرعة المسك + سرعة التوصيل)
    this._bonus = Math.max(0, Math.round((TIME - this.t) * 1.2));
    this.hud?.toast('👮 مسكتها! اقف — المتهم بيركب البوكس', 2.8);
    this.state = 'arrest'; this._lt = 0;
  }

  _end(why) {
    this._release();
    this.hud?.toast(why === 'time' ? '⏱ الوقت خلص — العربية هربت' : '💨 العربية هربت منك', 2.8);
    this.escaped++; this.state = 'wait'; this._next = WAIT[0] + Math.random() * (WAIT[1] - WAIT[0]);
  }

  _release() {
    if (this.state === 'off' || this.state === 'wait') { this.marker?.hide(); this.station = null; }
    const o = this.off;
    if (o) { o.vMul = o._vMul0 ?? o.vMul; o.fleeing = false; }
    this.off = null; 
    if (this.cine?.active) this.cine.stop();
  }

  /** الكشاف الأزرق: بيومض في المطاردة */
  _lights(dt, bar, on) {
    if (!bar) return;
    bar.t += dt;
    const k = Math.floor(bar.t * 7) % 4;
    bar.a.emissiveIntensity = on ? (k === 0 ? 3 : k === 1 ? 0.4 : 0.15) : 0.2;
    bar.b.emissiveIntensity = on ? (k === 2 ? 3 : k === 3 ? 0.4 : 0.15) : 0.2;
  }

  navTarget() {
    if (this.state === 'toStation' && this.station) return { x: this.station.x, z: this.station.z, name: this.station.name };
    const o = this.off; return this.state === 'chase' && o?.on ? { x: o.x, z: o.z, name: 'العربية الهربانة' } : null;
  }
  jobInfo() {
    if (this.state === 'arrest') return { mode: 'police', arrest: true, load: Math.min(1, (this._lt || 0) / LOAD_T) };
    if (this.state === 'toStation') return { mode: 'police', toStation: true, station: this.station?.name, dist: Math.round(this.dist || 0) };
    if (this.state === 'chase') return { mode: 'police', chase: true, dist: Math.round(this.dist || 0), left: Math.max(0, Math.ceil(TIME - this.t)), close: this.close / CATCH_T };
    return { mode: 'police', chase: false };
  }
  debugStats() { return { state: this.state, dispatched: this.dispatched, caught: this.caught, escaped: this.escaped, dist: this.dist }; }
}
