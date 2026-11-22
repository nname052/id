// =====================================================================
//  مهمات الإسعاف (لما تسوق عربية الإسعاف): بلاغ عن مصاب في شارع على بُعد 250–600م → مشهد قصير (بيتخطّى) →
//  روح له بالسارينة، اقف جنبه (أقل من 12م وواقف) والمسعفين بيشيلوه (4 ثواني) → وصّله أقرب مستشفى حقيقية
//  من OSM. المكافأة على قد سرعتك (حالة المصاب بتسوء مع الوقت). من غير أي مشاهد دموية: المصاب نايم بس.
// =====================================================================
import { edgePoint } from '../world/shibin/ShibinData.js';
import { nearestPlace, DropMarker } from './Destinations.js';

const REWARD = 140, LIMIT = 240, LOAD_T = 4, WAIT = [6, 12];

export class AmbulanceMission {
  constructor({ world, crowd, audio, hud, wallet, cine, scene }) {
    Object.assign(this, { world, crowd, audio, hud, wallet, cine });
    this.marker = scene ? new DropMarker(scene, 0xff3b3b) : null; // (مكان التسليم عند المستشفى: حلقة حمرا منوّرة)
    this.state = 'off'; this.done = 0; this.dispatched = 0; this.failed = 0;
    this.hospitals = (world?.landmarks?.confirmed || []).filter((l) => l.kind === 'hospital' && l.inside_region !== false);
  }

  update(dt, ph, player) {
    const on = player?.kind === 'ambulance';
    if (!on) { if (this.state !== 'off') { this._clear(); this.state = 'off'; } return; }
    this._lights(dt, player.rig.policeBar, !!player.sirenOn || this.state === 'load');
    this.marker?.update(dt);
    if (this.state === 'off') { this.state = 'wait'; this._next = 4; this.hud?.toast('🚑 إنت في الإسعاف — استنى البلاغ', 2.6); return; }
    if (this.state === 'wait') { this._next -= dt; if (this._next <= 0) this._dispatch(ph); return; }
    this.t += dt;
    if (this.t > LIMIT) return this._fail();
    if (this.state === 'toCase') {
      const C = this.case, d = Math.hypot(C.x - ph.x, C.z - ph.z);
      this.dist = d;
      if (d < 12 && Math.abs(ph.speed) < 1) { this.state = 'load'; this._lt = 0;  this.hud?.toast('🩺 المسعفين بيشيلوا المصاب — استنى', 2.5); }
    } else if (this.state === 'load') {
      if (Math.abs(ph.speed) > 1.5) { this.state = 'toCase';  this.hud?.toast('✋ استنى لحد ما يركبوه', 2); return; }
      this._lt += dt;
      if (this._lt >= LOAD_T) {
        this._removeExtras();
        this.hosp = this._hospital(ph);
        this.state = 'toHosp';
        this.marker?.show(this.hosp, this.world?.height?.(this.hosp.x, this.hosp.z) ?? 0);
        this.hud?.toast(`🏥 أقرب مستشفى: ${this.hosp.name} (${Math.round(Math.hypot(this.hosp.x - ph.x, this.hosp.z - ph.z))}م) — اقف في الدايرة الحمرا`, 3.2);
      }
    } else if (this.state === 'toHosp') {
      const H = this.hosp, d = Math.hypot(H.x - ph.x, H.z - ph.z);
      this.dist = d;
      if (d < 14 && Math.abs(ph.speed) < 1) {
        const bonus = Math.max(0, Math.round((LIMIT - this.t) * 0.8));
        this.wallet?.add(REWARD + bonus, 'ambulance', 'وصّلت مصاب للمستشفى');
        this.hud?.toast(`✅ المصاب وصل المستشفى! +${REWARD + bonus} ج`, 3.2);
        this.done++; this._finish();
      }
    }
  }

  _dispatch(ph) {
    const W = this.world, G = W?.graph;
    if (!G) return;
    const ok = new Set(['primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street']);
    let best = null;
    for (let k = 0; k < 60 && !best; k++) {
      const e = G.edges[Math.floor(Math.random() * G.edges.length)];
      if (!e || e.closed || e.elevated || !ok.has(e.cls) || e.length < 30) continue;
      const q = edgePoint(e, e.length * (0.3 + Math.random() * 0.4), {});
      const d = Math.hypot(q.x - ph.x, q.z - ph.z);
      if (d < 250 || d > 600) continue;
      best = { x: q.x - q.dz * (e.half + 1.2), z: q.z + q.dx * (e.half + 1.2), rx: q.x, rz: q.z, yaw: Math.atan2(q.dx, q.dz), name: e.name || 'شارع جانبي' };
    }
    if (!best) { this._next = 2; return; }
    this.case = best; this.t = 0; this.dist = Math.hypot(best.x - ph.x, best.z - ph.z);
    // المصاب نايم على الرصيف + اتنين واقفين جنبه
    const C = best, nv = this.crowd?.batch ? 12 : 0;
    this.extras = nv ? [
      { variant: Math.floor(Math.random() * nv), x: C.x, y: 0.15, z: C.z, yaw: C.yaw, fall: 1 },
      { variant: Math.floor(Math.random() * nv), x: C.x + Math.sin(C.yaw) * 1.2 + 0.6, y: 0.15, z: C.z + Math.cos(C.yaw) * 1.2, yaw: C.yaw + 2.5 },
      { variant: Math.floor(Math.random() * nv), x: C.x - Math.sin(C.yaw) * 1.1 - 0.5, y: 0.15, z: C.z - Math.cos(C.yaw) * 1.1, yaw: C.yaw - 0.6 },
    ] : [];
    this.crowd?.extras.push(...this.extras);
    this.state = 'toCase'; this.dispatched++;
    
    this.cine?.play({ target: () => ({ x: C.x, z: C.z, yaw: C.yaw }), title: '🚑 بلاغ: حالة طوارئ', sub: `فيه مصاب في ${C.name} — روح له ووصّله أقرب مستشفى` });
  }

  /** أقرب مستشفى حقيقية (المعالم + نقط OSM، وبعدين العيادات) — نقطة الوقوف على الشارع اللي جنبها.
   *  لو الخريطة مافيهاش: "نقطة إسعاف (مكان في اللعبة)" على طريق رئيسي — مش اسم مستشفى متألف */
  _hospital(ph) { return nearestPlace(this.world, 'hospital', ph.x, ph.z, 80); }

  _removeExtras() {
    const ex = this.crowd?.extras;
    if (ex && this.extras) for (const q of this.extras) { const i = ex.indexOf(q); if (i >= 0) ex.splice(i, 1); }
    this.extras = null;
  }
  _clear() { this._removeExtras(); this.marker?.hide(); if (this.cine?.active) this.cine.stop(); this.case = null; this.hosp = null; }
  _finish() { this._clear(); this.state = 'wait'; this._next = WAIT[0] + Math.random() * (WAIT[1] - WAIT[0]); }
  _fail() { this.failed++; this.hud?.toast('⏱ اتأخرت — إسعاف تاني وصل للمصاب', 3); this._finish(); }

  _lights(dt, bar, on) {
    if (!bar) return;
    bar.t += dt;
    const k = Math.floor(bar.t * 6) % 4;
    bar.a.emissiveIntensity = on ? (k === 0 ? 3 : k === 1 ? 0.4 : 0.15) : 0.2;
    bar.b.emissiveIntensity = on ? (k === 2 ? 3 : k === 3 ? 0.4 : 0.15) : 0.2;
  }

  navTarget() {
    if (this.state === 'toCase' || this.state === 'load') return { x: this.case.rx, z: this.case.rz, name: 'المصاب' };
    if (this.state === 'toHosp') return { x: this.hosp.x, z: this.hosp.z, name: this.hosp.name };
    return null;
  }
  jobInfo() { return { mode: 'ambulance', state: this.state, dist: Math.round(this.dist || 0), left: Math.max(0, Math.ceil(LIMIT - (this.t || 0))), hosp: this.hosp?.name, load: this.state === 'load' ? this._lt / LOAD_T : 0 }; }
  debugStats() { return { state: this.state, dispatched: this.dispatched, done: this.done, failed: this.failed, hospitals: this.hospitals.length }; }
}
