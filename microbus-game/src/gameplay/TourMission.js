// =====================================================================
//  جولة سياحية بعربية الجولف (MAJOR UPDATE — STAGE 5): لما تسوق عربية الجولف في مدينة فيها معالم أثرية حقيقية
//  (الجيزة: الأهرامات، المعابد، مراكب الشمس...؛ الأقصر/أسوان لو المعالم جوه الخريطة):
//    سايح مستنيك (على بُعد 60–220م) → اقف جنبه ويركب (بيقعد جنبك في العربية) →
//    2–3 معالم بالترتيب: اقف عندها والسايح بيصوّر (مشهد قصير حوالين المعلم، بيتخطّى) →
//    رجّعه مكان ما ركب → الأجرة + بقشيش على قد سرعتك.
//  المعالم من OSM بس (landmarks.confirmed) — مفيش معالم متألفة.
// =====================================================================
import { edgePoint } from '../world/shibin/ShibinData.js';

const KINDS = new Set(['pyramid', 'historic', 'monument', 'museum', 'temple', 'attraction', 'castle', 'archaeological_site', 'sphinx']);
const BOARD_T = 3, PHOTO_T = 5, LIMIT = 420;

export class TourMission {
  constructor({ world, crowd, hud, wallet, cine, passengers }) {
    Object.assign(this, { world, crowd, hud, wallet, cine, passengers });
    this.state = 'off'; this.done = 0; this.t = 0;
    // (OSM فيه حاجات متعلّمة historic وهي مش أثر — زي بنزينة "توتال": بتتشال بالاسم)
    const NOT = /توتال|total|موبيل|mobil|بنزين|وطنية|شل\b|shell|مستشفى|بنك|صيدلية/i;
    const L = (world?.landmarks?.confirmed || []).filter((l) => KINDS.has(l.kind) && l.inside_region !== false && l.name && !NOT.test(l.name));
    // المعلم الكبير (الهرم) بنقف بعيد عنه بنص قطره + مسافة أمان
    this.pois = L.map((l) => {
      let r = 0;
      for (const [x, z] of l.footprint || []) r = Math.max(r, Math.hypot(x - l.x, z - l.z));
      // الأهمية: الهرم 3، أثر ليه مساحة (معبد/مقبرة) 2، الباقي 1
      return { name: l.name, x: l.x, z: l.z, r, big: l.kind === 'pyramid', score: l.kind === 'pyramid' ? 3 : r > 0 || /معبد|temple|مقبرة|مراكب|أبو الهول|sphinx/i.test(l.name) ? 2 : 1 };
    });
    // (معالم متلاصقة — نفس المكان: واحد بس)
    this.pois.sort((a, b) => b.score - a.score);
    this.pois = this.pois.filter((p, i) => !this.pois.slice(0, i).some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 60));
  }

  get available() { return this.pois.length >= 2; }

  update(dt, ph, player) {
    const on = player?.kind === 'golf';
    if (!on) { if (this.state !== 'off') { this._clear(); this.state = 'off'; } return; }
    if (this.state === 'off') {
      this.state = 'wait'; this._next = 3;
      this.hud?.toast(this.available ? '⛳ عربية الجولف — فيه سياح عايزين يتفرجوا على المعالم، استنى' : '⛳ عربية الجولف — مفيش معالم أثرية في الخريطة دي (جرّب الجيزة)', 3);
      return;
    }
    if (!this.available) return;
    if (this.state === 'wait') { this._next -= dt; if (this._next <= 0) this._dispatch(ph); return; }
    this.t += dt;
    if (this.t > LIMIT) return this._fail();
    const v = Math.abs(ph.speed);
    if (this.state === 'toPick') {
      const P = this.pick; this.dist = Math.hypot(P.rx - ph.x, P.rz - ph.z);
      if (this.dist < 9 && v < 0.8) { this.state = 'board'; this._bt = 0; this.hud?.toast('🧳 السايح بيركب — استنى', 2); }
    } else if (this.state === 'board') {
      if (v > 1.2) { this.state = 'toPick'; this.hud?.toast('✋ استنى لحد ما يركب', 1.8); return; }
      this._bt += dt;
      if (this._bt >= BOARD_T) { this._removeExtras(); this._seat(true); this.leg = 0; this.state = 'toStop'; this._announce(); }
    } else if (this.state === 'toStop') {
      const S = this.stops[this.leg]; this.dist = Math.hypot(S.tx - ph.x, S.tz - ph.z);
      if (this.dist < 18 && v < 0.8) {
        this.state = 'photo'; this._pt = 0;
        const big = S.big, r = big ? Math.max(60, S.r * 1.6) : 30, h = big ? Math.max(25, S.r * 0.9) : 10;
        this.cine?.play({ target: () => ({ x: S.x, z: S.z, yaw: Math.atan2(S.tx - S.x, S.tz - S.z) }), title: `📸 ${S.name}`, sub: 'السايح بيصوّر — اتفرّج معاه', dur: 4.5, r, h, lookY: big ? S.r * 0.35 : 2 });
      }
    } else if (this.state === 'photo') {
      this._pt += dt;
      if (v > 1.5 && this._pt < PHOTO_T) { this.state = 'toStop'; this.hud?.toast('✋ استنى السايح يخلّص صور', 1.8); return; }
      if (this._pt >= PHOTO_T) {
        this.leg++;
        if (this.leg >= this.stops.length) { this.state = 'toBack'; this.hud?.toast('🔙 الجولة خلصت — رجّع السايح مكان ما ركب', 2.6); }
        else { this.state = 'toStop'; this._announce(); }
      }
    } else if (this.state === 'toBack') {
      const P = this.pick; this.dist = Math.hypot(P.rx - ph.x, P.rz - ph.z);
      if (this.dist < 12 && v < 0.8) {
        const fare = 60 + 45 * this.stops.length, tip = Math.max(0, Math.round((LIMIT - this.t) * 0.15));
        this.wallet?.add(fare + tip, 'tour', `جولة سياحية (${this.stops.length} معالم)`);
        this.hud?.toast(`✅ السايح مبسوط! الجولة ${fare} ج + بقشيش ${tip} ج`, 3.4);
        this.done++; this._seat(false); this._finish();
      }
    }
  }

  _announce() {
    const S = this.stops[this.leg];
    this.hud?.toast(`🗺️ المحطة ${this.leg + 1}/${this.stops.length}: ${S.name} — اقف جنبه عشان السايح يصوّر`, 3);
  }

  _dispatch(ph) {
    const W = this.world, G = W?.graph;
    if (!G) return;
    const ok = new Set(['primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street', 'pedestrian']);
    let best = null;
    for (let k = 0; k < 80 && !best; k++) {
      const e = G.edges[Math.floor(Math.random() * G.edges.length)];
      if (!e || e.closed || e.elevated || !ok.has(e.cls) || e.length < 20) continue;
      const q = edgePoint(e, e.length * (0.3 + Math.random() * 0.4), {});
      const d = Math.hypot(q.x - ph.x, q.z - ph.z);
      if (d < 60 || d > 220) continue;
      best = { x: q.x - q.dz * (e.half + 1.2), z: q.z + q.dx * (e.half + 1.2), rx: q.x, rz: q.z, yaw: Math.atan2(q.dx, q.dz) };
    }
    if (!best) { this._next = 1.5; return; }
    this.pick = best;
    // 2–3 معالم: الأهم الأول (السايح جاي عشان الأهرامات) — من أعلى أهمية، وبعدين بالترتيب الأقرب فالأقرب (من غير لف ورجوع)
    const n = Math.min(this.pois.length, 2 + (Math.random() < 0.5 ? 1 : 0));
    const top = this.pois.filter((p) => p.score === this.pois[0].score);
    const rest = this.pois.filter((p) => !top.includes(p)).sort((a, b) => b.score - a.score || Math.hypot(a.x - best.x, a.z - best.z) - Math.hypot(b.x - best.x, b.z - best.z));
    const pool = [...top.sort(() => Math.random() - 0.5), ...rest].slice(0, n);
    const left = [...pool], stops = [];
    let cx = best.x, cz = best.z;
    while (stops.length < n && left.length) {
      left.sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz));
      const p = left.shift(); stops.push(p); cx = p.x; cz = p.z;
    }
    // نقطة الوقوف: على الطريق جنب المعلم لو فيه طريق قريب؛ وإلا على بعد (نص قطره + 25م) ناحية اللي جاي منه
    let px = best.x, pz = best.z;
    this.stops = stops.map((p) => {
      const dx = px - p.x, dz = pz - p.z, l = Math.hypot(dx, dz) || 1, R = p.r + (p.big ? 25 : 12);
      let tx = p.x + dx / l * R, tz = p.z + dz / l * R;
      const r = W.roadPose?.(tx, tz);
      if (r && Math.hypot(r.x - tx, r.z - tz) < 45 && Math.hypot(r.x - p.x, r.z - p.z) > p.r + 5) { tx = r.x; tz = r.z; }
      px = tx; pz = tz;
      return { ...p, tx, tz };
    });
    this.t = 0; this.dist = Math.hypot(best.rx - ph.x, best.rz - ph.z);
    // السايح واقف على الرصيف (وجنبه شنطته — شكل الناس الجاهز)
    const nv = this.crowd?.batch ? 12 : 0;
    this._seed = Math.floor(Math.random() * 1000);
    this.extras = nv ? [{ variant: this._seed % nv, x: best.x, y: 0.15, z: best.z, yaw: best.yaw + Math.PI / 2, armR: 0.9 }] : [];
    this.crowd?.extras.push(...this.extras);
    this.state = 'toPick';
    this.cine?.play({ target: () => ({ x: best.x, z: best.z, yaw: best.yaw }), title: '⛳ جولة سياحية', sub: `سايح عايز يزور: ${this.stops.map((s) => s.name).join(' ← ')}` });
  }

  /** السايح قاعد جنبك في العربية (كرسي الراكب) */
  _seat(on) {
    const S = this.passengers?.seats?.[0];
    if (!S) return;
    S.pax = on ? { seed: this._seed } : null;
    this.passengers._rebuildSeated?.();
  }

  _removeExtras() {
    const ex = this.crowd?.extras;
    if (ex && this.extras) for (const q of this.extras) { const i = ex.indexOf(q); if (i >= 0) ex.splice(i, 1); }
    this.extras = null;
  }
  _clear() { this._removeExtras(); this._seat(false); if (this.cine?.active) this.cine.stop(); this.pick = null; this.stops = null; }
  _finish() { this._clear(); this.state = 'wait'; this._next = 4 + Math.random() * 4; }
  _fail() { this.hud?.toast('⏱ الجولة طوّلت — السايح نزل ومشي', 3); this._finish(); }

  navTarget() {
    if (this.state === 'toPick' || this.state === 'board') return { x: this.pick.rx, z: this.pick.rz, name: 'السايح' };
    if (this.state === 'toStop' || this.state === 'photo') { const S = this.stops[this.leg]; return { x: S.tx, z: S.tz, name: S.name }; }
    if (this.state === 'toBack') return { x: this.pick.rx, z: this.pick.rz, name: 'نقطة النزول' };
    return null;
  }
  jobInfo() {
    const S = this.stops?.[this.leg];
    return { mode: 'tour', state: this.state, dist: Math.round(this.dist || 0), left: Math.max(0, Math.ceil(LIMIT - (this.t || 0))), stop: S?.name, leg: (this.leg || 0) + 1, legs: this.stops?.length || 0 };
  }
  debugStats() { return { state: this.state, done: this.done, pois: this.pois.length, stops: this.stops?.map((s) => s.name) }; }
}
